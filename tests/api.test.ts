import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createAppServer } from '../src/server';
import { convert } from '../src/core/index';
import { baseline, exact, fragments } from './fixtures';
const server = createAppServer();
let origin: string;
before(async () => {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((done, reject) => server.close((e) => (e ? reject(e) : done())));
});
const post = (body: unknown) =>
  fetch(origin + '/v1/convert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
test('HTTP uses the shared engine and exact fixtures including diagnostics', async () => {
  for (const [text, expected, overrides] of exact) {
    const options = { ...baseline, ...overrides, diagnostics: true };
    const response = await post({ text, options });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.text, expected);
    assert.deepEqual(result, convert(text, options));
  }
  const text = fragments.join(' Hello! '),
    options = { seed: 'api', style: 'nya' as const, diagnostics: true };
  assert.deepEqual(await (await post({ text, options })).json(), convert(text, options));
});
test('HTTP returns structured errors for invalid payloads and limits', async () => {
  for (const [body, status] of [
    [{}, 400],
    [{ text: 12 }, 400],
    [{ text: '\ud800' }, 400],
    [{ text: 'x'.repeat(100001) }, 413],
    [{ text: 'hi', options: null }, 422],
    [{ text: 'hi', options: { nope: true } }, 422],
    [{ text: '', unexpected: 1 }, 422],
  ] as const) {
    const response = await post(body);
    assert.equal(response.status, status);
    const result = await response.json();
    assert.equal(typeof result.error.code, 'string');
    assert.equal(typeof result.error.message, 'string');
  }
  for (const [method, headers, body, expected] of [
    ['GET', {}, undefined, 405],
    ['POST', { 'Content-Type': 'text/plain' }, 'hi', 415],
    ['POST', { 'Content-Type': 'application/json' }, '{no', 400],
    [
      'POST',
      { 'Content-Type': 'application/json' },
      JSON.stringify({ text: 'x'.repeat(1048576) }),
      413,
    ],
  ] as const) {
    const response = await fetch(origin + '/v1/convert', { method, headers, body });
    assert.equal(response.status, expected);
    await response.text();
  }
});
test('chunked oversized bodies return 413 without losing the error response', async () => {
  const result = await new Promise<{ status?: number; body: string }>((done, reject) => {
    const req = request(
      origin + '/v1/convert',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' },
      },
      (response) => {
        let body = '';
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => done({ status: response.statusCode, body }));
      },
    );
    req.on('error', reject);
    for (let i = 0; i < 18; i++) req.write('x'.repeat(65536));
    req.end();
  });
  assert.equal(result.status, 413);
  assert.equal(JSON.parse(result.body).error.code, 'BODY_TOO_LARGE');
});
test('server and library artifacts are not publicly served', async () => {
  for (const path of [
    '/server.mjs',
    '/library/index.js',
    '/package.json',
    '/assets/%2e%2e/%2e%2e/package.json',
    '/assets/..%2fserver.mjs',
    '/assets/..%5clibrary%5cindex.js',
  ])
    assert.equal((await fetch(origin + path)).status, 404);
});
