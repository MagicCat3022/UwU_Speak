// Builds the emoticon candidate DB from emojidb.org searches and kaomoji.ru.
// Criteria: docs/emoticon-criteria.md. Usage:
//   node scripts/emoticon-candidates.ts collect   download (cached), dedupe, pre-screen, write batches
//   node scripts/emoticon-candidates.ts merge     validate classifier results → data/emoticon-candidates.json
//   node scripts/emoticon-candidates.ts promote   add accepted faces to data/emoticons.json
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import dictionary from '../data/emoticons.json' with { type: 'json' };
// Hand-curated faces only: entries promoted from an earlier intake run must not match themselves.
const curated = dictionary.entries.filter((e) => !('origin' in e) || e.origin !== 'intake');

const cacheDir = resolve('.cache/emoticon-sources');
const workDir = resolve('.cache/emoticon-review');
const dbPath = resolve('data/emoticon-candidates.json');
const BATCH = 100;

export const emojidbSearches = [
  'femboy',
  'uwu',
  'owo',
  'kawaii',
  'kaomoji',
  'cat',
  'nya',
  'blush',
  'shy',
  'hug',
  'pat',
  'happy',
  'excited',
  'love',
  'sad',
  'cry',
  'angry',
  'sleepy',
  'confused',
];
export const intents = [...new Set(dictionary.entries.flatMap((e) => e.intents))].sort();
export const rejectCodes = [
  'emoji_only',
  'emoji_heavy',
  'sexual',
  'hostile',
  'violence',
  'substances',
  'self_harm',
  'identity_label',
  'words',
  'fancy_text',
  'not_a_face',
  'too_large',
  'no_fitting_intent',
  'broken',
];
export const eligibilities = [
  'auto',
  'explicit',
  'sleep_cue',
  'hug_cue',
  'mishap_cue',
  'affection_cue',
  'comfort_intent',
  'reference',
];

interface Source {
  site: 'emojidb' | 'kaomoji.ru';
  page: string;
  position: number;
}
interface Candidate {
  id: string;
  text: string;
  graphemes: number;
  hasEmoji: boolean;
  warnings: string[];
  sources: Source[];
  prescreen?: { verdict: 'rejected' | 'existing'; reasons?: string[]; existingId?: string };
}
interface Classification {
  id: string;
  verdict: 'accept' | 'reject';
  reasons?: string[];
  intents?: string[];
  meanings?: string[];
  intensity?: number;
  styles?: string[];
  kind?: string;
  eligibility?: string;
  use_when?: string;
  avoid_when?: string;
  example_input?: string;
  proposed_intent?: string;
  note?: string;
  /** Set in hand-written override files (results/review-*.json). */
  by?: 'reviewer';
}

const countBy = <T>(items: T[], key: (item: T) => string) =>
  items.reduce<Record<string, number>>(
    (acc, x) => ((acc[key(x)] = (acc[key(x)] ?? 0) + 1), acc),
    {},
  );
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
const graphemes = (s: string) => [...segmenter.segment(s)].length;
const emoji = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}]/u;
const emojiParts =
  /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u200d\ufe0f\u20e3\s]/gu;
const idFor = (text: string) => 'c' + createHash('sha256').update(text).digest('hex').slice(0, 8);
const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    // Some entries are double-encoded, so numeric entities survive the first pass.
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
// Zero-width spaces, BOMs and direction marks are copy-paste artifacts, not part of a face.
const clean = (s: string) =>
  decode(s)
    .replace(/[\u200b\u200e\u200f\ufeff]/g, '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim();

async function cached(file: string, url: string): Promise<string> {
  const path = join(cacheDir, file);
  if (existsSync(path)) return readFile(path, 'utf8');
  await sleep(2000); // be gentle with small community sites
  const res = await fetch(url, { headers: { 'user-agent': 'UwU_Speak emoticon research' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const html = await res.text();
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, html);
  return html;
}

function warningsFor(text: string): string[] {
  const warnings: string[] = [];
  // Supplementary-plane letters outside emoji and math alphanumerics often lack fonts on Windows.
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (
      cp > 0xffff &&
      !emoji.test(ch) &&
      !(cp >= 0x1d400 && cp <= 0x1d7ff) &&
      !(cp >= 0x1f3fb && cp <= 0x1f3ff)
    ) {
      warnings.push('rare_script');
      break;
    }
  }
  if ((text.match(/\p{M}/gu) ?? []).length > 6) warnings.push('many_combining_marks');
  if (
    /[\u200b-\u200d\u2060\u3164\u115f\u2800]/u.test(
      text.replace(/\u200d(?=\p{Extended_Pictographic})/gu, ''),
    )
  )
    warnings.push('invisible_characters');
  return warnings;
}

async function collect() {
  const found = new Map<string, Source[]>();
  const add = (raw: string, source: Source) => {
    const text = clean(raw);
    if (!text) return;
    if (!found.has(text)) found.set(text, []);
    found.get(text)!.push(source);
  };
  for (const page of emojidbSearches) {
    const html = await cached(`emojidb/${page}.html`, `https://emojidb.org/${page}-emojis`);
    let position = 0;
    for (const m of html.matchAll(/class="emoji"[^>]*>([\s\S]*?)<\/div>/g))
      add(m[1], { site: 'emojidb', page, position: position++ });
  }
  const html = await cached('kaomoji.ru/en.html', 'http://kaomoji.ru/en/');
  let page = '',
    position = 0;
  for (const m of html.matchAll(/<a name="([^"]+)">|<td><span>([\s\S]*?)<\/span><\/td>/g)) {
    if (m[1]) [page, position] = [m[1], 0];
    else add(m[2], { site: 'kaomoji.ru', page, position: position++ });
  }

  const existing = new Map(
    curated.flatMap((e) => [e.text, ...e.aliases].map((t) => [t.normalize('NFC'), e.id])),
  );
  const candidates: Candidate[] = [...found]
    .map(([text, sources]) => {
      const c: Candidate = {
        id: idFor(text),
        text,
        graphemes: graphemes(text),
        hasEmoji: emoji.test(text),
        warnings: warningsFor(text),
        sources,
      };
      if (existing.has(text)) c.prescreen = { verdict: 'existing', existingId: existing.get(text) };
      else if (!text.replace(emojiParts, ''))
        c.prescreen = { verdict: 'rejected', reasons: ['emoji_only'] };
      else if (c.graphemes > 40 || /\n/.test(text))
        c.prescreen = { verdict: 'rejected', reasons: ['too_large'] };
      return c;
    })
    .sort((a, b) => (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));

  await mkdir(join(workDir, 'batches'), { recursive: true });
  await mkdir(join(workDir, 'results'), { recursive: true });
  await writeFile(join(workDir, 'candidates.json'), JSON.stringify(candidates, null, 1));
  const pending = candidates.filter((c) => !c.prescreen);
  const batches = Math.ceil(pending.length / BATCH);
  for (let i = 0; i < batches; i++) {
    const batch = pending.slice(i * BATCH, (i + 1) * BATCH).map((c) => ({
      id: c.id,
      text: c.text,
      code_points: [...c.text]
        .map((ch) => 'U+' + ch.codePointAt(0)!.toString(16).toUpperCase())
        .join(' '),
      has_emoji: c.hasEmoji,
      warnings: c.warnings,
      found_in: [...new Set(c.sources.map((s) => `${s.site}:${s.page}`))],
    }));
    await writeFile(
      join(workDir, 'batches', `batch-${String(i + 1).padStart(2, '0')}.json`),
      JSON.stringify(batch, null, 1),
    );
  }
  const counts = countBy(candidates, (c) => c.prescreen?.verdict ?? 'to classify');
  console.log(`${candidates.length} unique candidates:`, counts);
  console.log(`${batches} batches of up to ${BATCH} in ${join(workDir, 'batches')}`);
}

// Faces that differ only in spacing, blush marks or a trailing heart/sparkle are one entry.
// A lone leading double quote is a scraping artifact (a trailing one is usually a sweat drop).
const strayQuote = (text: string) =>
  text.startsWith('"') && (text.match(/"/g) ?? []).length % 2 === 1;
// Text inserted into messages: no stray quote and no invisible fillers (ZWJ stays for emoji).
const tidy = (text: string) =>
  (strayQuote(text) ? text.slice(1) : text)
    .replace(/[\u2060\u200b\u200c\u00ad\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/[\u2800\u3164\u115f]/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
const skeleton = (text: string) =>
  (strayQuote(text) ? text.slice(1) : text)
    .normalize('NFKC')
    .replace(/[\s\u200e\u200f\ufe0f⸝˶˵,]/g, '')
    .replace(/^[♡♥❤✧✦⋆✨💕~～]+|[♡♥❤✧✦⋆✨💕~～]+$/gu, '');

function problems(r: Classification): string[] {
  const p: string[] = [];
  if (r.verdict === 'reject') {
    if (!r.reasons?.length || r.reasons.some((x) => !rejectCodes.includes(x))) p.push('reasons');
    return p;
  }
  if (r.verdict !== 'accept') return ['verdict'];
  if (!r.intents?.length || r.intents.length > 3 || r.intents.some((i) => !intents.includes(i)))
    p.push('intents');
  if (!r.meanings?.length || r.meanings.some((m) => typeof m !== 'string' || !m))
    p.push('meanings');
  if (![1, 2, 3].includes(r.intensity!)) p.push('intensity');
  if (!r.styles?.length || r.styles.some((s) => !['uwu', 'nya', 'classic'].includes(s)))
    p.push('styles');
  if (!['emoticon', 'kaomoji'].includes(r.kind!)) p.push('kind');
  if (!eligibilities.includes(r.eligibility!)) p.push('eligibility');
  for (const f of ['use_when', 'avoid_when', 'example_input'] as const)
    if (!r[f]?.trim()) p.push(f);
  return p;
}

const popularity = (c: Candidate) =>
  c.sources.length * 1000 - Math.min(...c.sources.map((s) => s.position));

async function merge() {
  const candidates: Candidate[] = JSON.parse(
    await readFile(join(workDir, 'candidates.json'), 'utf8'),
  );
  const results = new Map<string, Classification>();
  const issues: string[] = [];
  // Files are read in name order, so recheck-NN.json overrides a batch verdict and
  // review-*.json (hand-written overrides) overrides both.
  for (const file of (await readdir(join(workDir, 'results'))).sort()) {
    const rows: Classification[] = JSON.parse(
      await readFile(join(workDir, 'results', file), 'utf8'),
    );
    for (const r of rows) {
      const p = problems(r);
      if (p.length) issues.push(`${file} ${r.id}: invalid ${p.join(', ')}`);
      else results.set(r.id, r);
    }
  }
  const missing = candidates.filter((c) => !c.prescreen && !results.has(c.id));
  for (const c of missing) issues.push(`missing ${c.id}`);

  const existingSkeletons = new Map(
    curated.flatMap((e) => [e.text, ...e.aliases].map((t) => [skeleton(t), e.id])),
  );
  const accepted = candidates
    .filter((c) => results.get(c.id)?.verdict === 'accept')
    .sort(
      (a, b) =>
        Number(strayQuote(a.text)) - Number(strayQuote(b.text)) ||
        popularity(b) - popularity(a) ||
        a.graphemes - b.graphemes,
    );
  const canonical = new Map<string, string>();
  const entries = candidates.map((c) => {
    const r = results.get(c.id);
    const base = {
      id: c.id,
      text: c.text,
      sources: c.sources,
      ...(c.warnings.length ? { warnings: c.warnings } : {}),
    };
    if (c.prescreen?.verdict === 'existing')
      return {
        ...base,
        verdict: 'existing',
        existing_id: c.prescreen.existingId,
        classified_by: 'script',
      };
    if (c.prescreen)
      return {
        ...base,
        verdict: 'rejected',
        reasons: c.prescreen.reasons,
        classified_by: 'script',
      };
    if (!r) return { ...base, verdict: 'unclassified' };
    if (r.verdict === 'reject')
      return {
        ...base,
        verdict: 'rejected',
        reasons: r.reasons,
        ...(r.note ? { note: r.note } : {}),
        classified_by: r.by ?? 'haiku',
      };
    return {
      ...base,
      verdict: 'accepted',
      annotation: { ...r, id: undefined, verdict: undefined, by: undefined },
      classified_by: r.by ?? 'haiku',
    };
  });
  // Group near-duplicates: an existing dictionary face wins, then the most popular spelling.
  for (const c of accepted) {
    const key = skeleton(c.text);
    const entry = entries.find((e) => e.id === c.id)!;
    const existingId = existingSkeletons.get(key);
    if (existingId) Object.assign(entry, { verdict: 'alias', alias_of: existingId });
    else if (canonical.has(key))
      Object.assign(entry, { verdict: 'alias', alias_of: canonical.get(key) });
    else canonical.set(key, c.id);
  }
  const db = {
    description:
      'Every collected emoticon candidate with its intake verdict. Criteria: docs/emoticon-criteria.md. Generated by scripts/emoticon-candidates.ts.',
    collected_on: new Date().toISOString().slice(0, 10),
    sources: [
      ...emojidbSearches.map((q) => ({
        id: `emojidb_${q}`,
        title: `emojidb.org: ${q} emojis`,
        url: `https://emojidb.org/${q}-emojis`,
      })),
      { id: 'kaomoji_ru', title: 'Kaomoji.ru: Japanese emoticons', url: 'http://kaomoji.ru/en/' },
    ],
    reject_codes: rejectCodes,
    counts: countBy(entries, (e) => e.verdict),
    entries,
  };
  await writeFile(dbPath, JSON.stringify(db, null, 1) + '\n');
  console.log('Wrote', dbPath, db.counts);
  if (issues.length) {
    await writeFile(join(workDir, 'issues.txt'), issues.join('\n'));
    console.log(
      `${issues.length} issues (see ${join(workDir, 'issues.txt')}):\n` +
        issues.slice(0, 20).join('\n'),
    );
  }
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 24);

async function promote() {
  const db = JSON.parse(await readFile(dbPath, 'utf8'));
  const dict = JSON.parse(await readFile('data/emoticons.json', 'utf8'));
  dict.entries = dict.entries.filter((e: { origin?: string }) => e.origin !== 'intake');
  for (const s of db.sources)
    if (!dict.sources.some((x: { id: string }) => x.id === s.id))
      dict.sources.push({
        ...s,
        supports: 'Conventional spelling of collected faces; meanings and tags are editorial.',
      });
  const sourceIds = (sources: Source[]) =>
    [
      ...new Set(sources.map((s) => (s.site === 'emojidb' ? `emojidb_${s.page}` : 'kaomoji_ru'))),
    ].sort();
  const aliases = new Map<string, { text: string; sources: Source[] }[]>();
  for (const e of db.entries.filter((e: { verdict: string }) => e.verdict === 'alias')) {
    if (!aliases.has(e.alias_of)) aliases.set(e.alias_of, []);
    aliases.get(e.alias_of)!.push(e);
  }
  // Near-duplicates of existing faces become their aliases (recognized in input, never inserted).
  // Earlier intake aliases are removed first so promote can be rerun.
  const intakeTexts = new Set(db.entries.map((e: { text: string }) => e.text));
  for (const entry of dict.entries) {
    entry.aliases = entry.aliases.filter((t: string) => !intakeTexts.has(t) || t === entry.text);
    for (const a of aliases.get(entry.id) ?? [])
      if (a.text !== entry.text && !entry.aliases.includes(a.text)) entry.aliases.push(a.text);
  }
  const ids = new Set(dict.entries.map((e: { id: string }) => e.id));
  // Every spelling belongs to exactly one entry.
  const owner = new Map<string, { aliases: string[] }>();
  for (const entry of dict.entries)
    for (const t of [entry.text, ...entry.aliases]) owner.set(t, entry);
  for (const e of db.entries.filter((e: { verdict: string }) => e.verdict === 'accepted')) {
    const a = e.annotation as Classification;
    const group = aliases.get(e.id) ?? [];
    // The scraped spelling stays recognizable as an alias when tidying changed it.
    const text = tidy(e.text);
    const spellings = [e.text, ...group.map((g) => g.text)].filter((t) => t !== text);
    // Tidying can turn a face into one that is already in the dictionary.
    const existing = owner.get(text);
    if (existing) {
      for (const t of spellings)
        if (!owner.has(t)) (existing.aliases.push(t), owner.set(t, existing));
      continue;
    }
    let id = `${slug(a.meanings![0])}_${e.id.slice(1, 5)}`;
    if (ids.has(id)) id += e.id.slice(5);
    ids.add(id);
    const entry = {
      id,
      text,
      aliases: spellings.filter((t) => !owner.has(t)),
      kind: a.kind,
      meanings: a.meanings,
      intents: a.intents,
      intensity: a.intensity,
      styles: a.styles,
      selection: a.eligibility === 'explicit' ? 'explicit' : 'contextual',
      eligibility: a.eligibility,
      placement: ['sentence_end'],
      use_when: a.use_when,
      avoid_when: a.avoid_when,
      example: { input: a.example_input, output: `${a.example_input} ${text}` },
      source_ids: sourceIds([...e.sources, ...group.flatMap((g) => g.sources)]),
      origin: 'intake',
      candidate_id: e.id,
    };
    for (const t of [text, ...entry.aliases]) owner.set(t, entry);
    dict.entries.push(entry);
  }
  dict.version = '0.2.0';
  await writeFile('data/emoticons.json', JSON.stringify(dict, null, 2) + '\n');
  console.log(`Dictionary now has ${dict.entries.length} entries.`);
}

const command = process.argv[2];
if (command === 'collect') await collect();
else if (command === 'merge') await merge();
else if (command === 'promote') await promote();
else console.log('Usage: node scripts/emoticon-candidates.ts collect | merge | promote');
