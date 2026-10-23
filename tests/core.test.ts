import { test } from 'node:test';
import assert from 'node:assert/strict';
import { graphemeSegments } from 'unicode-segmenter/grapheme';
import { convert, resolveOptions, ConversionError } from '../src/core/index';
import type { ConversionOptions, ConversionResult, Face } from '../src/core/types';
import { sample } from '../src/core/random';
import { contextFor, faceEligible } from '../src/core/intent';
import { goEmotionsIntents, intentsFromScores } from '../src/core/mood';
import dictionary from '../data/emoticons.json' with { type: 'json' };
import vectors from './random-vectors.json' with { type: 'json' };
import { baseline, zeroRates, exact, fragments } from './fixtures';

function run(text: string, options: ConversionOptions = {}) {
  return convert(text, { ...baseline, ...options, rates: { ...zeroRates, ...options.rates } });
}
for (const [i, [input, output, options]] of exact.entries())
  test(`A${String(i + 1).padStart(2, '0')}: exact spelling/preservation`, () =>
    assert.equal(run(input, options).text, output));
test('B01: stretch, tilde and face combine in a single decorated sentence', () => {
  const result = run('Hi', {
    rates: { stretch: 1, tilde: 1, emoticon: 1 },
    emoticons: { intent: 'cuteness' },
    diagnostics: true,
  });
  assert.match(result.text, /^Haiii~ .+/);
  assert.equal(
    result.diagnostics!.decisions.filter((d) => d.ruleId === 'emoticon' && d.outcome === 'selected')
      .length,
    1,
  );
});
test('B02: affection can combine nya with a face but never a second tilde', () => {
  const result = run('I love you!', {
    style: 'nya',
    rates: { nya: 1, emoticon: 1, tilde: 1 },
    emoticons: { intent: 'affection' },
  });
  assert.match(result.text, /^I wuv you! nya~ .+/);
  assert.equal(result.text.split('~').length, 2);
});
test('B03: light chooses greeting face over tilde', () => {
  const face = run('Hi!', { intensity: 'light', rates: { emoticon: 1, tilde: 1 } }).text.slice(4);
  assert.ok(
    dictionary.entries.some((e) => e.text === face && e.intents.includes('greeting')),
    face,
  );
});
test('B04: stutter uses converted initial', () =>
  assert.equal(run('really', { rates: { stutter: 1 } }).text, 'w-weawwy'));
test('B05: existing stutters/stretching are protected', () =>
  assert.equal(
    run('r-really haiii smol', { rates: { stutter: 1, stretch: 1 } }).text,
    'r-really haiii smol',
  ));
test('B06: existing face permits word expression but prevents new endings', () =>
  assert.equal(
    run('Hello! :3', { rates: { emoticon: 1, tilde: 1, stutter: 1 } }).text,
    'H-Hewwo! :3',
  ));
test('B07: face after punctuation belongs to preceding sentence and starts gap', () =>
  assert.equal(
    run('Hello! :3 Goodbye!', { rates: { emoticon: 1, tilde: 1 } }).text,
    'Hewwo! :3 Goodbye!',
  ));
test('B08: neutral prose permits tilde but no emotional face/particle', () =>
  assert.equal(
    run('Status: ready.', { style: 'nya', rates: { emoticon: 1, tilde: 1, nya: 1 } }).text,
    'Status: weady~.',
  ));
test('B09: negation cannot create joy', () =>
  assert.equal(
    run("I'm not happy about this.", { rates: { emoticon: 1 } }).text,
    "I'm not happy about this.",
  ));
test('B10: suspected sarcasm blocks all new expression', () =>
  assert.equal(
    run('Thanks for nothing.', { rates: { stutter: 1, stretch: 1, tilde: 1, emoticon: 1 } }).text,
    'Thankies fow nothing.',
  ));
test('B11: question mark is not confusion', () =>
  assert.equal(
    run('Can you send the file?', { rates: { emoticon: 1 } }).text,
    'Can you send the fiwe?',
  ));
test('B12: quotation cannot assign emotion to narrator or receive expression', () =>
  assert.equal(
    run('She wrote "I\'m so happy!"', {
      quotedText: 'convert',
      rates: { emoticon: 1, stutter: 1, tilde: 1 },
    }).text,
    'She wwote "I\'m so happy!"',
  ));
test('B13: sad cat message cannot create cheerful expression', () =>
  assert.equal(
    run('My cat is missing.', { style: 'nya', rates: { emoticon: 1, tilde: 1, nya: 1 } }).text,
    'My cat is missing.',
  ));
test('B14: sympathy does not become responsibility/apology', () => {
  const result = run("I'm sorry your day was so rough. I'm here for you.", {
    rates: { emoticon: 1 },
    diagnostics: true,
  });
  const selected = result.diagnostics!.decisions.filter(
    (d) => d.ruleId === 'emoticon' && d.outcome === 'selected',
  );
  assert.deepEqual(
    selected.map((d) => d.entryId),
    ['comfort'],
  );
  assert.ok(selected[0].inputStart >= 31);
});
test('B15: technical fragments and complete Unicode sequences stay unchanged', () => {
  const options: ConversionOptions = {
    style: 'nya',
    rates: { stutter: 1, stretch: 1, tilde: 1, nya: 1, emoticon: 1 },
  };
  for (const fragment of fragments) {
    assert.equal(run(fragment, options).text, fragment);
    assert.ok(run(`Hello ${fragment} world`, options).text.includes(fragment), fragment);
  }
  const code = '```ts\r\nreturn hello_world;\r\n```';
  assert.equal(run(code, options).text, code);
  assert.equal(run(`Hello ${fragments[0]}. Really`).text, `Hewwo ${fragments[0]}. Weawwy`);
  assert.equal(
    run('Hello!\n:3 Goodbye!', { rates: { emoticon: 1, tilde: 1 } }).text,
    'Hewwo!\n:3 Goodbye!',
  );
});
test('B16: diagnostics are reproducible and offsets map to actual source/output', () => {
  const input = 'Hello! Thanks for the tea. 👩🏽‍💻 Love’s crème hello.';
  const options: ConversionOptions = { rates: { stutter: 1, stretch: 1, tilde: 1, emoticon: 1 } };
  const result = run(input, { ...options, diagnostics: true }),
    plain = run(input, options);
  assert.equal(result.text, plain.text);
  assert.deepEqual(result.meta, plain.meta);
  assert.deepEqual(result, run(input, { ...options, diagnostics: true }));
  const boundaries = (s: string) =>
    new Set([...graphemeSegments(s)].map((g) => g.index).concat(s.length));
  const sourceBoundaries = boundaries(input),
    outputBoundaries = boundaries(result.text);
  for (const c of result.diagnostics!.changes) {
    assert.equal(input.slice(c.inputStart, c.inputEnd), c.before);
    assert.equal(result.text.slice(c.outputStart, c.outputEnd), c.after);
    assert.ok(sourceBoundaries.has(c.inputStart) && sourceBoundaries.has(c.inputEnd));
    assert.ok(outputBoundaries.has(c.outputStart) && outputBoundaries.has(c.outputEnd));
  }
});
test('literal preserve terms respect word edges, including Unicode and regex symbols', () => {
  assert.equal(
    run('Luna Lunar LUNa luna caféhello [really]', { preserveTerms: ['Luna', 'café', '[really]'] })
      .text,
    'Luna Wunaw LUNa wuna caféhello [really]',
  );
});
test('stuttering has one-per-sentence limit and skips hyphenated words', () => {
  assert.equal(
    run('really lovely hello. red-blue green.', { rates: { stutter: 1 } }).text,
    'w-weawwy wuvwy hewwo. wed-bwue g-gween.',
  );
});
test('ending budget counts combinations once, respects gaps and short-message cap', () => {
  const options: ConversionOptions = {
    rates: { tilde: 1, emoticon: 1 },
    endings: { maxPerMessage: 3, minSentenceGap: 1 },
    diagnostics: true,
  };
  const sentence = 'Hello, please bring the large red blanket along to the picnic with us today! ';
  const result = run(sentence.repeat(6), options);
  assert.equal(
    result.diagnostics!.decisions.filter((d) => d.ruleId === 'emoticon' && d.outcome === 'selected')
      .length,
    3,
  );
  // Faces may contain tildes of their own, so count the tilde decisions.
  const tildes = (r: ConversionResult) =>
    r.diagnostics!.decisions.filter((d) => d.ruleId === 'tilde' && d.outcome === 'selected').length;
  assert.equal(tildes(result), 3);
  assert.equal(
    tildes(
      run('Hello! Hello! Hello!', { ...options, endings: { minSentenceGap: 0, maxPerMessage: 3 } }),
    ),
    1,
  );
  assert.equal(run('Hello!', { ...options, endings: { maxPerMessage: 0 } }).text, 'Hewwo!');
});
test('non-repetition filters previously inserted face when alternatives exist', () => {
  const result = run(
    'Thanks for coming along to the picnic and bringing lots of beautiful flowers! '.repeat(6),
    { rates: { emoticon: 1 }, endings: { minSentenceGap: 0, maxPerMessage: 6 }, diagnostics: true },
  );
  const ids = result
    .diagnostics!.decisions.filter((d) => d.ruleId === 'emoticon' && d.outcome === 'selected')
    .map((d) => d.entryId);
  assert.equal(ids.length, 6);
  for (let i = 1; i < ids.length; i++) assert.notEqual(ids[i], ids[i - 1]);
});
test('ASCII-only filters inserted faces and preserves original Unicode', () => {
  const result = run('I love you! ❤️', {
    rates: { emoticon: 1 },
    emoticons: { asciiOnly: true },
    diagnostics: true,
  });
  assert.ok(result.text.includes('❤️'));
  const change = result.diagnostics!.changes.find((c) =>
    c.ruleIds.some((r) => r.startsWith('emoticon:')),
  );
  assert.ok(change && /^[\x00-\x7f]+$/.test(change.after));
});
test('explicit intent cannot override clear contextual contradiction', () => {
  const result = run('Sorry for being late.', {
    rates: { emoticon: 1 },
    emoticons: { intent: 'teasing' },
  });
  assert.equal(result.text, 'Sowwy fow being wate.');
});
test('detected intents fill neutral sentences without acting as an author choice', () => {
  const faceIds = (text: string, options: ConversionOptions) =>
    run(text, { rates: { emoticon: 1 }, diagnostics: true, ...options })
      .diagnostics!.decisions.filter((d) => d.ruleId === 'emoticon' && d.outcome === 'selected')
      .map((d) => d.entryId);
  const joyFaces = new Set(
    dictionary.entries.filter((e) => e.intents.includes('joy')).map((e) => e.id),
  );
  // A neutral sentence gains a face only from the detected mood.
  assert.deepEqual(faceIds('The results came in today.', {}), []);
  const [joy] = faceIds('The results came in today.', { emoticons: { detectedIntents: ['joy'] } });
  assert.ok(joy && joyFaces.has(joy), String(joy));
  // Phrase rules win over the detector, and uncertain sentences stay silent.
  const [greeting] = faceIds('Hello there.', { emoticons: { detectedIntents: ['teasing'] } });
  assert.ok(
    greeting && dictionary.entries.find((e) => e.id === greeting)!.intents.includes('greeting'),
  );
  assert.deepEqual(faceIds('I never liked it.', { emoticons: { detectedIntents: ['joy'] } }), []);
  // A detected mood cannot unlock faces reserved for author-selected intents.
  assert.deepEqual(
    faceIds('The results came in today.', { emoticons: { detectedIntents: ['teasing'] } }),
    [],
  );
  assert.equal(
    faceIds('The results came in today.', { emoticons: { intent: 'teasing' } }).length,
    1,
  );
});
test('model scores map to positive dictionary intents above the cutoff', () => {
  const scores = (label: string, score: number, neutral = 0.01) => [
    { label: 'neutral', score: neutral },
    { label, score },
  ];
  assert.deepEqual(intentsFromScores(scores('amusement', 0.99), 0.85), ['amusement']);
  assert.deepEqual(intentsFromScores(scores('amusement', 0.8), 0.85), []);
  assert.deepEqual(intentsFromScores(scores('amusement', 0.9, 0.95), 0.85), []);
  assert.deepEqual(intentsFromScores(scores('sadness', 0.96), 0.85), []);
  assert.deepEqual(intentsFromScores(scores('sadness', 0.96), 0.85, false), [
    'sadness',
    'disappointment',
  ]);
  assert.deepEqual(intentsFromScores(scores('grief', 0.99), 0.85), []);
  assert.deepEqual(intentsFromScores(scores('constructor', 0.99), 0.85), []);
  for (const mapped of Object.values(goEmotionsIntents))
    for (const intent of mapped)
      assert.ok(
        dictionary.entries.some((e) => e.intents.includes(intent)),
        intent,
      );
});
test('chat slang is recognized as speech acts without catching lookalikes', () => {
  const intentsOf = (text: string) => contextFor(text, false, 'auto').intents;
  const cases: [string, string[]][] = [
    ['hiii how is it going', ['greeting']],
    ['heyy long time no see', ['greeting']],
    ['yo whats up', ['greeting']],
    ['cya later guys', ['farewell']],
    ['ok gtg', ['farewell']],
    ['ty ty, see you next stream', ['farewell', 'gratitude']],
    ['tysm for the birthday wishes everyone', ['gratitude']],
    ['appreciate it a lot', ['gratitude']],
    ['my bad, i misread that', ['apology']],
    ['sorry for the late reply', ['apology']],
    ['apologies for the ping', ['apology']],
    ['gn everyone', ['sleep']],
    ['im so sleepy', ['sleep']],
    ['congrats on the promotion!', ['celebration']],
    // Lookalikes and mid-sentence greetings stay neutral.
    ["what's up with this bug", []],
    ['the history test is today', []],
    ['say hi to her', []],
    ['i hit a typo in the config', []],
    ['the gym is crowded', []],
    ['pretty good', []],
  ];
  for (const [text, intents] of cases) assert.deepEqual(intentsOf(text), intents, text);
  // Slang still yields a face, including the narrow sleepy and awkward-smile rules.
  for (const [text, face] of [
    ['gn everyone', 'sleepy'],
    ['my bad, i misread that', 'awkward_smile'],
  ])
    assert.ok(
      dictionary.entries.some(
        (e) => e.id === face && faceEligible(e as Face, contextFor(text, false, 'auto')),
      ),
      text,
    );
});
test('every dictionary spelling is protected exactly', () => {
  for (const entry of dictionary.entries)
    for (const face of [entry.text, ...entry.aliases])
      assert.equal(
        run(face, {
          style: 'nya',
          intensity: 'heavy',
          rates: { stutter: 1, stretch: 1, tilde: 1, nya: 1, emoticon: 1 },
        }).text,
        face,
        entry.id,
      );
});
test('disabled features and expressions are a lossless no-op', () => {
  const text = exact
    .map(([s]) => s)
    .concat(fragments)
    .join('\r\n');
  assert.equal(
    run(text, { features: { vocabulary: false, letterSwap: false, nyaSpelling: false } }).text,
    text,
  );
});
test('strict runtime validation, defaults and nested option merging', () => {
  assert.equal(resolveOptions({ rates: { stutter: 1 } }).rates.emoticon, 0.2);
  assert.equal(resolveOptions().seed, '0');
  const bad = [
    null,
    [],
    { style: 'owo' },
    { intensity: null },
    { seed: 4 },
    { features: null },
    { rates: { tilde: NaN } },
    { rates: { emoticon: Infinity } },
    { rates: { stretch: -1 } },
    { rates: { stutter: 2 } },
    { rates: { unknown: 1 } },
    { unknown: true },
    { diagnostics: 'true' },
    { preserveTerms: [''] },
    { preserveTerms: [2] },
    { emoticons: { intent: 'made_up' } },
    { emoticons: { detectedIntents: 'joy' } },
    { emoticons: { detectedIntents: ['made_up'] } },
    { emoticons: { detectedIntents: ['joy', 'joy'] } },
    { endings: { maxPerMessage: 1.5 } },
    { features: { nyaSpelling: true } },
    { rates: { nya: 0.5 } },
    { seed: 'x'.repeat(1025) },
    { preserveTerms: Array(257).fill('x') },
  ];
  for (const options of bad)
    assert.throws(
      () => convert('hello', options as ConversionOptions),
      ConversionError,
      JSON.stringify(options),
    );
  for (const value of [null, [], {}, 42, undefined, '\ud800', '\udc00'])
    assert.throws(() => convert(value as string), ConversionError);
  assert.equal(run('😀'.repeat(100_000)).text.length, 200_000);
  assert.throws(
    () => run('x'.repeat(100_001)),
    (e: unknown) => e instanceof ConversionError && e.status === 413,
  );
});
test('diagnostics are bounded independently of conversion', () => {
  const input = 'really '.repeat(3000),
    result = run(input, { diagnostics: true });
  assert.equal(result.text, run(input).text);
  const d = result.diagnostics!;
  assert.equal(d.changes.length + d.decisions.length + d.protectedSpans.length, 2000);
  assert.equal(d.truncated, true);
});
test('keyed random choices are in range, stable and separate per rule/position', () => {
  for (const v of vectors) assert.equal(sample(v.seed, v.rule, v.position), v.hash / 0x100000000);
  const value = sample('review', 'emoticon_rate', 0);
  assert.equal(value, sample('review', 'emoticon_rate', 0));
  assert.ok(value >= 0 && value < 1);
  assert.notEqual(value, sample('review', 'emoticon_choice', 0));
  assert.notEqual(value, sample('review', 'emoticon_rate', 1));
});
test('unmatched quotes flag their sentence without consuming later prose', () => {
  const source = '“Hello world! Thanks for coming.';
  const result = run(source, { rates: { stutter: 1, emoticon: 1 }, diagnostics: true });
  assert.ok(result.text.startsWith('“Hewwo wowwd! T-Thankies'));
  assert.ok(result.diagnostics!.decisions.some((d) => d.reasonCode === 'context_uncertain'));
});
test('CRLF and LF have the same sentence semantics and keep original whitespace', () => {
  const o: ConversionOptions = { rates: { stutter: 1 } };
  assert.equal(run('really\r\nlovely', o).text, 'w-weawwy\r\nwuvwy');
  assert.equal(run('really\nlovely', o).text, 'w-weawwy\nwuvwy');
  assert.equal(run('really\r\n\r\nlovely', o).text, 'w-weawwy\r\n\r\nw-wuvwy');
});
test('long lexical runs with technical delimiters remain supported', () => {
  assert.equal(run('r'.repeat(99995) + '.txt').text, 'r'.repeat(99995) + '.txt');
  assert.equal(run('r'.repeat(99990) + '@hello.io').text, 'r'.repeat(99990) + '@hello.io');
  assert.equal(run('r'.repeat(100000)).text, 'w'.repeat(100000));
});
test('dictionary has unique IDs/spellings, valid metadata and resolvable source links', () => {
  const ids = new Set<string>(),
    spellings = new Set<string>(),
    sources = new Set(dictionary.sources.map((s) => s.id));
  for (const e of dictionary.entries) {
    assert.ok(!ids.has(e.id));
    ids.add(e.id);
    for (const face of [e.text, ...e.aliases]) {
      assert.ok(face.length > 0 && !spellings.has(face), face);
      spellings.add(face);
    }
    assert.ok(e.meanings.length && e.intents.length && e.styles.length);
    assert.ok(Number.isInteger(e.intensity) && e.intensity >= 1 && e.intensity <= 3);
    assert.ok(['contextual', 'explicit'].includes(e.selection));
    assert.ok(
      [
        'auto',
        'explicit',
        'sleep_cue',
        'hug_cue',
        'mishap_cue',
        'affection_cue',
        'comfort_intent',
        'reference',
      ].includes(e.eligibility),
      e.id,
    );
    if (e.eligibility === 'explicit') assert.equal(e.selection, 'explicit', e.id);
    assert.ok(e.placement.includes('sentence_end'));
    assert.ok(e.example.output.includes(e.text));
    for (const id of e.source_ids) assert.ok(sources.has(id));
  }
});
test('partial protected terms cannot split original identifiers or accented words', () => {
  for (const [source, term] of [
    ['e\u0301llo', 'e'],
    ['e\u0301llo', '\u0301'],
    ['read_file', '_'],
    ['R2D2', '2'],
    ['uwu\u0301hello', 'uwu'],
  ]) {
    assert.equal(run(source, { preserveTerms: [term], rates: { stutter: 1 } }).text, source);
  }
});
