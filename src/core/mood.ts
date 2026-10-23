// Turns GoEmotions classifier scores into dictionary intents for `emoticons.detectedIntents`.
// The model itself runs outside the engine (see scripts/compare-intent.ts and the Vencord plugin).

export interface LabelScore {
  label: string;
  score: number;
}
// GoEmotions labels → dictionary intents. Labels mapped to [] never earn a face: grief, fear and
// disgust are unsafe for cute decoration, and the rest describe no expressible mood.
export const goEmotionsIntents: Record<string, string[]> = {
  admiration: ['joy'],
  amusement: ['amusement'],
  anger: ['anger', 'frustration'],
  annoyance: ['frustration'],
  approval: ['acknowledgment'],
  caring: ['comfort', 'affection'],
  confusion: ['confusion'],
  curiosity: [],
  desire: [],
  disappointment: ['disappointment', 'sadness'],
  disapproval: ['skepticism'],
  disgust: [],
  embarrassment: ['embarrassment', 'shyness'],
  excitement: ['celebration', 'joy'],
  fear: [],
  gratitude: ['gratitude'],
  grief: [],
  joy: ['joy', 'celebration'],
  love: ['affection'],
  nervousness: ['shyness', 'embarrassment'],
  optimism: ['determination', 'joy'],
  pride: ['celebration', 'joy'],
  realization: [],
  relief: ['joy'],
  remorse: ['apology'],
  sadness: ['sadness', 'disappointment'],
  surprise: ['surprise'],
  neutral: [],
};
// With positiveOnly, the model never adds a face for these moods on its own.
export const negativeIntents = new Set([
  'sadness',
  'disappointment',
  'anger',
  'frustration',
  'skepticism',
]);

// MiniLMv2-goemotions-v2 cutoff. In eval/results/intent-comparison.md the plugin's guards keep
// false and sensitive alarms flat from 0.85 down to 0.5; 0.6 adds faces for clear but less
// confident moods ("best day ever" scores joy 0.66) at the cost of one more wrong mood.
export const miniLmCutoff = 0.6;

/**
 * The top non-neutral label counts only if it beats "neutral" and reaches `cutoff`.
 * Unknown labels map to no intent.
 */
export function intentsFromScores(
  scores: readonly LabelScore[],
  cutoff: number,
  positiveOnly = true,
): string[] {
  const neutral = scores.find((s) => s.label === 'neutral')?.score ?? 0;
  const best = scores
    .filter((s) => s.label !== 'neutral')
    .reduce<LabelScore | undefined>((a, b) => (a && a.score >= b.score ? a : b), undefined);
  if (!best || best.score < cutoff || best.score <= neutral) return [];
  const intents = Object.hasOwn(goEmotionsIntents, best.label) ? goEmotionsIntents[best.label] : [];
  return intents.filter((i) => !positiveOnly || !negativeIntents.has(i));
}
