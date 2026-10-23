// The emoticon wiki: every collected candidate and how it was judged against
// docs/emoticon-criteria.md. The candidate DB is large, so it loads only when the page opens.
import dictionary from '../../data/emoticons.json' with { type: 'json' };
import dbUrl from '../../data/emoticon-candidates.json?url';

type Verdict = 'accepted' | 'alias' | 'existing' | 'rejected' | 'unclassified';
interface Source {
  site: string;
  page: string;
  position: number;
}
interface Annotation {
  intents: string[];
  meanings: string[];
  intensity: number;
  styles: string[];
  kind: string;
  eligibility: string;
  use_when: string;
  avoid_when: string;
  example_input: string;
  proposed_intent?: string;
  note?: string;
}
interface Entry {
  id: string;
  text: string;
  verdict: Verdict;
  sources: Source[];
  warnings?: string[];
  reasons?: string[];
  note?: string;
  existing_id?: string;
  alias_of?: string;
  annotation?: Annotation;
  classified_by?: string;
}
interface Db {
  collected_on: string;
  counts: Record<string, number>;
  entries: Entry[];
}

const verdictLabels: Record<Verdict, string> = {
  accepted: 'Accepted',
  alias: 'Variant',
  existing: 'Already in dictionary',
  rejected: 'Rejected',
  unclassified: 'Not yet classified',
};
const verdictHelp: Record<Verdict, string> = {
  accepted: 'Meets the criteria and was added to the face dictionary.',
  alias:
    'Meets the criteria but is a near-duplicate, so it is recognized as an alternate spelling.',
  existing: 'This exact face was already in the dictionary.',
  rejected: 'Does not fit an automatic, general-audience chat converter.',
  unclassified: 'Waiting for a classifier.',
};
export const reasonLabels: Record<string, string> = {
  emoji_only: 'Only emoji',
  emoji_heavy: 'Emoji carry the meaning',
  sexual: 'Sexual or bodily',
  hostile: 'Hostile or rude',
  violence: 'Violence or weapons',
  substances: 'Drugs, smoking or alcohol',
  self_harm: 'Self-harm',
  identity_label: 'Flag or identity label',
  words: 'Contains words',
  fancy_text: 'Stylized text',
  not_a_face: 'Not a face',
  too_large: 'Too large',
  no_fitting_intent: 'No fitting mood',
  broken: 'Broken or garbled',
};
const eligibilityLabels: Record<string, string> = {
  auto: 'Automatic — when the detected mood matches',
  explicit: 'Only when you pick the mood yourself',
  sleep_cue: 'Only when the sentence mentions bed, sleep or night',
  hug_cue: 'Only when the sentence mentions a hug',
  mishap_cue: 'Only after a small mistake (oops, typo, wrong channel)',
  affection_cue: 'Only with “love you” and similar',
  comfort_intent: 'Only when the sentence offers comfort',
  reference: 'Recognized in input, never inserted',
};
const warningLabels: Record<string, string> = {
  rare_script: 'Uses rare characters that may not display on every device',
  many_combining_marks: 'Stacks many combining marks',
  invisible_characters: 'Contains invisible characters',
};
const siteNames: Record<string, string> = { emojidb: 'emojidb.org', 'kaomoji.ru': 'Kaomoji.ru' };
const sourceUrl = (s: Source) =>
  s.site === 'emojidb' ? `https://emojidb.org/${s.page}-emojis` : `http://kaomoji.ru/en/#${s.page}`;
const PAGE = 240;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const words = (s: string) => s.replaceAll('_', ' ');

let db: Db | undefined;
let loading: Promise<void> | undefined;
let byId = new Map<string, Entry>();
let variants = new Map<string, Entry[]>();
const dictionaryEntryFor = new Map(
  dictionary.entries.flatMap((e) =>
    'candidate_id' in e && typeof e.candidate_id === 'string' ? [[e.candidate_id, e]] : [],
  ),
);
let shown = PAGE;
let copyText: (text: string, button: HTMLButtonElement) => Promise<void>;

function option(value: string, label: string) {
  return el('option', { value, textContent: label });
}

function fillFilters(entries: Entry[]) {
  const count = (pick: (e: Entry) => string[]) => {
    const counts = new Map<string, number>();
    for (const e of entries) for (const k of pick(e)) counts.set(k, (counts.get(k) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]);
  };
  $('wiki-reason').append(
    ...count((e) => e.reasons ?? []).map(([k, n]) => option(k, `${reasonLabels[k] ?? k} (${n})`)),
  );
  $('wiki-intent').append(
    ...count((e) => e.annotation?.intents ?? []).map(([k, n]) => option(k, `${words(k)} (${n})`)),
  );
  $('wiki-eligibility').append(
    ...count((e) => (e.annotation ? [e.annotation.eligibility] : [])).map(([k, n]) =>
      option(k, `${words(k)} (${n})`),
    ),
  );
  $('wiki-source').append(
    ...count((e) => [...new Set(e.sources.map((s) => `${s.site}:${s.page}`))]).map(([k, n]) =>
      option(
        k,
        `${k.replace('emojidb:', 'emojidb · ').replace('kaomoji.ru:', 'kaomoji.ru · ')} (${n})`,
      ),
    ),
  );
}

function drawStats() {
  const stats = $('wiki-stats');
  stats.replaceChildren();
  const verdict = ($('wiki-verdict') as HTMLSelectElement).value;
  for (const v of ['all', 'accepted', 'alias', 'existing', 'rejected', 'unclassified'] as const) {
    const n = v === 'all' ? db!.entries.length : (db!.counts[v] ?? 0);
    if (!n) continue;
    const button = el(
      'button',
      { type: 'button', className: `wiki-stat verdict-${v}` },
      el('strong', { textContent: n.toLocaleString('en') }),
      v === 'all' ? 'All faces' : verdictLabels[v],
    );
    button.setAttribute('aria-pressed', String(verdict === v));
    button.addEventListener('click', () => {
      ($('wiki-verdict') as HTMLSelectElement).value = v;
      reset();
    });
    stats.append(button);
  }
}

function matches(e: Entry) {
  const value = (id: string) => ($(id) as HTMLSelectElement).value;
  const term = ($('wiki-search') as HTMLInputElement).value.trim().toLowerCase();
  const verdict = value('wiki-verdict'),
    reason = value('wiki-reason'),
    intent = value('wiki-intent'),
    eligibility = value('wiki-eligibility'),
    source = value('wiki-source');
  if (verdict !== 'all' && e.verdict !== verdict) return false;
  if (reason !== 'all' && !e.reasons?.includes(reason)) return false;
  if (intent !== 'all' && !e.annotation?.intents.includes(intent)) return false;
  if (eligibility !== 'all' && e.annotation?.eligibility !== eligibility) return false;
  if (source !== 'all' && !e.sources.some((s) => `${s.site}:${s.page}` === source)) return false;
  if (!term) return true;
  const a = e.annotation;
  return [
    e.text,
    e.id,
    e.note,
    ...(e.reasons ?? []).flatMap((r) => [r, reasonLabels[r]]),
    ...(a ? [...a.meanings, ...a.intents, a.use_when, a.note] : []),
  ]
    .join(' ')
    .toLowerCase()
    .includes(term);
}

function summary(e: Entry) {
  if (e.verdict === 'rejected')
    return (e.reasons ?? []).map((r) => reasonLabels[r] ?? r).join(' · ');
  if (e.verdict === 'existing') return `In dictionary: ${words(e.existing_id!)}`;
  if (e.annotation) return e.annotation.meanings.slice(0, 2).join(' · ');
  return verdictLabels[e.verdict];
}

function draw() {
  if (!db) return;
  drawStats();
  const entries = db.entries.filter(matches);
  const grid = $('wiki-grid');
  grid.replaceChildren(
    ...entries.slice(0, shown).map((e) => {
      const tile = el(
        'button',
        { type: 'button', className: `wiki-tile verdict-${e.verdict}` },
        el('span', { className: 'wiki-face', textContent: e.text }),
        el('span', { className: 'wiki-tile-verdict', textContent: verdictLabels[e.verdict] }),
        el('span', { className: 'wiki-tile-summary', textContent: summary(e) }),
      );
      tile.addEventListener('click', () => open(e.id));
      return tile;
    }),
  );
  $('wiki-count').textContent =
    `${entries.length.toLocaleString('en')} ${entries.length === 1 ? 'face' : 'faces'}`;
  $('wiki-empty').hidden = entries.length > 0;
  const more = $<HTMLButtonElement>('wiki-more');
  more.hidden = entries.length <= shown;
  more.textContent = `Show more (${(entries.length - shown).toLocaleString('en')} left)`;
}

function reset() {
  shown = PAGE;
  draw();
}

function row(label: string, ...value: (Node | string)[]) {
  return el(
    'div',
    { className: 'wiki-row' },
    el('dt', { textContent: label }),
    el('dd', {}, ...value),
  );
}

function faceLink(e: Entry) {
  const button = el('button', { type: 'button', className: 'wiki-face-link', textContent: e.text });
  button.addEventListener('click', () => open(e.id));
  return button;
}

function open(id: string) {
  const e = byId.get(id);
  if (!e) return;
  if (location.hash !== `#wiki/${id}`) history.replaceState(null, '', `#wiki/${id}`);
  const dialog = $<HTMLDialogElement>('wiki-dialog');
  const promoted = dictionaryEntryFor.get(e.id);
  const inserted = promoted?.text ?? e.text;
  const copy = el('button', { type: 'button', className: 'face-copy', textContent: 'Copy' });
  copy.addEventListener('click', () => void copyText(inserted, copy));
  const details = el('dl', { className: 'wiki-details' });
  details.append(
    row(
      'Verdict',
      el('span', {
        className: `wiki-badge verdict-${e.verdict}`,
        textContent: verdictLabels[e.verdict],
      }),
      ' ',
      verdictHelp[e.verdict],
    ),
  );
  if (e.reasons?.length)
    details.append(row('Why', e.reasons.map((r) => reasonLabels[r] ?? r).join(', ')));
  if (e.note) details.append(row('Note', e.note));
  if (e.existing_id) details.append(row('Dictionary entry', words(e.existing_id)));
  if (e.alias_of) {
    const canonical = byId.get(e.alias_of);
    details.append(
      row('Variant of', canonical ? faceLink(canonical) : `${words(e.alias_of)} (existing face)`),
    );
  }
  if (promoted) details.append(row('Dictionary entry', words(promoted.id)));
  // Stray quotes and invisible fillers are removed before a face is inserted.
  if (inserted !== e.text) details.append(row('Inserted as', inserted));
  const group = variants.get(e.id);
  if (group?.length) details.append(row('Variants', ...group.map(faceLink)));
  const a = e.annotation;
  if (a) {
    details.append(
      row('Meanings', a.meanings.join(' · ')),
      row('Moods', a.intents.map(words).join(', ')),
      row('Inserted', eligibilityLabels[a.eligibility] ?? a.eligibility),
      row(
        'Intensity',
        ['', 'Restrained', 'Expressive', 'Emphatic'][a.intensity] ?? String(a.intensity),
      ),
      row('Styles', a.styles.join(', ')),
      row('Use when', a.use_when),
      row('Avoid when', a.avoid_when),
      row(
        'Example',
        el('span', { className: 'face-example', textContent: `${a.example_input} ${inserted}` }),
      ),
    );
    if (a.proposed_intent) details.append(row('Suggested new mood', words(a.proposed_intent)));
    if (a.note) details.append(row('Classifier note', a.note));
  }
  if (e.warnings?.length)
    details.append(row('Warnings', e.warnings.map((w) => warningLabels[w] ?? w).join('; ')));
  const sources = el('ul', { className: 'wiki-sources' });
  for (const s of e.sources)
    sources.append(
      el(
        'li',
        {},
        el('a', {
          href: sourceUrl(s),
          target: '_blank',
          rel: 'noopener noreferrer',
          textContent: `${siteNames[s.site] ?? s.site} · ${words(s.page)}`,
        }),
        ` · #${s.position + 1}`,
      ),
    );
  details.append(
    row('Found on', sources),
    row(
      'Characters',
      el('code', {
        textContent: [...e.text]
          .map((c) => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0'))
          .join(' '),
      }),
    ),
    row(
      'Classified by',
      e.classified_by === 'haiku'
        ? 'Claude Haiku (subagent)'
        : e.classified_by === 'script'
          ? 'Intake script'
          : e.classified_by === 'reviewer'
            ? 'Manual review override'
            : '—',
    ),
  );
  const close = el('button', {
    type: 'button',
    className: 'text-button wiki-close',
    textContent: 'Close',
  });
  close.addEventListener('click', () => dialog.close());
  dialog.replaceChildren(
    el(
      'div',
      { className: 'face-top' },
      el('span', { className: 'wiki-dialog-face', textContent: e.text }),
      copy,
    ),
    details,
    close,
  );
  if (!dialog.open) dialog.showModal();
}

async function load() {
  const status = $('wiki-count');
  status.textContent = 'Loading…';
  try {
    const response = await fetch(dbUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    db = (await response.json()) as Db;
  } catch (error) {
    status.textContent = `Could not load the wiki (${error instanceof Error ? error.message : error}).`;
    loading = undefined;
    return;
  }
  byId = new Map(db.entries.map((e) => [e.id, e]));
  variants = new Map();
  for (const e of db.entries)
    if (e.alias_of && byId.has(e.alias_of)) {
      if (!variants.has(e.alias_of)) variants.set(e.alias_of, []);
      variants.get(e.alias_of)!.push(e);
    }
  $('wiki-collected').textContent = new Date(db.collected_on + 'T00:00:00').toLocaleDateString(
    'en',
    { year: 'numeric', month: 'long', day: 'numeric' },
  );
  $('wiki-total').textContent = db.entries.length.toLocaleString('en');
  fillFilters(db.entries);
  draw();
}

/** Shows the wiki, loading the DB on first use; `#wiki/<id>` opens that entry. */
export async function showWiki(copy: typeof copyText) {
  copyText = copy;
  loading ??= load();
  await loading;
  const id = location.hash.split('/')[1];
  if (id) open(decodeURIComponent(id));
}

let timer: ReturnType<typeof setTimeout> | undefined;
$('wiki-search').addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(reset, 150);
});
for (const id of ['wiki-verdict', 'wiki-reason', 'wiki-intent', 'wiki-eligibility', 'wiki-source'])
  $(id).addEventListener('change', reset);
$('wiki-more').addEventListener('click', () => {
  shown += PAGE;
  draw();
});
$<HTMLDialogElement>('wiki-dialog').addEventListener('close', () => {
  if (location.hash.startsWith('#wiki/')) history.replaceState(null, '', '#wiki');
});
