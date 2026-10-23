import { performance } from 'node:perf_hooks';
import { convert } from '../src/core/index';
const phrase =
  'Hello, world! Thanks for coming. I really love the small cats. 👩🏽‍💻 https://example.com/hello\n';
const max = [...phrase.repeat(1200)].slice(0, 100000).join('');
const cases: [string, string][] = [
  ['short', phrase],
  ['100k prose', max],
  ['100k single word', 'r'.repeat(100000)],
  ['100k Unicode', '👩🏽‍💻'.repeat(25000)],
  ['unclosed quotes', '“hello '.repeat(14000)],
  ['unclosed code', '`hello\n'.repeat(14000)],
];
for (const [name, input] of cases) {
  convert(input);
  const times: number[] = [];
  let result = '';
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    result = convert(input, { intensity: 'heavy' }).text;
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  console.log(
    `${name.padEnd(19)} ${String([...input].length).padStart(6)} code points | median ${times[2].toFixed(2).padStart(8)} ms | max ${times[4].toFixed(2).padStart(8)} ms | growth ${(result.length / input.length).toFixed(3)}x`,
  );
}
