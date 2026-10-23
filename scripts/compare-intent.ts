// Compares the rule-based mood detector with GoEmotions classifiers on eval/intent-corpus.json.
// Usage: npm run eval:intent. Models download once into .models/ (about 225 MB in total).
import { env, pipeline, type TextClassificationPipeline } from '@huggingface/transformers';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import dictionary from '../data/emoticons.json' with { type: 'json' };
import corpus from '../eval/intent-corpus.json' with { type: 'json' };
import { contextFor, faceEligible } from '../src/core/intent.js';
import { intentsFromScores, miniLmCutoff } from '../src/core/mood.js';
import type { Face } from '../src/core/types.js';

env.cacheDir = resolve('.models');
const outDir = resolve('eval/results');

interface Model {
  id: string;
  name: string;
  options: Record<string, string>;
  file: string;
}
const models: Model[] = [
  {
    id: 'minuva/MiniLMv2-goemotions-v2-onnx',
    name: 'MiniLM',
    options: { dtype: 'q8', subfolder: '', model_file_name: 'model_optimized' },
    file: 'model_optimized_quantized.onnx',
  },
  {
    id: 'Cohee/distilbert-base-uncased-go-emotions-onnx',
    name: 'DistilBERT',
    options: { dtype: 'q8' },
    file: 'onnx/model_quantized.onnx',
  },
  {
    id: 'SamLowe/roberta-base-go_emotions-onnx',
    name: 'RoBERTa',
    options: { dtype: 'q8' },
    file: 'onnx/model_quantized.onnx',
  },
];

// Speech acts the keyword rules already detect; emotions are left to the model in the hybrids.
const speechActs = new Set(['greeting', 'farewell', 'gratitude', 'apology', 'sleep']);

type Scores = { label: string; score: number }[];
interface Prediction {
  intents: string[];
  why: string;
}
interface Detector {
  name: string;
  predict: (text: string, scores?: Scores) => Prediction;
  model?: string;
}

function rules(text: string): Prediction & { uncertain: boolean } {
  const c = contextFor(text, false, 'auto');
  return {
    intents: c.state === 'matched' ? c.intents : [],
    why: c.state,
    uncertain: c.state === 'uncertain',
  };
}
function fromModel(scores: Scores, threshold: number, positiveOnly = false): Prediction {
  const neutral = scores.find((s) => s.label === 'neutral')?.score ?? 0;
  const best = scores.find((s) => s.label !== 'neutral')!;
  if (best.score < threshold || best.score <= neutral)
    return { intents: [], why: `${best.label} ${best.score.toFixed(2)} (below cutoff)` };
  const intents = intentsFromScores(scores, threshold, positiveOnly);
  return { intents, why: `${best.label} ${best.score.toFixed(2)}` };
}
function hybrid(
  text: string,
  scores: Scores,
  threshold: number,
  guard: boolean,
  positiveOnly: boolean,
): Prediction {
  const r = rules(text);
  if (guard && r.uncertain) return { intents: [], why: 'rules: uncertain' };
  const acts = r.intents.filter((i) => speechActs.has(i));
  if (acts.length) return { intents: acts, why: 'rules: ' + acts.join('+') };
  return fromModel(scores, threshold, positiveOnly);
}

const faces = dictionary.entries as Face[];
function faceFor(text: string, intents: string[]): string | undefined {
  const context = { state: 'matched' as const, intents, text: text.toLowerCase(), explicit: false };
  return faces.find((f) => f.styles.includes('uwu') && faceEligible(f, context))?.text;
}

interface Case {
  text: string;
  moods: string[];
  kind: string;
}
const cases = corpus.cases as Case[];

async function runModel(m: Model) {
  const loadStart = performance.now();
  const classify = (await pipeline(
    'text-classification',
    m.id,
    m.options,
  )) as TextClassificationPipeline;
  const loadMs = performance.now() - loadStart;
  await classify('warm up');
  const scores: Scores[] = [],
    times: number[] = [];
  for (const c of cases) {
    const t = performance.now();
    scores.push((await classify(c.text, { top_k: null })) as Scores);
    times.push(performance.now() - t);
  }
  const path = join(env.cacheDir!, m.id, m.file);
  const size = (await stat(path).catch(() => null))?.size ?? 0;
  times.sort((a, b) => a - b);
  return {
    scores,
    loadMs,
    meanMs: times.reduce((a, b) => a + b, 0) / times.length,
    p95Ms: times[Math.floor(times.length * 0.95)],
    sizeMb: size / 1e6,
  };
}

function score(predictions: Prediction[]) {
  const s = {
    hit: 0,
    wrong: 0,
    miss: 0,
    silentOk: 0,
    falseAlarm: 0,
    sensitiveAlarm: 0,
    faceToday: 0,
    wrongFaceToday: 0,
  };
  predictions.forEach((p, i) => {
    const c = cases[i];
    if (c.moods.length) {
      if (!p.intents.length) s.miss++;
      else if (p.intents.some((x) => c.moods.includes(x))) {
        s.hit++;
        if (faceFor(c.text, p.intents)) s.faceToday++;
      } else s.wrong++;
    } else if (p.intents.length) {
      s.falseAlarm++;
      if (c.kind === 'sensitive') s.sensitiveAlarm++;
      if (faceFor(c.text, p.intents)) s.wrongFaceToday++;
    } else s.silentOk++;
  });
  return s;
}

const pct = (n: number, d: number) => `${Math.round((100 * n) / d)}%`;
const moodCases = cases.filter((c) => c.moods.length).length,
  quietCases = cases.length - moodCases,
  sensitiveCases = cases.filter((c) => c.kind === 'sensitive').length;

const results: ({ model: Model } & Awaited<ReturnType<typeof runModel>>)[] = [];
for (const m of models) {
  console.log(`Running ${m.name}...`);
  results.push({ model: m, ...(await runModel(m)) });
}

// Softmax models (DistilBERT) spread scores across labels, so the sweep starts low.
const thresholds = [0.15, 0.2, 0.3, 0.5, 0.7, 0.85];
const sweep = results.flatMap((r) =>
  thresholds.map((t) => ({
    model: r.model.name,
    threshold: t,
    ...score(cases.map((_, i) => fromModel(r.scores[i], t))),
  })),
);

// Each model's cutoff maximizes right − wrong − 2 × false alarms for the model alone.
const objective = (s: ReturnType<typeof score>) => s.hit - s.wrong - 2 * s.falseAlarm;
const cutoffs: Record<string, number> = {};
for (const r of results)
  cutoffs[r.model.name] = sweep
    .filter((s) => s.model === r.model.name)
    .reduce((a, b) => (objective(b) > objective(a) ? b : a)).threshold;

const detectors: Detector[] = [{ name: 'Current rules', predict: (text) => rules(text) }];
for (const r of results) {
  const name = r.model.name,
    t = cutoffs[name];
  detectors.push(
    { name: `Rules + ${name}`, model: name, predict: (x, s) => hybrid(x, s!, t, false, false) },
    {
      name: `Rules + ${name}, positive only`,
      model: name,
      predict: (x, s) => hybrid(x, s!, t, false, true),
    },
    {
      name: `Rules + ${name}, positive only + guard`,
      model: name,
      predict: (x, s) => hybrid(x, s!, t, true, true),
    },
  );
}
// What the Vencord plugin ships: the engine's own rules, with MiniLM filling in neutral messages.
detectors.push({
  name: 'Plugin: engine + MiniLM hint',
  model: 'MiniLM',
  predict: (x, s) => {
    const c = contextFor(x, false, 'auto', intentsFromScores(s!, miniLmCutoff));
    return { intents: c.state === 'matched' ? c.intents : [], why: c.state };
  },
});
// The same plugin behavior at lower cutoffs, to weigh more faces against more false alarms.
for (const cutoff of [0.5, 0.7, 0.85])
  detectors.push({
    name: `Plugin at cutoff ${cutoff}`,
    model: 'MiniLM',
    predict: (x, s) => {
      const c = contextFor(x, false, 'auto', intentsFromScores(s!, cutoff));
      return { intents: c.state === 'matched' ? c.intents : [], why: c.state };
    },
  });
const runs = detectors.map((d) => {
  const r = results.find((x) => x.model.name === d.model);
  const predictions = cases.map((c, i) => d.predict(c.text, r?.scores[i]));
  return { detector: d.name, predictions, ...score(predictions) };
});

const kinds = [...new Set(cases.map((c) => c.kind))];
const byKind = (preds: Prediction[], kind: string) => {
  const idx = cases.map((c, i) => (c.kind === kind ? i : -1)).filter((i) => i >= 0);
  const good = idx.filter((i) => {
    const p = preds[i].intents,
      g = cases[i].moods;
    return g.length ? p.some((x) => g.includes(x)) : !p.length;
  }).length;
  return `${good}/${idx.length}`;
};

const lines: string[] = [];
lines.push(
  '# Mood detection comparison',
  '',
  `Corpus: ${cases.length} messages (${moodCases} that deserve a mood, ${quietCases} that should get no face, ${sensitiveCases} of them sensitive). Labels are one author's judgments; see eval/intent-corpus.json.`,
  '',
  `A model's top non-neutral label counts only if it beats "neutral" and reaches the model's cutoff (${Object.entries(
    cutoffs,
  )
    .map(([m, t]) => `${m} ${t}`)
    .join(
      ', ',
    )}; each chosen from the sweep below to maximize right − wrong − 2 × false alarms). "Rules +" uses the keyword rules for greetings, farewells, thanks, apologies and sleep, and the model for everything else. "Positive only" never lets the model add a face for sadness, disappointment, anger, frustration or skepticism. "+ guard" also stays silent whenever the current rules flag the message as uncertain (negation, sarcasm cues, sad words, third-person reports). "Plugin" is what the Vencord plugin does: the engine keeps every keyword-rule match and stays silent on uncertain messages, and MiniLM's positive moods at the plugin's own cutoff (${miniLmCutoff}, chosen from the "Plugin at cutoff" rows) fill in only messages the rules call neutral.`,
  '',
  '## Results',
  '',
  '| Detector | Right mood | Wrong mood | Missed | Correctly silent | False alarms | Sensitive alarms | Hits with a face today | Wrong faces today |',
  '|---|---|---|---|---|---|---|---|---|',
  ...runs.map(
    (r) =>
      `| ${r.detector} | ${r.hit} (${pct(r.hit, moodCases)}) | ${r.wrong} | ${r.miss} | ${r.silentOk}/${quietCases} | ${r.falseAlarm} | ${r.sensitiveAlarm}/${sensitiveCases} | ${r.faceToday}/${r.hit} | ${r.wrongFaceToday} |`,
  ),
  '',
  '"Hits with a face today" counts correct moods for which the current `faceEligible` rules would actually allow a face (uwu style). "Wrong faces today" counts messages that should stay silent but would actually get a face under those rules; today no face is allowed for sadness, so several sensitive alarms would not yet show a face.',
  '',
  '## Correct by message kind',
  '',
  `| Detector | ${kinds.join(' | ')} |`,
  `|---|${kinds.map(() => '---').join('|')}|`,
  ...runs.map(
    (r) => `| ${r.detector} | ${kinds.map((k) => byKind(r.predictions, k)).join(' | ')} |`,
  ),
  '',
  '## Cutoff sweep (model alone)',
  '',
  '| Model | Cutoff | Right mood | Wrong | Missed | False alarms | Sensitive alarms |',
  '|---|---|---|---|---|---|---|',
  ...sweep.map(
    (s) =>
      `| ${s.model} | ${s.threshold} | ${s.hit} | ${s.wrong} | ${s.miss} | ${s.falseAlarm} | ${s.sensitiveAlarm} |`,
  ),
  '',
  '## Cost',
  '',
  '| Model | File size | Load time | Mean per message | 95th percentile |',
  '|---|---|---|---|---|',
  ...results.map(
    (r) =>
      `| ${r.model.name} | ${r.sizeMb.toFixed(1)} MB | ${(r.loadMs / 1000).toFixed(1)} s | ${r.meanMs.toFixed(1)} ms | ${r.p95Ms.toFixed(1)} ms |`,
  ),
  '',
  "Timings are from this machine's CPU in Node.js and include a first-run download when the model was not cached.",
  '',
  '## Messages that should stay silent but got a mood',
  '',
  '| Message | Kind | ' + runs.map((r) => r.detector).join(' | ') + ' |',
  '|---|---|' + runs.map(() => '---').join('|') + '|',
  ...cases.flatMap((c, i) =>
    !c.moods.length && runs.some((r) => r.predictions[i].intents.length)
      ? [
          `| ${c.text} | ${c.kind} | ${runs.map((r) => (r.predictions[i].intents.length ? r.predictions[i].why : '')).join(' | ')} |`,
        ]
      : [],
  ),
);
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'intent-comparison.md'), lines.join('\n') + '\n');
await writeFile(
  join(outDir, 'intent-comparison.json'),
  JSON.stringify(
    {
      corpusVersion: corpus.version,
      cutoffs,
      models: results.map((r) => ({
        ...r.model,
        loadMs: r.loadMs,
        meanMs: r.meanMs,
        p95Ms: r.p95Ms,
        sizeMb: r.sizeMb,
      })),
      summary: runs.map(({ predictions, ...s }) => s),
      sweep,
      cases: cases.map((c, i) => ({
        ...c,
        predictions: Object.fromEntries(runs.map((r) => [r.detector, r.predictions[i]])),
        topLabels: Object.fromEntries(
          results.map((r) => [
            r.model.name,
            r.scores[i].slice(0, 3).map((s) => [s.label, +s.score.toFixed(3)]),
          ]),
        ),
      })),
    },
    null,
    2,
  ),
);
console.log(lines.slice(0, 40).join('\n'));
console.log(`\nFull report: ${join(outDir, 'intent-comparison.md')}`);
