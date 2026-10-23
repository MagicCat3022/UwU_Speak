import dictionary from '../../data/emoticons.json' with { type: 'json' };
import type { ConversionOptions, ResolvedOptions } from './types.js';

export class ConversionError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 422,
    public field?: string,
  ) {
    super(message);
    this.name = 'ConversionError';
  }
}
export const MAX_INPUT = 100_000;
export const intents = [...new Set(dictionary.entries.flatMap((e) => e.intents))].sort();
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
function fail(field: string, message: string): never {
  throw new ConversionError('INVALID_OPTIONS', message, 422, field);
}
function keys(value: unknown, allowed: string[], field: string): Record<string, unknown> {
  if (!record(value)) fail(field, `${field} must be an object.`);
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) fail(`${field}.${key}`, `Unknown option: ${key}.`);
  return value;
}
export function validateText(text: unknown): asserts text is string {
  if (typeof text !== 'string')
    throw new ConversionError('INVALID_TEXT', 'text must be a string.', 400, 'text');
  let count = 0;
  for (let i = 0; i < text.length; i++, count++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff))
        throw new ConversionError(
          'INVALID_UNICODE',
          'text contains an unpaired surrogate.',
          400,
          'text',
        );
    } else if (unit >= 0xdc00 && unit <= 0xdfff)
      throw new ConversionError(
        'INVALID_UNICODE',
        'text contains an unpaired surrogate.',
        400,
        'text',
      );
    if (count >= MAX_INPUT)
      throw new ConversionError(
        'INPUT_TOO_LARGE',
        `text exceeds ${MAX_INPUT.toLocaleString('en-US')} code points.`,
        413,
        'text',
      );
  }
}
export function resolveOptions(input: ConversionOptions = {}): ResolvedOptions {
  keys(
    input,
    [
      'style',
      'intensity',
      'seed',
      'preserveTerms',
      'quotedText',
      'nyaScope',
      'features',
      'rates',
      'endings',
      'emoticons',
      'diagnostics',
    ],
    'options',
  );
  for (const [key, values] of Object.entries({
    style: ['uwu', 'nya'],
    intensity: ['light', 'medium', 'heavy'],
    quotedText: ['preserve', 'convert'],
    nyaScope: ['words', 'full'],
  })) {
    if (key in input && !values.includes((input as Record<string, unknown>)[key] as string))
      fail(key, `Invalid ${key}.`);
  }
  if ('seed' in input && typeof input.seed !== 'string') fail('seed', 'seed must be a string.');
  if ('diagnostics' in input && typeof input.diagnostics !== 'boolean')
    fail('diagnostics', 'diagnostics must be a boolean.');
  if (
    'preserveTerms' in input &&
    (!Array.isArray(input.preserveTerms) ||
      input.preserveTerms.some((t) => typeof t !== 'string' || t.length === 0))
  )
    fail('preserveTerms', 'preserveTerms must contain nonempty strings.');
  // Bound configuration work as well as input size. Literal terms are never executed as regular expressions.
  if (typeof input.seed === 'string' && input.seed.length > 1024)
    fail('seed', 'seed must be at most 1,024 UTF-16 units.');
  if (
    Array.isArray(input.preserveTerms) &&
    (input.preserveTerms.length > 256 ||
      input.preserveTerms.reduce((n, t) => n + t.length, 0) > 16_384)
  )
    fail('preserveTerms', 'Use at most 256 terms totaling 16,384 UTF-16 units.');
  const style = input.style ?? 'uwu',
    intensity = input.intensity ?? 'medium';
  const tier = { light: 0, medium: 1, heavy: 2 }[intensity];
  const result: ResolvedOptions = {
    style,
    intensity,
    seed: input.seed ?? '0',
    preserveTerms: [...(input.preserveTerms ?? [])],
    quotedText: input.quotedText ?? 'preserve',
    nyaScope: input.nyaScope ?? (tier === 2 ? 'full' : 'words'),
    features: { vocabulary: tier > 0, letterSwap: true, nyaSpelling: style === 'nya' },
    rates: {
      stutter: [0, 0.03, 0.1][tier],
      stretch: [0, 0.05, 0.15][tier],
      tilde: [0, 0.1, 0.25][tier],
      nya: style === 'nya' ? [0, 0.08, 0.2][tier] : 0,
      emoticon: [0.1, 0.2, 0.35][tier],
    },
    endings: {
      maxPerMessage: tier + 1,
      minSentenceGap: tier === 2 ? 1 : 2,
      allowCombination: tier > 0,
    },
    emoticons: {
      enabled: true,
      intent: 'auto',
      maxIntensity: tier + 1,
      asciiOnly: false,
      detectedIntents: [] as string[],
    },
    diagnostics: input.diagnostics ?? false,
  };
  for (const group of ['features', 'rates', 'endings', 'emoticons'] as const) {
    if (!(group in input)) continue;
    const value = keys(input[group], Object.keys(result[group]), group);
    for (const [key, v] of Object.entries(value)) {
      const field = `${group}.${key}`;
      if (
        group === 'features' ||
        key === 'enabled' ||
        key === 'asciiOnly' ||
        key === 'allowCombination'
      ) {
        if (typeof v !== 'boolean') fail(field, `${field} must be a boolean.`);
      } else if (key === 'detectedIntents') {
        if (
          !Array.isArray(v) ||
          v.some((i) => typeof i !== 'string' || !intents.includes(i)) ||
          new Set(v).size !== v.length
        )
          fail(field, `${field} must list distinct known emoticon intents.`);
        result.emoticons.detectedIntents = [...(v as string[])];
        continue;
      } else if (key === 'intent') {
        if (typeof v !== 'string' || (v !== 'auto' && !intents.includes(v)))
          fail(field, 'Unknown emoticon intent.');
      } else if (group === 'rates') {
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1)
          fail(field, `${field} must be between 0 and 1.`);
      } else if (
        typeof v !== 'number' ||
        !Number.isSafeInteger(v) ||
        v < (key === 'maxIntensity' ? 1 : 0) ||
        (key === 'maxIntensity' && v > 3)
      )
        fail(field, `Invalid ${field}.`);
      (result[group] as unknown as Record<string, unknown>)[key] = v;
    }
  }
  if (style === 'uwu' && (result.features.nyaSpelling || result.rates.nya > 0))
    fail('style', 'Nya spelling and particles require nya style.');
  return result;
}
