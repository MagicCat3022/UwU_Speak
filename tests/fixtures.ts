import type { ConversionOptions } from '../src/core/types';
export const zeroRates = { stutter: 0, stretch: 0, tilde: 0, nya: 0, emoticon: 0 };
export const baseline: ConversionOptions = { seed: 'review', rates: zeroRates };
export const exact: [string, string, ConversionOptions?][] = [
  ['Hello world!', 'Hewwo wowwd!', { intensity: 'light' }],
  ['Thanks, I really love it.', 'Thankies, I weawwy wuv it.'],
  ['Hi! Please bring the small cat.', 'Hai! Pwease bwing the smol cat.'],
  ['PLEASE LOVE SMALL', 'PWEASE WUV SMOL'],
  ['LoVe userName read_file R2D2', 'LoVe userName read_file R2D2'],
  ['She said "Hello world!"', 'She said "Hello world!"'],
  ['She said "Hello world!"', 'She said "Hewwo wowwd!"', { quotedText: 'convert' }],
  ["I'll say we're ready.", "I'ww say we'we weady."],
  ['I’ll say we’re ready.', 'I’ww say we’we weady.'],
  ["love's meaning", "wuv's meaning"],
  ['loving lovely love’s', 'wuvving wuvwy wuv’s'],
  ['friends’ plans', 'fwiends’ pwans'],
  ['No, not now. New, nice.', 'Nyo, nyot nyow. Nyew, nyice.', { style: 'nya', nyaScope: 'words' }],
  ['Banana', 'Banana', { style: 'nya' }],
  ['Banana', 'Banyanya', { style: 'nya', intensity: 'heavy' }],
  ['No, really?', 'Nyo, weawwy?', { style: 'nya', intensity: 'light' }],
  ['hi small', 'hi smaww', { features: { vocabulary: false } }],
  [
    'Hello! Nice.',
    'Hello! Nice.',
    { style: 'nya', features: { vocabulary: false, letterSwap: false, nyaSpelling: false } },
  ],
  ['Hello https://example.com/hello', 'Hewwo https://example.com/hello'],
  ['Hello Luna!', 'Hewwo Luna!', { preserveTerms: ['Luna'] }],
  ['haiii smol w-weawwy', 'haiii smol w-weawwy'],
  ['crème cre\u0300me hello', 'crème cre\u0300me hewwo'],
  ['Hello\tworld!\r\nNo.', 'Hewwo\twowwd!\r\nNo.'],
  ['', ''],
];
export const fragments = [
  'https://example.com/a_(b)?q=hello',
  'person@example.com',
  '@Luna',
  'C:\\Users\\Luna\\notes.txt',
  '`return hello_world;`',
  '(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧',
  '👩🏽‍💻',
  '👨‍👩‍👧‍👦',
  '❤️',
];
