import './style.css';
import dictionary from '../../data/emoticons.json' with { type: 'json' };
import { intents, resolveOptions, versions } from '../core/index.js';
import { showWiki } from './wiki.js';
import type {
  ConversionOptions,
  ConversionResult,
  Intensity,
  Style,
  Rates,
} from '../core/types.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const field = (id: string) => $<HTMLInputElement>(id);
const select = (id: string) => $<HTMLSelectElement>(id);
const input = $<HTMLTextAreaElement>('input-text'),
  output = $<HTMLTextAreaElement>('output-text');
const rateNames: Record<keyof Rates, string> = {
  stutter: 'Stutters',
  stretch: 'Extra vowels',
  tilde: 'Tildes',
  nya: 'Nya particles',
  emoticon: 'Faces',
};
const style = () =>
  document.querySelector<HTMLInputElement>('input[name="style"]:checked')!.value as Style;
const intensity = () =>
  document.querySelector<HTMLInputElement>('input[name="intensity"]:checked')!.value as Intensity;
const intentLabels: Record<string, string> = { cuteness: 'Playfulness' };
const meaningLabels: Record<string, string> = {
  'cute pleasure': 'playful pleasure',
  'catlike cuteness': 'catlike charm',
  cuteness: 'charm',
};
const displayMeaning = (meaning: string) => meaningLabels[meaning] ?? meaning;
const title = (s: string) => s.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase());
let current: ConversionResult | undefined,
  requested = 0,
  completed = 0,
  timer: ReturnType<typeof setTimeout>;
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

for (const [key, name] of Object.entries(rateNames)) {
  const label = document.createElement('label');
  label.className = 'rate';
  label.htmlFor = 'rate-' + key;
  const text = document.createElement('span');
  text.textContent = name;
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '1';
  slider.step = '.01';
  slider.id = 'rate-' + key;
  const value = document.createElement('output');
  value.id = 'value-' + key;
  value.htmlFor = slider.id;
  label.append(text, slider, value);
  $('rate-controls').append(label);
}
for (const intent of intents)
  for (const id of ['face-intent', 'dictionary-intent']) {
    const option = document.createElement('option');
    option.value = intent;
    option.textContent = intentLabels[intent] ?? title(intent);
    select(id).append(option);
  }
function preset() {
  const o = resolveOptions({ style: style(), intensity: intensity() });
  for (const [id, value] of Object.entries({
    vocabulary: o.features.vocabulary,
    'letter-swap': o.features.letterSwap,
    'nya-spelling': o.features.nyaSpelling,
    'faces-enabled': o.emoticons.enabled,
    'ascii-only': o.emoticons.asciiOnly,
    'allow-combination': o.endings.allowCombination,
  }))
    field(id).checked = value;
  for (const [id, value] of Object.entries({
    'nya-scope': o.nyaScope,
    'quoted-text': o.quotedText,
    'face-intent': o.emoticons.intent,
    'face-intensity': o.emoticons.maxIntensity,
    'max-endings': o.endings.maxPerMessage,
    'sentence-gap': o.endings.minSentenceGap,
  }))
    field(id).value = String(value);
  for (const [key, value] of Object.entries(o.rates)) field('rate-' + key).value = String(value);
  for (const id of ['nya-spelling', 'nya-scope', 'rate-nya'])
    field(id).disabled = style() !== 'nya';
  updateRates();
}
function updateRates() {
  for (const key of Object.keys(rateNames))
    $('value-' + key).textContent = `${Math.round(Number(field('rate-' + key).value) * 100)}%`;
}
function options(): ConversionOptions {
  return {
    style: style(),
    intensity: intensity(),
    seed: field('seed').value,
    features: {
      vocabulary: field('vocabulary').checked,
      letterSwap: field('letter-swap').checked,
      nyaSpelling: style() === 'nya' && field('nya-spelling').checked,
    },
    rates: Object.fromEntries(
      Object.keys(rateNames).map((key) => [
        key,
        key === 'nya' && style() !== 'nya' ? 0 : Number(field('rate-' + key).value),
      ]),
    ),
    emoticons: {
      enabled: field('faces-enabled').checked,
      asciiOnly: field('ascii-only').checked,
      intent: select('face-intent').value,
      maxIntensity: Number(select('face-intensity').value),
    },
    endings: {
      maxPerMessage: field('max-endings').valueAsNumber,
      minSentenceGap: field('sentence-gap').valueAsNumber,
      allowCombination: field('allow-combination').checked,
    },
    nyaScope: select('nya-scope').value as 'words' | 'full',
    quotedText: select('quoted-text').value as 'preserve' | 'convert',
    preserveTerms: $<HTMLTextAreaElement>('preserve-terms')
      .value.split(/\r?\n/)
      .filter((s) => s.length > 0),
    diagnostics: field('highlight').checked || $<HTMLDetailsElement>('inspection').open,
  };
}
function render() {
  if (!current) return;
  output.value = current.text;
  const highlighted = field('highlight').checked,
    preview = $('highlight-output');
  output.hidden = highlighted;
  preview.hidden = !highlighted;
  preview.replaceChildren();
  if (highlighted) {
    let cursor = 0;
    for (const c of current.diagnostics?.changes ?? []) {
      preview.append(document.createTextNode(current.text.slice(cursor, c.outputStart)));
      const mark = document.createElement('mark');
      mark.textContent = c.after;
      mark.title = c.before ? `${c.before} → ${c.after}` : 'Added expression';
      preview.append(mark);
      cursor = c.outputEnd;
    }
    preview.append(document.createTextNode(current.text.slice(cursor)));
  }
  $('diagnostics-output').textContent = JSON.stringify(
    { meta: current.meta, diagnostics: current.diagnostics },
    null,
    2,
  );
}
function schedule(immediate = false) {
  const id = ++requested;
  clearTimeout(timer);
  current = undefined;
  field('copy-button').disabled = true;
  $('error').hidden = true;
  $('status').textContent = 'Softening your words…';
  $('input-count').textContent = `${[...input.value].length.toLocaleString()} characters`;
  $('output-tag').textContent = `${intensity().toUpperCase()} · ${style().toUpperCase()}`;
  document.querySelector('label[for="output-text"]')!.textContent =
    style() === 'nya' ? 'A little nya' : 'A little uwu';
  timer = setTimeout(
    () => worker.postMessage({ id, text: input.value, options: options() }),
    immediate ? 0 : 100,
  );
}
worker.addEventListener(
  'message',
  (event: MessageEvent<{ id: number; result?: ConversionResult; error?: string }>) => {
    if (event.data.id !== requested) return;
    completed = event.data.id;
    if (event.data.error) {
      output.value = '';
      $('highlight-output').replaceChildren();
      $('error').textContent = event.data.error;
      $('error').hidden = false;
      $('status').textContent = 'Check the text or settings above.';
      return;
    }
    current = event.data.result!;
    render();
    field('copy-button').disabled = !current.text;
    $('status').textContent = input.value
      ? `Ready. Same seed, same little bit of silly. ${current.diagnostics?.truncated ? 'Change report shortened to 2,000 records.' : ''}`
      : 'A blank page, a fresh start.';
    output.dataset.revision = String(completed);
  },
);
worker.addEventListener('error', () => {
  $('error').hidden = false;
  $('error').textContent = 'The converter could not start. Reload this page to try again.';
  $('status').textContent = '';
});

input.addEventListener('input', () => schedule());
document
  .querySelectorAll<HTMLInputElement>('input[name="style"], input[name="intensity"]')
  .forEach((el) =>
    el.addEventListener('change', () => {
      preset();
      schedule();
    }),
  );
$('advanced').addEventListener('input', () => {
  updateRates();
  schedule();
});
field('highlight').addEventListener('change', () => schedule());
$('inspection').addEventListener('toggle', () => schedule());
$('reset-button').addEventListener('click', () => {
  preset();
  schedule();
});
$('clear-button').addEventListener('click', () => {
  input.value = '';
  schedule(true);
  input.focus();
});
$('shuffle-button').addEventListener('click', () => {
  field('seed').value = [...crypto.getRandomValues(new Uint32Array(2))]
    .map((n) => n.toString(36))
    .join('-');
  schedule(true);
});
const examples = [
  'Hi! Please bring the small cat. I love you!',
  'Sorry for sending the message twice. Thanks for being patient with me!',
  'Hello Luna! Visit https://example.com/hello.\nShe said "Please bring a blanket."',
  'No, not now. The nice cat needs a little nap.',
];
let exampleIndex = 0;
$('example-button').addEventListener('click', () => {
  input.value = examples[exampleIndex++ % examples.length];
  schedule(true);
});
async function copy(text: string, button: HTMLButtonElement) {
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied!';
  } catch {
    button.textContent = 'Select & copy manually';
  }
  setTimeout(() => {
    button.textContent = original;
  }, 1800);
}
$<HTMLButtonElement>('copy-button').addEventListener('click', (event) => {
  if (current && completed === requested)
    void copy(current.text, event.currentTarget as HTMLButtonElement);
});

function drawDictionary() {
  const term = field('face-search').value.trim().toLowerCase(),
    intent = select('dictionary-intent').value;
  const entries = dictionary.entries.filter(
    (e) =>
      (intent === 'all' || e.intents.includes(intent)) &&
      [e.text, e.id, ...e.aliases, ...e.meanings, ...e.meanings.map(displayMeaning), e.use_when]
        .join(' ')
        .toLowerCase()
        .includes(term),
  );
  const grid = $('face-grid');
  grid.replaceChildren();
  for (const entry of entries) {
    const article = document.createElement('article');
    article.className = 'face-card';
    const top = document.createElement('div');
    top.className = 'face-top';
    const face = document.createElement('span');
    face.className = 'dictionary-face';
    face.textContent = entry.text;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'face-copy';
    button.textContent = 'Copy';
    button.setAttribute('aria-label', `Copy ${entry.id.replaceAll('_', ' ')} face`);
    button.addEventListener('click', () => {
      void copy(entry.text, button);
    });
    top.append(face, button);
    const name = document.createElement('h2');
    name.textContent = title(entry.id);
    const meanings = document.createElement('p');
    meanings.className = 'face-meanings';
    meanings.textContent = entry.meanings.map(displayMeaning).join(' · ');
    const use = document.createElement('p');
    use.textContent = entry.use_when;
    const details = document.createElement('details'),
      summary = document.createElement('summary');
    summary.textContent = 'Context & sources';
    const avoid = document.createElement('p');
    avoid.textContent = 'Take care: ' + entry.avoid_when;
    const example = document.createElement('p');
    example.className = 'face-example';
    example.textContent = entry.example.output;
    const aliases = document.createElement('p');
    aliases.textContent = entry.aliases.length
      ? `Also written: ${entry.aliases.join('  ')}`
      : 'No listed alternate forms.';
    const sources = document.createElement('div');
    sources.className = 'face-sources';
    for (const id of entry.source_ids) {
      const source = dictionary.sources.find((s) => s.id === id)!;
      const link = document.createElement('a');
      link.href = source.url;
      link.textContent = source.id === 'yokimoji' ? 'Yokimoji: Kaomoji Catalog' : source.title;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      sources.append(link);
    }
    details.append(summary, avoid, example, aliases, sources);
    article.append(top, name, meanings, use, details);
    grid.append(article);
  }
  $('dictionary-count').textContent =
    `${entries.length} ${entries.length === 1 ? 'face' : 'faces'}`;
  $('dictionary-empty').hidden = entries.length > 0;
}
field('face-search').addEventListener('input', drawDictionary);
select('dictionary-intent').addEventListener('change', drawDictionary);
const pageTitles = {
  converter: 'UwU Speak — Say something silly',
  dictionary: 'Face dictionary — UwU Speak',
  wiki: 'Emoticon wiki — UwU Speak',
};
function navigate() {
  const page =
    location.hash === '#dictionary'
      ? 'dictionary'
      : location.hash === '#wiki' || location.hash.startsWith('#wiki/')
        ? 'wiki'
        : 'converter';
  $('converter-page').hidden = page !== 'converter';
  $('dictionary-page').hidden = page !== 'dictionary';
  $('wiki-page').hidden = page !== 'wiki';
  if (page === 'wiki') void showWiki(copy);
  document.querySelectorAll<HTMLAnchorElement>('[data-page]').forEach((a) => {
    if (a.dataset.page === page) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  document.title = pageTitles[page];
}
window.addEventListener('hashchange', navigate);
field('seed').value = '0';
$('dictionary-total').textContent = String(dictionary.entries.length);
$('version-label').textContent = `v${versions.engineVersion}`;
preset();
drawDictionary();
navigate();
schedule(true);
