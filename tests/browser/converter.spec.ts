import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { convert } from '../../src/core/index';
import type { ConversionOptions } from '../../src/core/types';
import { baseline, exact, fragments } from '../fixtures';
import dictionary from '../../data/emoticons.json' with { type: 'json' };

async function ready(page: Page) {
  await expect(page.locator('#status')).toContainText('Ready.');
}
async function spellingOnly(page: Page) {
  await page.locator('#advanced summary').first().click();
  for (const rate of ['stutter', 'stretch', 'tilde', 'nya', 'emoticon']) {
    const slider = page.locator('#rate-' + rate);
    if (await slider.isEnabled()) await slider.fill('0');
  }
}
test('local conversion, controls, raw clipboard and original input', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await ready(page);
  await spellingOnly(page);
  await page.locator('#input-text').fill('Hello world!');
  await expect(page.locator('#output-text')).toHaveValue('Hewwo wowwd!');
  await page.locator('#copy-button').click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Hewwo wowwd!');
  await page.locator('input[name="style"][value="nya"]').check();
  await spellingOnlyWhenOpen(page);
  await page.locator('#input-text').fill('No, not now. New, nice.');
  await expect(page.locator('#output-text')).toHaveValue('Nyo, nyot nyow. Nyew, nyice.');
  await page.locator('#highlight').check();
  await expect(page.locator('#highlight-output')).toHaveText('Nyo, nyot nyow. Nyew, nyice.');
  await expect(page.locator('#highlight-output mark')).toHaveCount(5);
  await page.locator('#shuffle-button').click();
  await expect(page.locator('#seed')).not.toHaveValue('0');
  await expect(page.locator('#input-text')).toHaveValue('No, not now. New, nice.');
  await page.locator('#clear-button').click();
  await expect(page.locator('#highlight-output')).toBeEmpty();
  expect(errors).toEqual([]);
});
async function spellingOnlyWhenOpen(page: Page) {
  for (const rate of ['stutter', 'stretch', 'tilde', 'nya', 'emoticon'])
    if (await page.locator('#rate-' + rate).isEnabled())
      await page.locator('#rate-' + rate).fill('0');
}
test('built browser engine and HTTP adapter match Node fixtures and seeded diagnostics', async ({
  page,
  request,
}) => {
  await page.route('**/__core.mjs', (route) =>
    route.fulfill({ path: resolve('dist/library/index.js'), contentType: 'text/javascript' }),
  );
  await page.goto('/');
  await ready(page);
  const cases: { text: string; options: ConversionOptions }[] = exact.map(([text, , options]) => ({
    text,
    options: { ...baseline, ...options, diagnostics: true },
  }));
  for (const text of fragments.concat([
    'Hello! Thanks for the tea.',
    'I love you!',
    'crème cre\u0300me 👩🏽‍💻 Hello!',
    'Hello!\n:3 Goodbye!',
  ]))
    cases.push({
      text,
      options: {
        style: 'nya',
        seed: 'review',
        rates: { stutter: 1, stretch: 1, tilde: 1, nya: 1, emoticon: 1 },
        diagnostics: true,
      },
    });
  const browserResults = await page.evaluate(async (cases) => {
    const url = '/__core.mjs';
    const { convert } = await import(url);
    return cases.map(({ text, options }) => convert(text, options));
  }, cases);
  for (const [index, { text, options }] of cases.entries()) {
    const core = convert(text, options);
    expect(browserResults[index]).toEqual(core);
    const response = await request.post('/v1/convert', { data: { text, options } });
    expect(await response.json()).toEqual(core);
  }
});
test('conversion works offline after load, with safe text rendering and validation', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await ready(page);
  await spellingOnly(page);
  await ready(page);
  const conversions: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/v1/convert')) conversions.push(request.url());
  });
  await context.setOffline(true);
  const source = '<img src=x onerror=alert(1)> Hello 👩🏽‍💻';
  await page.locator('#input-text').fill(source);
  await expect(page.locator('#output-text')).toHaveValue(convert(source, baseline).text);
  await page.locator('#highlight').check();
  await expect(page.locator('#highlight-output')).toHaveText(convert(source, baseline).text);
  await expect(page.locator('#highlight-output img')).toHaveCount(0);
  await page.locator('#input-text').fill('x'.repeat(100001));
  await expect(page.locator('#error')).toContainText('100,000');
  await expect(page.locator('#copy-button')).toBeDisabled();
  await page.locator('#input-text').fill('Hello again!');
  await expect(page.locator('#highlight-output')).toHaveText('Hewwo again!');
  expect(conversions).toEqual([]);
});
test('dictionary search, intent filter, source notes and copying', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/#dictionary');
  await expect(page.locator('.face-card')).toHaveCount(dictionary.entries.length);
  await page.locator('#face-search').fill('uwu');
  await expect(page.locator('.face-card').first()).toBeVisible();
  await page.getByRole('button', { name: 'Copy uwu face', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('uwu');
  await page.locator('.face-card summary').first().click();
  await expect(page.locator('.face-sources a').first()).toHaveAttribute('href', /^https:\/\//);
  await page.locator('#face-search').fill('');
  await page.locator('#dictionary-intent').selectOption('sleep');
  await expect(page.locator('.face-card')).toHaveCount(
    dictionary.entries.filter((e) => e.intents.includes('sleep')).length,
  );
  await page.locator('#face-search').fill('no matches exist here');
  await expect(page.locator('#dictionary-empty')).toBeVisible();
});
test('desktop and mobile layouts stay within viewport and retain usable controls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/');
  await ready(page);
  await page.screenshot({ path: 'test-results/converter-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.locator('input[name="style"][value="nya"]').check();
  await ready(page);
  await page.screenshot({ path: 'test-results/converter-mobile.png', fullPage: true });
  await page.locator('#advanced summary').first().click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('link', { name: 'Face dictionary' }).click();
  await expect(page.locator('.face-card')).toHaveCount(dictionary.entries.length);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
test('maximum input converts in the worker and stale results cannot replace newer text', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await ready(page);
  const text = [...'Hello, world! Thanks for being here. 👩🏽‍💻 '.repeat(3000)]
    .slice(0, 100000)
    .join('');
  const expected = convert(text).text;
  const duration = await page.evaluate(
    (text) =>
      new Promise<number>((done) => {
        const output = document.getElementById('output-text')!;
        const start = performance.now();
        const observer = new MutationObserver(() => {
          observer.disconnect();
          done(performance.now() - start);
        });
        observer.observe(output, { attributes: true, attributeFilter: ['data-revision'] });
        const input = document.getElementById('input-text') as HTMLTextAreaElement;
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }),
    text,
  );
  await expect(page.locator('#output-text')).toHaveValue(expected);
  await testInfo.attach('100k-worker-latency-ms', {
    body: String(duration),
    contentType: 'text/plain',
  });
  console.log(`Browser 100k preview including debounce: ${duration.toFixed(1)} ms`);
  await page.locator('#input-text').fill(text);
  await page.locator('#input-text').fill('Hello again!');
  await expect(page.locator('#output-text')).toHaveValue(convert('Hello again!').text);
});
