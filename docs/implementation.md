# Implementation notes — 0.1.0

The browser app, reusable ESM/TypeScript library, and HTTP adapter are implemented. The [specification](converter-spec.md) remains the behavior contract; these notes record the concrete implementation choices.

## Layout

| Location | Responsibility |
|---|---|
| `src/core/options.ts` | Strict validation and nested preset resolution; typed `ConversionError`. |
| `src/core/segment.ts` | Protected ranges, words, quotes, complete grapheme clusters, and sentence/ending ownership. |
| `src/core/intent.ts` | Phrase-based intent classification and per-entry eligibility. |
| `src/core/mood.ts` | Maps outside classifier scores (GoEmotions labels) to dictionary intents for `emoticons.detectedIntents`. |
| `src/core/random.ts` | Stateless deterministic sampling. |
| `src/core/index.ts` | Vocabulary/spelling, expression budgets, ordered edits, and optional diagnostics. |
| `src/browser/` | Browser controls, dictionary explorer, safe text rendering, and conversion worker. |
| `src/server.ts` | Node HTTP adapter and static browser assets. |
| `data/vocabulary.json` | Versioned whole-word substitutions and nya allowlist. |
| `data/emoticons.json` | Face dictionary (curated plus intake entries) with canonical forms, aliases, eligibility, and sources. |
| `data/emoticon-candidates.json` | Every collected candidate with its intake verdict, shown on the Emoticon wiki page. |
| `scripts/emoticon-candidates.ts` | Intake: collect, merge reviewer results, promote accepted faces. |
| `tests/fixtures.ts` | Shared exact spelling and preservation inputs. |

`npm run build` emits `dist/index.html` and browser assets, `dist/library/index.js`, TypeScript declarations under `dist/types`, and the standalone `dist/server.mjs`. The server serves the browser assets and `POST /v1/convert`. Server/library bundles and declaration files are not exposed as public static assets.

## Deterministic sampling

Engine 0.1.0 computes a sample independently for each decision:

1. Serialize `[seed, ruleId, originalUtf16Position]` using JavaScript `JSON.stringify`, with no extra whitespace or Unicode normalization.
2. Encode that JSON string as UTF-8 using `TextEncoder`.
3. Begin with the unsigned FNV-1a offset `0x811c9dc5`. For every byte, compute `Math.imul(hash ^ byte, 0x01000193) >>> 0`.
4. Divide the unsigned result by `4294967296` to produce a number in `[0, 1)`.
5. A rate succeeds when `sample < rate`. Sort eligible face IDs in code-unit order and select `floor(sample * candidateCount)`.

Word decisions use `stutter` and `stretch` with the original word start. Sentence decisions use `emoticon_rate`, `emoticon_choice`, `nya_particle`, and `tilde` with the original sentence segment start, including leading whitespace when present. There is no mutable random stream. Enabling diagnostics cannot consume or change randomness.

Independent reference vectors are stored in [tests/random-vectors.json](../tests/random-vectors.json):

| Seed (JSON string) | Rule | Position | Unsigned hash |
|---|---|---:|---:|
| `"0"` | `emoticon_rate` | 0 | 1952997390 |
| `"review"` | `emoticon_choice` | 0 | 2523195223 |
| `"にゃ🐱"` | `stutter` | 12 | 446133162 |
| `"a\\b\n\""` | `tilde` | 240 | 1650497278 |

Rules, engine, segmentation, and dictionary versions all begin at `0.1.0`. Changing sampling requires an engine-version change. Changing tokenization, existing-expression recognition, sentence ownership, or the pinned Unicode implementation requires a segmentation-version change.

## Unicode and structural boundaries

Both builds bundle `unicode-segmenter@0.17.3`, including its Unicode 17 grapheme and general-category tables. Host `Intl.Segmenter`, locale sorting, and normalization are not used for output decisions. See the dependency's [official repository](https://github.com/cometkim/unicode-segmenter).

Protected spans align outward to grapheme boundaries. Whole Unicode words, combining marks, emoji modifiers, variation selectors, and joined emoji are copied unchanged. Custom terms match literally and case-sensitively at letter/number boundaries. Matching a custom term never executes it as a regular expression.

Quote closures are precomputed in a backward pass, so a long sequence of unmatched opening quotes does not repeatedly scan the document. Unmatched marks suppress expression in the affected sentence without claiming the rest of the document as quoted material. Common abbreviations and decimals receive explicit handling; uncertain boundaries suppress expression. These are bounded plain-text recognizers, not a full language or document parser.

## Context and active faces

Automatic phrase detectors cover greetings, farewells, explicit gratitude, responsibility for a mistake, bedtime, clear celebrations, direct comfort offers, and direct affection. Negation, selected distress words, suspected sarcasm, reported speech, and conflicting clauses can suppress new expression. Neutral prose still permits requested stutters, allowlisted stretching, and tildes. A caller may pass `emoticons.detectedIntents` from its own classifier: these fill in only sentences the detectors leave neutral, and they count as detected rather than author-selected. `src/core/mood.ts` maps GoEmotions labels to dictionary intents (`intentsFromScores`), dropping negative moods by default; the Vencord plugin and `npm run eval:intent` share it.

The selector filters by style, intent, intensity, ASCII preference, and entry eligibility before sampling. All inserted forms are canonical; existing aliases are copied exactly. Each entry's `eligibility` field names its rule in `faceEligible`, so new entries need no code change:

- `auto`: any matching detected or author-selected intent.
- `sleep_cue`, `hug_cue`, `mishap_cue`, `affection_cue`: a matching intent plus a bedtime, hug, small-mistake, or direct-affection phrase in the sentence.
- `comfort_intent`: a detected or selected comfort intent.
- `explicit`: only with a matching author-selected intent and no detected contradiction.
- `reference` (or anything unknown): never inserted, only recognized in input.

Negative, teasing, and smug faces are `explicit` by the [intake criteria](emoticon-criteria.md), so automatic detection never inserts them. Unsupported intent/entry combinations add no face. Copying a face directly from the dictionary is always an author choice.

Eligibility is a conservative heuristic, not full sentiment analysis. These constraints reduce obvious mismatches but cannot guarantee authentic usage for every sentence. Extend the phrase/eligibility rules with review examples before enabling more entries.

Existing faces in the input are protected by `segment.ts` using an index of every dictionary spelling keyed by its first two code units, so recognition stays a single pass as the dictionary grows. The Vencord build keeps only the fields the engine reads (`id`, `text`, `aliases`, `intents`, `intensity`, `styles`, `selection`, `eligibility`) to keep the plugin small.

## Limits and diagnostics

- Text: at most **100,000 Unicode code points**, with unpaired UTF-16 surrogates rejected.
- HTTP body: at most **1 MiB**, including chunked requests; JSON must be valid UTF-8.
- Seed: at most **1,024 UTF-16 units**.
- Custom terms: at most **256 nonempty strings**, totaling at most **16,384 UTF-16 units**.
- Decoration budget/gap: nonnegative safe integers. Face intensity: integer 1–3. Rates: finite numbers 0–1.
- Diagnostics: **2,000 combined records**, sorted by source position with changes, protected spans, then decisions as tie priority. Truncation only shortens the report.

Protection reasons include `url`, `email`, `path`, `handle`, `filename`, `code`, `quoted_text`, `quote_mark`, `uncertain_quote`, `uncertain_code`, `preserve_term`, `existing_face`, `existing_particle`, `existing_word`, `probable_face`, `structured_or_unicode_word`, and `unicode_symbol`. Structural recognizers take priority; overlapping recognized spans retain their union and applicable recorded reasons. Diagnostics omit inapplicable optional fields so the library and JSON response have the same shape.

The browser uses a 100 ms debounce and a dedicated worker. A new request invalidates older results; stale worker replies cannot replace the latest preview. Highlighting uses output offsets and text nodes, never HTML interpolation. Original input is not persisted or sent for conversion.

## Verification and performance

On 2026-09-21, Windows with Node 26.4.0 and Playwright Chromium 153:

- **63 core/API tests passed** (rerun 2026-10-13 with the 1,189-entry dictionary), including all 40 review cases, every dictionary spelling, input/option validation, grapheme preservation, budgets, diagnostic offsets, HTTP limits, and static-path restrictions.
- **6 browser tests passed** against the production build, including shared browser/API/library fixtures, offline conversion, clipboard, dictionary controls, desktop/mobile layout, large input, and stale-result handling.
- Production bundling and TypeScript checking passed. No trained model is used.

An observed browser preview of 100,000 code points took **197 ms**, including the 100 ms debounce and worker communication, during the concurrent browser suite. Treat **500 ms for a maximum-size preview on this desktop** as an initial responsiveness target, not a cross-device guarantee. The worker keeps the conversion computation off the UI thread.

`npm run benchmark` measures short messages, 100,000-code-point prose, a single long word, Unicode, and unmatched quotes/code. A delimiter-driven email/filename scan avoids the repeated greedy searches that initially made a single long word slow. Timings vary by machine and concurrent load; rerun the script when changing recognition or expression rules. Growth is bounded by the specific spelling rules and expression budgets, not an arbitrary output truncation step.

Structural checks establish exact behavior and reproducibility. Naturalness and contextual fit still need ongoing review of actual messages. Additional languages, structured document parsing, public hosting policies, and model-based rewriting remain separate work.
