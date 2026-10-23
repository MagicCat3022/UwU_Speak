import dictionary from '../../data/emoticons.json' with { type: 'json' };
import vocabulary from '../../data/vocabulary.json' with { type: 'json' };
import { ConversionError, resolveOptions, validateText } from './options.js';
import { tokenize, sentences, splitSuffix } from './segment.js';
import { contextFor, faceEligible } from './intent.js';
import { sample } from './random.js';
import type {
  Change,
  ConversionOptions,
  ConversionResult,
  Decision,
  Diagnostics,
  Face,
  ResolvedOptions,
} from './types.js';

export { ConversionError, resolveOptions, intents, MAX_INPUT } from './options.js';
export { intentsFromScores, miniLmCutoff, type LabelScore } from './mood.js';
export type * from './types.js';
export const versions = Object.freeze({
  engineVersion: '0.2.0',
  rulesVersion: vocabulary.version,
  segmentationVersion: '0.1.0',
  emoticonDictionaryVersion: dictionary.version,
});
const faces: Face[] = [...dictionary.entries].sort((a, b) =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
);
const words: Record<string, string> = vocabulary.words,
  nyaWords: Record<string, string> = vocabulary.nyaWords;
const own = (map: Record<string, string>, key: string) =>
  Object.hasOwn(map, key) ? map[key] : undefined;
function transferCase(value: string, source: string): string {
  if (source === source.toUpperCase()) return value.toUpperCase();
  if (/^[A-Z]/.test(source)) return value[0].toUpperCase() + value.slice(1);
  return value;
}
function spell(original: string, options: ResolvedOptions): { text: string; ruleIds: string[] } {
  const ruleIds: string[] = [];
  const [base, suffix] = splitSuffix(original);
  const direct = options.features.vocabulary
    ? own(words, original.toLowerCase().replace(/’/g, "'"))
    : undefined;
  const replacement =
    direct ?? (options.features.vocabulary ? own(words, base.toLowerCase()) : undefined);
  if (replacement)
    return {
      text: transferCase(replacement, direct ? original : base) + (direct ? '' : suffix),
      ruleIds: ['vocabulary'],
    };
  let text = base;
  if (options.features.letterSwap) {
    const next = text.replace(/[rlRL]/g, (c) => (c === c.toUpperCase() ? 'W' : 'w'));
    if (next !== text) ruleIds.push('letter_swap');
    text = next;
  }
  if (options.features.nyaSpelling) {
    const next =
      options.nyaScope === 'words'
        ? transferCase(own(nyaWords, base.toLowerCase()) ?? text, base)
        : text.replace(/n(?=[aeiou])/gi, (c) =>
            c === 'n' ? 'ny' : text === text.toUpperCase() ? 'NY' : 'Ny',
          );
    if (next !== text) ruleIds.push('nya_spelling');
    text = next;
  }
  return { text: text + suffix, ruleIds };
}
interface Edit {
  start: number;
  end: number;
  after: string;
  ruleIds: string[];
}
export function convert(text: string, inputOptions: ConversionOptions = {}): ConversionResult {
  validateText(text);
  const options = resolveOptions(inputOptions);
  const parsed = tokenize(text, options),
    parts = sentences(parsed.tokens, text, parsed.ambiguous);
  const edits: Edit[] = [],
    decisions: Decision[] = [];
  const budget = Math.min(
    options.endings.maxPerMessage,
    [...text].length <= 240 ? 1 : Number.MAX_SAFE_INTEGER,
  );
  let decorated = 0,
    previousDecorated = -Infinity,
    lastFace = '';
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    const prose = part.tokens
      .map((t) => (t.quoted || t.kind === 'protected' ? ' '.repeat(t.text.length) : t.text))
      .join('');
    const context = contextFor(
      prose,
      part.uncertain,
      options.emoticons.intent,
      options.emoticons.detectedIntents,
    );
    const log = (
      ruleId: string,
      start: number,
      end: number,
      reasonCode: string,
      entryId?: string,
    ) => {
      if (options.diagnostics)
        decisions.push({
          inputStart: start,
          inputEnd: end,
          intentState: context.state,
          ...(context.intents[0] ? { intent: context.intents[0] } : {}),
          ruleId,
          ...(entryId ? { entryId } : {}),
          outcome: reasonCode === 'selected' ? 'selected' : 'skipped',
          reasonCode,
        });
    };
    let didStretch = false,
      didStutter = false;
    for (const token of part.tokens) {
      if (token.kind !== 'word') continue;
      const result = spell(token.text, options);
      if (!token.quoted && context.state !== 'uncertain') {
        let stretched = false;
        if (!didStretch && /^(?:hai|okie)$/i.test(result.text)) {
          if (sample(options.seed, 'stretch', token.start) < options.rates.stretch) {
            result.text += result.text.at(-1)!.repeat(2);
            result.ruleIds.push('stretch');
            stretched = didStretch = true;
            log('stretch', token.start, token.end, 'selected');
          } else log('stretch', token.start, token.end, 'rate_not_selected');
        }
        if (
          !didStutter &&
          !stretched &&
          !token.hyphenated &&
          token.text.replace(/['’]/g, '').length >= 3
        ) {
          if (sample(options.seed, 'stutter', token.start) < options.rates.stutter) {
            result.text = result.text[0] + '-' + result.text;
            result.ruleIds.push('stutter');
            didStutter = true;
            log('stutter', token.start, token.end, 'selected');
          } else log('stutter', token.start, token.end, 'rate_not_selected');
        }
      }
      if (result.text !== token.text)
        edits.push({
          start: token.start,
          end: token.end,
          after: result.text,
          ruleIds: result.ruleIds,
        });
    }
    if (part.existingEnding) {
      previousDecorated = index;
      log('ending', part.start, part.end, 'existing_ending');
      continue;
    }
    if (context.state === 'uncertain') {
      log('ending', part.start, part.end, 'context_uncertain');
      continue;
    }
    if (!part.tokens.some((t) => t.kind === 'word' && !t.quoted)) {
      log('ending', part.start, part.end, 'protected_content');
      continue;
    }
    if (decorated >= budget || index - previousDecorated <= options.endings.minSentenceGap) {
      log('ending', part.start, part.end, 'budget_exhausted');
      continue;
    }
    let face: Face | undefined;
    if (options.emoticons.enabled) {
      let candidates = faces.filter(
        (e) =>
          e.styles.includes(options.style) &&
          e.intensity <= options.emoticons.maxIntensity &&
          (!options.emoticons.asciiOnly || /^[\x00-\x7f]*$/.test(e.text)) &&
          faceEligible(e, context),
      );
      if (candidates.some((e) => e.id !== lastFace))
        candidates = candidates.filter((e) => e.id !== lastFace);
      if (!candidates.length)
        log(
          'emoticon',
          part.start,
          part.end,
          context.state === 'neutral' ? 'no_matching_intent' : 'unsupported_eligibility',
        );
      else if (sample(options.seed, 'emoticon_rate', part.start) >= options.rates.emoticon)
        log('emoticon', part.start, part.end, 'rate_not_selected');
      else {
        face =
          candidates[
            Math.floor(sample(options.seed, 'emoticon_choice', part.start) * candidates.length)
          ];
        log('emoticon', part.start, part.end, 'selected', face.id);
      }
    } else log('emoticon', part.start, part.end, 'disabled');
    let particle = false,
      tilde = false;
    const lastWord = part.tokens.findLast((t) => t.kind === 'word' && !t.quoted);
    if (!face || options.endings.allowCombination) {
      const canNya =
        options.style === 'nya' &&
        context.intents.some((i) => ['affection', 'cuteness', 'cat_playfulness'].includes(i));
      if (canNya && sample(options.seed, 'nya_particle', part.start) < options.rates.nya) {
        particle = true;
        log('nya_particle', part.start, part.end, 'selected');
      } else if (options.style === 'nya')
        log(
          'nya_particle',
          part.start,
          part.end,
          canNya ? 'rate_not_selected' : 'no_matching_intent',
        );
      if (!particle && lastWord && /^[.!?]*$/.test(text.slice(lastWord.end, part.end))) {
        if (sample(options.seed, 'tilde', part.start) < options.rates.tilde) {
          tilde = true;
          log('tilde', part.start, part.end, 'selected');
        } else log('tilde', part.start, part.end, 'rate_not_selected');
      }
    }
    if (tilde)
      edits.push({ start: lastWord!.end, end: lastWord!.end, after: '~', ruleIds: ['tilde'] });
    if (particle || face)
      edits.push({
        start: part.end,
        end: part.end,
        after: (particle ? ' nya~' : '') + (face ? ' ' + face.text : ''),
        ruleIds: [...(particle ? ['nya_particle'] : []), ...(face ? ['emoticon:' + face.id] : [])],
      });
    if (face || particle || tilde) {
      decorated++;
      previousDecorated = index;
      if (face) lastFace = face.id;
    }
  }
  const sorted: Edit[] = [];
  for (const edit of edits.sort((a, b) => a.start - b.start || a.end - b.end)) {
    const last = sorted.at(-1);
    if (last && last.start === last.end && edit.start === edit.end && last.start === edit.start) {
      last.after += edit.after;
      last.ruleIds.push(...edit.ruleIds);
    } else sorted.push(edit);
  }
  const output: string[] = [],
    changes: Change[] = [];
  let cursor = 0,
    outputLength = 0;
  for (const edit of sorted) {
    if (edit.start < cursor) throw new Error('Internal error: overlapping edits.');
    const gap = text.slice(cursor, edit.start);
    output.push(gap, edit.after);
    outputLength += gap.length;
    if (options.diagnostics)
      changes.push({
        inputStart: edit.start,
        inputEnd: edit.end,
        outputStart: outputLength,
        outputEnd: outputLength + edit.after.length,
        before: text.slice(edit.start, edit.end),
        after: edit.after,
        ruleIds: edit.ruleIds,
      });
    outputLength += edit.after.length;
    cursor = edit.end;
  }
  output.push(text.slice(cursor));
  const result: ConversionResult = {
    text: output.join(''),
    meta: { ...versions, seed: options.seed },
  };
  if (options.diagnostics) {
    const report: Diagnostics = {
      changes: [],
      protectedSpans: [],
      decisions: [],
      truncated: false,
    };
    const records = [
      ...changes.map((value) => ({ rank: 0, value })),
      ...parsed.protectedSpans.map((value) => ({ rank: 1, value })),
      ...decisions.map((value) => ({ rank: 2, value })),
    ].sort((a, b) => a.value.inputStart - b.value.inputStart || a.rank - b.rank);
    report.truncated = records.length > 2000;
    for (const r of records.slice(0, 2000)) {
      if ('after' in r.value) report.changes.push(r.value);
      else if ('reasonCodes' in r.value) report.protectedSpans.push(r.value);
      else report.decisions.push(r.value);
    }
    result.diagnostics = report;
  }
  return result;
}
