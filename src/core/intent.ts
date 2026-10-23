import type { Face, IntentState } from './types.js';

export interface Context {
  state: IntentState;
  intents: string[];
  text: string;
  explicit: boolean;
}
// These are deliberately narrow eligibility rules. Dictionary prose is never executed as code.
const cues: [string, RegExp][] = [
  [
    'greeting',
    /^(?:hi+|hiya|hey+|heya|hello+|howdy|yo+|sup|wass?up|what'?s up(?! with)|good morning|good afternoon|good evening)\b|\blong time no see\b/,
  ],
  [
    'farewell',
    /\b(?:goodbye|bye+|see (?:you|ya|u) (?:soon|tomorrow|later|around|then|next \w+)|see ya|cya|laters|ttyl|gtg|g2g|gotta (?:go|run|head out)|peace out|take care)\b/,
  ],
  [
    'gratitude',
    /\b(?:thanks|thank (?:you|u)|thankful|grateful|thx|thnx|ty|tysm|tyvm|tyty|appreciate (?:it|you|u|ya|that)|much appreciated)\b/,
  ],
  [
    'apology',
    /\b(?:sorry (?:i|about that|for (?:being|sending|keeping|making|the (?:late|slow) (?:reply|response)|the (?:wait|delay|ping|spam)))|my mistake|my fault|my bad|apologies|oops|whoops)\b/,
  ],
  [
    'sleep',
    /\b(?:good ?night|g'?night|gn|nini|night night|nighty(?: night)?|off to bed|(?:going|heading) to (?:bed|sleep)|i(?:'m| am|m) (?:so |really |very )?sleepy)\b/,
  ],
  [
    'celebration',
    /\b(?:we (?:did it|won|finished)|i (?:won|passed)|finally (?:beat|finished|did)|hooray|yay|congratulations|congrats|congratz|grats)\b/,
  ],
  ['comfort', /\b(?:here for you|sending you a hug|you(?:'re| are) not alone)\b/],
  ['affection', /\b(?:i love you|love you|glad you(?:'re| are) in my life)\b/],
];
const ambiguous =
  /\b(?:thanks for nothing|yeah right|as if|not happy|not excited|not glad|not grateful|not sorry|not (?:going to|off to) bed|don'?t|doesn'?t|didn'?t|never|cannot|can'?t|no longer|missing|died|dead|death|sad|upset|hurt|hate|terrible|rough day|so rough|for real|sarcastic)\b|\b(?:she|he|they)\s+(?:said|says|wrote|feels?|is|are|was|were)\b|\bbut\b/;
/**
 * `detected` comes from an outside classifier (for example a sentiment model). It only fills in
 * sentences the phrase rules leave neutral, and it is never an author choice, so it cannot unlock
 * explicit-only faces.
 */
export function contextFor(
  text: string,
  structurallyUncertain: boolean,
  override: string,
  detected: string[] = [],
): Context {
  text = text.toLowerCase().replace(/’/g, "'").trim();
  const found = cues.filter(([, regex]) => regex.test(text)).map(([intent]) => intent);
  // An explicit self-correction/apology is distinct from sympathy for another person's loss.
  const isUncertain =
    structurallyUncertain ||
    ambiguous.test(text) ||
    /\bsorry (?:your|you|to hear|about your)\b/.test(text);
  if (isUncertain) return { state: 'uncertain', intents: [], text, explicit: override !== 'auto' };
  if (override !== 'auto') {
    const opposed =
      (found.includes('apology') &&
        ['teasing', 'amusement', 'celebration', 'joy', 'skepticism'].includes(override)) ||
      (found.includes('gratitude') && ['anger', 'skepticism', 'sadness'].includes(override));
    if (opposed) return { state: 'uncertain', intents: [], text, explicit: true };
    return { state: 'matched', intents: [override], text, explicit: true };
  }
  if (!found.length && detected.length)
    return { state: 'matched', intents: [...detected], text, explicit: false };
  return { state: found.length ? 'matched' : 'neutral', intents: found, text, explicit: false };
}
export function faceEligible(face: Face, context: Context): boolean {
  if (context.state !== 'matched' || !face.intents.some((i) => context.intents.includes(i)))
    return false;
  if (face.selection === 'explicit' && !context.explicit) return false;
  const t = context.text;
  // Each entry's eligibility names one of these rules; unknown or "reference" entries are never inserted.
  switch (face.eligibility) {
    case 'auto':
      return true;
    // Requires explicit author intent as well as a noncontradictory source context.
    case 'explicit':
      return context.explicit;
    case 'mishap_cue':
      return /\b(?:oops|whoops|my bad|misread|twice|wrong (?:person|channel)|typo|small mistake)\b/.test(
        t,
      );
    case 'sleep_cue':
      return /\b(?:bed|sleep|sleepy|night|g'?night|gn|nini|nighty)\b/.test(t);
    case 'comfort_intent':
      return context.intents.includes('comfort');
    case 'hug_cue':
      return /\bhug\b/.test(t);
    case 'affection_cue':
      return /\b(?:love you|in my life|adore you)\b/.test(t);
    default:
      return false;
  }
}
