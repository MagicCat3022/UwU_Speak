import { graphemeSegments } from 'unicode-segmenter/grapheme';
import { isAlphanumeric } from 'unicode-segmenter/general';
import dictionary from '../../data/emoticons.json' with { type: 'json' };
import vocabulary from '../../data/vocabulary.json' with { type: 'json' };
import type { ProtectedSpan, ResolvedOptions } from './types.js';

export interface Token {
  start: number;
  end: number;
  text: string;
  kind: 'word' | 'space' | 'punct' | 'protected';
  quoted: boolean;
  reasons: string[];
  hyphenated: boolean;
}
export interface Sentence {
  tokens: Token[];
  start: number;
  end: number;
  uncertain: boolean;
  existingEnding: boolean;
}
interface Range {
  start: number;
  end: number;
  reasons: string[];
}
// Every dictionary spelling, longest first, indexed by its first two code units (or its only
// one) so the scan only tries faces that can start at a given position.
const faceSpellings = [...new Set(dictionary.entries.flatMap((e) => [e.text, ...e.aliases]))].sort(
  (a, b) => b.length - a.length,
);
const faceStarts = new Map<string, number[]>();
faceSpellings.forEach((face, i) => {
  const key = face.slice(0, 2);
  faceStarts.set(key, [...(faceStarts.get(key) ?? []), i]);
});
const destinations = new Set([
  ...Object.values(vocabulary.words),
  ...Object.values(vocabulary.nyaWords),
]);
const alpha = (s: string) => !!s && (isAlphanumeric(s.codePointAt(0)!) || s === '_');
const space = (s: string) => /^\s+$/.test(s);
export function validCase(word: string): boolean {
  const letters = word.replace(/['’]/g, '');
  return (
    letters === letters.toLowerCase() ||
    letters === letters.toUpperCase() ||
    /^[A-Z][a-z]*$/.test(letters)
  );
}
export function splitSuffix(word: string): [string, string] {
  const match = word.match(/(['’][sS]|(?<=[sS])['’])$/);
  return match ? [word.slice(0, -match[0].length), match[0]] : [word, ''];
}
function merge(ranges: Range[]): Range[] {
  const result: Range[] = [];
  for (const r of ranges.sort((a, b) => a.start - b.start || b.end - a.end)) {
    const last = result.at(-1);
    if (last && r.start < last.end) {
      last.end = Math.max(last.end, r.end);
      last.reasons = [...new Set([...last.reasons, ...r.reasons])];
    } else result.push({ ...r, reasons: [...r.reasons] });
  }
  return result;
}
export function tokenize(
  text: string,
  options: ResolvedOptions,
): { tokens: Token[]; protectedSpans: ProtectedSpan[]; ambiguous: Set<number> } {
  const clusters = [...graphemeSegments(text)].map((g) => ({
    start: g.index,
    end: g.index + g.segment.length,
    text: g.segment,
  }));
  const floor = new Int32Array(text.length + 1),
    ceil = new Int32Array(text.length + 1);
  for (const g of clusters)
    for (let p = g.start; p < g.end; p++) {
      floor[p] = g.start;
      ceil[p] = p === g.start ? p : g.end;
    }
  floor[text.length] = ceil[text.length] = text.length;
  const ranges: Range[] = [],
    occupied = new Uint8Array(text.length),
    quoted = new Uint8Array(text.length),
    ambiguous = new Set<number>();
  const boundary = (start: number, end: number, value: string) =>
    !(alpha(value[0]) && start > 0 && alpha(text.slice(floor[start - 1], start))) &&
    !(alpha(value.at(-1) ?? '') && end < text.length && alpha(text.slice(end, end + 2)));
  function add(start: number, end: number, reason: string, occupy = false) {
    start = floor[start];
    end = ceil[end];
    if (end <= start) return;
    ranges.push({ start, end, reasons: [reason] });
    if (occupy) occupied.fill(1, start, end);
  }
  // Fences are scanned linearly, including an unclosed final block.
  const lines = [...text.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)].filter((m) => m[0]);
  let fence: { start: number; char: string; length: number } | undefined;
  for (const line of lines) {
    const marker = line[0].match(/^ {0,3}(`{3,}|~{3,})/);
    if (!fence && marker)
      fence = { start: line.index, char: marker[1][0], length: marker[1].length };
    else if (
      fence &&
      marker &&
      marker[1][0] === fence.char &&
      marker[1].length >= fence.length &&
      /^\s*$/.test(line[0].slice(marker[0].length))
    ) {
      add(fence.start, line.index + line[0].replace(/[\r\n]+$/, '').length, 'code', true);
      fence = undefined;
    }
  }
  if (fence) add(fence.start, text.length, 'code', true);
  const inline = /`+/g;
  for (let m; (m = inline.exec(text));) {
    if (occupied[m.index]) continue;
    const end = text.indexOf(m[0], inline.lastIndex);
    if (end >= 0 && !/[\r\n]/.test(text.slice(inline.lastIndex, end))) {
      add(m.index, end + m[0].length, 'code', true);
      inline.lastIndex = end + m[0].length;
    } else {
      add(m.index, m.index + m[0].length, 'uncertain_code', true);
      ambiguous.add(m.index);
    }
  }
  const scan = (regex: RegExp, reason: string, trim = false) => {
    for (const m of text.matchAll(regex)) {
      if (occupied[m.index]) continue;
      let value = m[0];
      if (trim) {
        value = value.replace(/[.,!?;:]+$/, '');
        for (const [open, close] of [
          ['(', ')'],
          ['[', ']'],
          ['{', '}'],
        ]) {
          let balance = 0;
          for (const c of value) {
            if (c === open) balance++;
            if (c === close) balance--;
          }
          while (balance < 0 && value.endsWith(close)) {
            value = value.slice(0, -1);
            balance++;
          }
        }
        value = value.replace(/[.,!?;:]+$/, '');
      }
      if (boundary(m.index, m.index + value.length, value))
        add(m.index, m.index + value.length, reason, true);
    }
  };
  scan(/(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>"`]+/gi, 'url', true);
  // Start at delimiters, not a greedy local-part search at every character of a long word.
  for (const m of text.matchAll(/@/g)) {
    if (occupied[m.index]) continue;
    let start = m.index,
      end = m.index + 1;
    while (start > 0 && /[a-z0-9.!#$%&'*+/=?^_`{|}~-]/i.test(text[start - 1])) start--;
    while (end < text.length && /[a-z0-9.-]/i.test(text[end])) end++;
    while (text[end - 1] === '.') end--;
    if (
      start < m.index &&
      /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(text.slice(m.index + 1, end)) &&
      boundary(start, end, text.slice(start, end))
    )
      add(start, end, 'email', true);
  }
  scan(/(?:[A-Za-z]:[\\/]|\\\\|(?:\.{1,2}|~)?\/)[^\s<>"`]+/g, 'path', true);
  scan(/@[a-z0-9_][a-z0-9_.-]*/gi, 'handle', true);
  for (const m of text.matchAll(
    /\.(?:txt|md|json|jsx?|tsx?|py|html|css|csv|yaml|yml|toml)(?![a-z0-9])/gi,
  )) {
    if (occupied[m.index]) continue;
    let start = m.index;
    while (start > 0 && /[a-z0-9_-]/i.test(text[start - 1])) start--;
    const end = m.index + m[0].length;
    if (start < m.index && boundary(start, end, text.slice(start, end)))
      add(start, end, 'filename', true);
  }
  // Literal matching avoids regular-expression injection from custom protected terms.
  for (const term of [...new Set(options.preserveTerms)].sort((a, b) => b.length - a.length)) {
    for (let p = text.indexOf(term); p >= 0; p = text.indexOf(term, p + Math.max(1, term.length))) {
      if (boundary(p, p + term.length, term)) add(p, p + term.length, 'preserve_term');
    }
  }
  // One pass finds every occurrence; claiming them longest face first keeps the outcome
  // independent of where in the text each face appears.
  const hits: number[][] = [];
  for (let p = 0; p < text.length; p++)
    for (const i of [
      ...(faceStarts.get(text.slice(p, p + 2)) ?? []),
      ...(faceStarts.get(text[p]) ?? []),
    ])
      if (text.startsWith(faceSpellings[i], p)) (hits[i] ??= []).push(p);
  hits.forEach((positions, i) => {
    const face = faceSpellings[i];
    let next = 0;
    for (const p of positions) {
      if (p < next) continue;
      next = p + face.length;
      if (!occupied[p] && boundary(p, next, face)) add(p, next, 'existing_face', true);
    }
  });
  scan(/nya+~+/gi, 'existing_particle');
  for (const m of text.matchAll(/\([^()\r\n]{1,64}\)/g)) {
    if (!occupied[m.index] && /[ω▽◡ᴥ╥ಠツᵕ]|[\^][^a-zA-Z]{0,8}[\^]|[><][_\.][><]/.test(m[0])) {
      add(m.index, m.index + m[0].length, 'probable_face', true);
      ambiguous.add(m.index);
    }
  }
  for (const m of text.matchAll(/([a-z])(?:-\1){0,2}-\1[a-z'’]+/gi))
    if (!occupied[m.index] && boundary(m.index, m.index + m[0].length, m[0]))
      add(m.index, m.index + m[0].length, 'existing_word', true);
  // A balanced quote is an attribution scope even when its spelling is editable.
  const quoteClose: Record<string, string> = { '"': '"', '“': '”', "'": "'", '‘': '’' };
  const nextClose: Record<string, number> = { '"': -1, '”': -1, "'": -1, '’': -1 };
  const quoteEnds = new Map<number, number>();
  // Precompute the next eligible closing mark in one pass. Repeated unmatched
  // opening marks must neither trigger quadratic scanning nor consume the document.
  for (let p = text.length - 1; p >= 0; p--) {
    if (occupied[p]) continue;
    const c = text[p];
    if (Object.hasOwn(quoteClose, c)) quoteEnds.set(p, nextClose[quoteClose[c]]);
    if (Object.hasOwn(nextClose, c) && !((c === "'" || c === '’') && alpha(text[p + 1] ?? '')))
      nextClose[c] = p;
  }
  for (let p = 0; p < text.length; p++) {
    if (occupied[p] || !(text[p] in quoteClose)) continue;
    const open = text[p];
    if ((open === "'" || open === '‘') && p > 0 && alpha(text.slice(floor[p - 1], p))) continue;
    const end = quoteEnds.get(p) ?? -1;
    if (end < 0) {
      ambiguous.add(p);
      add(p, p + 1, 'uncertain_quote', true);
      continue;
    }
    quoted.fill(1, p, end + 1);
    if (options.quotedText === 'preserve') add(p, end + 1, 'quoted_text', true);
    else {
      add(p, p + 1, 'quote_mark', true);
      add(end, end + 1, 'quote_mark', true);
    }
    p = end;
  }
  // Identify complete original lexemes before protected ranges can divide them.
  // A custom term such as "_" or a combining mark must not make the remaining
  // pieces of an identifier or Unicode word eligible for spelling changes.
  for (let i = 0; i < clusters.length; i++) {
    if (!alpha(clusters[i].text)) continue;
    const start = clusters[i].start;
    let endIndex = i + 1;
    while (endIndex < clusters.length) {
      const next = clusters[endIndex];
      if (alpha(next.text)) {
        endIndex++;
        continue;
      }
      if (
        (next.text === "'" || next.text === '’') &&
        (alpha(clusters[endIndex + 1]?.text ?? '') || /s$/i.test(clusters[endIndex - 1].text))
      ) {
        endIndex++;
        continue;
      }
      break;
    }
    const end = clusters[endIndex - 1].end,
      word = text.slice(start, end);
    if (!/^[a-z]+(?:['’][a-z]+)*['’]?$/i.test(word) || !validCase(word))
      ranges.push({ start, end, reasons: ['structured_or_unicode_word'] });
    i = endIndex - 1;
  }
  const baseRanges = merge(ranges);
  const tokens: Token[] = [];
  let r = 0;
  for (let i = 0; i < clusters.length;) {
    const g = clusters[i];
    while (r < baseRanges.length && baseRanges[r].end <= g.start) r++;
    const covered = baseRanges[r]?.start <= g.start ? baseRanges[r] : undefined;
    if (covered) {
      tokens.push({
        start: g.start,
        end: covered.end,
        text: text.slice(g.start, covered.end),
        kind: 'protected',
        quoted: !!quoted[g.start],
        reasons: covered.reasons,
        hyphenated: false,
      });
      while (i < clusters.length && clusters[i].start < covered.end) i++;
      continue;
    }
    let endIndex = i + 1,
      kind: Token['kind'] = 'punct',
      reasons: string[] = [];
    if (space(g.text)) {
      kind = 'space';
      while (
        endIndex < clusters.length &&
        space(clusters[endIndex].text) &&
        !(baseRanges[r]?.start < clusters[endIndex].end)
      )
        endIndex++;
    } else if (alpha(g.text)) {
      kind = 'word';
      while (endIndex < clusters.length) {
        const next = clusters[endIndex];
        if (baseRanges[r]?.start < next.end) break;
        if (alpha(next.text)) {
          endIndex++;
          continue;
        }
        if (
          (next.text === "'" || next.text === '’') &&
          (alpha(clusters[endIndex + 1]?.text ?? '') || /s$/i.test(clusters[endIndex - 1].text))
        ) {
          endIndex++;
          continue;
        }
        break;
      }
      const word = text.slice(g.start, clusters[endIndex - 1].end),
        [stem] = splitSuffix(word);
      if (!/^[a-z]+(?:['’][a-z]+)*['’]?$/i.test(word) || !validCase(word))
        reasons = ['structured_or_unicode_word'];
      else if (destinations.has(stem.toLowerCase()) || /^(?:hai{2,}|okie{2,})$/i.test(stem))
        reasons = ['existing_word'];
    } else if (g.text.length > 1 || g.text.codePointAt(0)! > 127) {
      reasons = ['unicode_symbol'];
    }
    const end = clusters[endIndex - 1].end;
    if (reasons.length) {
      kind = 'protected';
      ranges.push({ start: g.start, end, reasons });
    }
    tokens.push({
      start: g.start,
      end,
      text: text.slice(g.start, end),
      kind,
      quoted: !!quoted[g.start],
      reasons,
      hyphenated: text[g.start - 1] === '-' || text[end] === '-',
    });
    i = endIndex;
  }
  return {
    tokens,
    protectedSpans: merge(ranges).map((r) => ({
      inputStart: r.start,
      inputEnd: r.end,
      reasonCodes: r.reasons,
    })),
    ambiguous,
  };
}
const isEnding = (t: Token) =>
  t.reasons.some((r) => ['existing_face', 'existing_particle', 'probable_face'].includes(r));
export function sentences(tokens: Token[], text: string, ambiguous: Set<number>): Sentence[] {
  const output: Sentence[] = [];
  let start = 0,
    pending = false,
    uncertain = false,
    nextUncertain = false;
  const flush = (end: number) => {
    const part = tokens.slice(start, end);
    if (part.some((t) => t.kind !== 'space')) {
      const last = part.findLast((t) => t.kind !== 'space')!;
      output.push({
        tokens: part,
        start: part[0].start,
        end: last.end,
        uncertain,
        existingEnding: part.some(isEnding) || /~[.!?]*$/.test(text.slice(part[0].start, last.end)),
      });
      uncertain = nextUncertain;
      nextUncertain = false;
    }
    start = end;
    pending = false;
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (
      pending &&
      t.kind !== 'space' &&
      !isEnding(t) &&
      !(t.kind === 'punct' && /^[.!?\])}"”]+$/.test(t.text))
    )
      flush(i);
    if (ambiguous.has(t.start) || t.reasons.includes('probable_face')) uncertain = true;
    if (isEnding(t) && i > 0 && /[\r\n]/.test(tokens[i - 1].text)) {
      uncertain = true;
      nextUncertain = true;
    }
    if (t.kind === 'space' && /[\r\n][\t ]*[\r\n]/.test(t.text.replace(/\r\n/g, '\n'))) {
      flush(i + 1);
      continue;
    }
    if (t.quoted || t.kind !== 'punct' || !/[.!?]/.test(t.text)) continue;
    if (t.text === '.') {
      if (/\d/.test(text[t.start - 1] ?? '') && /\d/.test(text[t.end] ?? '')) continue;
      if (
        /\b(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|e\.g|i\.e)\.$/i.test(
          text.slice(Math.max(0, t.start - 7), t.end),
        )
      )
        continue;
      if (/\b[A-Z]\.$/.test(text.slice(Math.max(0, t.start - 2), t.end))) {
        uncertain = true;
        continue;
      }
    }
    pending = true;
  }
  flush(tokens.length);
  return output;
}
