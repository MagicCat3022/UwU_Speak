# UwU converter specification

Status: implemented in version 0.1.0. The shared TypeScript converter, local browser interface, and HTTP adapter are available. See [implementation notes](implementation.md) for concrete algorithms, validation limits, and verification results.

Revised 2026-09-21 to include the agreed implementation-review refinements.

## Purpose and approach

Convert an English input string into recognizable UwU or nya speech while retaining its message, word order, and formatting. Use a shared, deterministic TypeScript rules engine that can run in a browser or behind an HTTP API.

The first version uses explicit vocabulary, spelling rules, and optional expression. A trained model is unnecessary for these transformations. Contextual paraphrasing or character dialogue would be a separate future feature with its own evaluation.

Existing implementations demonstrate the recurring pattern: word substitutions, `r/l` replacement, nya spelling, occasional stutters, and text faces. These inform the design; the presets and exact behaviors below are project decisions. [Uwuifier source](https://raw.githubusercontent.com/Schotsl/Uwuifier/main/index.ts), [uwuify](https://github.com/Daniel-Liu-c0deb0t/uwu)

Use the existing [emoticon dictionary](../data/emoticons.json) and [selection guide](emoticon-dictionary.md) for faces. Keep vocabulary substitutions and particles such as `nya~` separate from that dictionary.

## Supported input and preservation

The first version accepts plain text, including Unicode, whitespace, and line breaks. It assumes that editable prose is English; it does not detect or translate languages. Words containing accented or non-ASCII letters pass through unchanged. ASCII words in other languages cannot reliably be distinguished from English.

Preserve the original characters of protected spans:

- URLs, email addresses, handles, and explicit file paths.
- Inline code and fenced code blocks.
- Recognized existing emoticons and kaomoji, including their aliases.
- Balanced quoted passages by default; `quotedText: "convert"` permits vocabulary and spelling conversion inside them.
- Recognized existing stylized words, stutters, and nya particles as described below.
- Caller-specified words or phrases in `preserveTerms`.
- Clearly structured tokens such as `read_file`, `userName`, and `R2D2`.

Recognize ASCII and typographic double quotes. Recognize paired single quotes only when they delimit a passage; apostrophes inside words such as `don't` do not open a quote. An unmatched quote should suppress automatic expression in the ambiguous sentence rather than consume the rest of the document as a quotation.

`quotedText` defaults to `"preserve"`. With `"convert"`, preserve quotation marks and all other protected spans inside a quotation while converting its prose vocabulary and spelling. In the first version, do not generate new expression inside quoted passages, and do not use their emotional cues to decorate the narrator's text. For example, `She said "I'm happy!"` does not establish that the narrator is happy. A caller wanting full expression inside dialogue can convert the dialogue contents as a separate input. This keeps the option useful for pasted dialogue without inventing speaker attribution.

Use conservative recognizers. For an uncertain possible code or face span, preserve the span and suppress its decoration. This does not promise complete recognition of every possible identifier or kaomoji. Ordinary personal names are not automatically identifiable: callers can protect them with `preserveTerms`.

Match protected terms case-sensitively, with Unicode word boundaries at letter/number edges. Match the longest phrase first. Resolve overlapping protected spans by preserving their union. Keep source offsets rather than substituting sentinel strings that could collide with real input.

Recognize URLs without swallowing ordinary trailing sentence punctuation or unmatched closing brackets. Preserve balanced parentheses that are part of the URL. Protect known faces with longest-match rules before treating their internal punctuation as sentence boundaries. Match alphabetic faces such as `uwu` only at token boundaries.

Associate an existing face immediately following terminal punctuation, separated only by horizontal whitespace, with the preceding sentence. Thus `Hello! :3 Goodbye!` already decorates `Hello!`. A face at the start of a message can belong to the following sentence. If a line break or other structure makes ownership ambiguous, preserve the face and suppress new endings on the adjacent candidate sentences. Internal face punctuation does not close a sentence. Apply the same ownership policy to existing standalone nya particles.

Preserve whitespace, line endings, numbers, existing punctuation, and emoji. New stutters, tildes, particles, and faces may add characters at explicitly defined boundaries. Do not trim the input, collapse spaces, force lowercase, reorder words, or normalize Unicode display strings.

Preserve complete grapheme clusters, including combining marks, variation selectors, skin-tone modifiers, and joined emoji sequences. Do not split an accented word into an editable ASCII fragment and a detached mark: both precomposed `crème` and decomposed `cre\u0300me` must pass through with their original representation intact. Token boundaries and edit boundaries must respect these sequences. Unicode defines these user-perceived character boundaries separately from code-point boundaries. [Unicode text segmentation](https://www.unicode.org/reports/tr29/)

HTML and Markdown are not parsed as document formats in the first version. Callers working with a document should pass its editable text nodes or prose segments and preserve its structure themselves. Recognizing code spans in plain text does not imply full Markdown support.

## Processing sequence

1. **Validate and resolve options.** Apply defaults, then the selected preset, then explicit overrides. Resolve a seed and record version metadata.
2. **Segment the original input.** Identify protected spans, editable words, whitespace, punctuation, sentences, and quotation boundaries. Preserve grapheme clusters and associate existing expressions with their sentences. Blank lines and end-of-input also close a sentence segment; ordinary line wrapping need not do so.
3. **Annotate intent from original prose.** Distinguish matched intent, neutral prose, and uncertain emotion or structure. Apply author-provided intent only where compatible. Track negation, quoted speech, and existing expressions before changing any spelling.
4. **Replace vocabulary.** Look up eligible original words, handling apostrophe suffixes under the rules below. Mark replacement results as terminal for subsequent spelling passes.
5. **Apply spelling rules to remaining eligible words.** Preserve case and process letter replacement followed by optional nya spelling.
6. **Add word expression.** Apply eligible stretching and stuttering with seeded decisions and per-sentence limits.
7. **Choose sentence endings.** Select at most one compatible face and at most one soft ending under the combination policy and shared sentence budget.
8. **Reassemble and return.** Copy protected spans and unchanged text exactly; include reproducibility metadata and an optional change report. Do not run spelling or punctuation replacements on the completed output.

Sentence segmentation must account for punctuation inside faces, abbreviations, decimal numbers, URLs, and code. If a boundary is uncertain, skip automatic ending decoration there. Spelling conversion can still proceed on confidently identified prose words.

## Vocabulary and spelling

Match complete words rather than substrings. Eligible English words contain ASCII letters and optionally ASCII or typographic apostrophes (`'` or `’`). Combining marks belong to their word and make the complete word ineligible for ASCII spelling rules. Underscores, digits embedded in words, and mixed-case identifiers are not eligible prose words.

Support lowercase, initial-capital, and all-capital words. Transfer the original case pattern to replacements: `love → wuv`, `Love → Wuv`, `LOVE → WUV`. Leave other mixed-case words such as `LoVe` unchanged by default. Use lowercase for dictionary lookup only, never as a normalization of the whole input.

Determine case from letters, ignoring apostrophes. Keep contractions together: `I'll → I'ww`, `we're → we'we`, and `we’re → we’we`. Preserve the original apostrophe character. Normalize apostrophe variants only in lookup keys, never in display text.

Try a full-word vocabulary lookup first. If none matches and the word ends in apostrophe-plus-`s`, transform its base and reattach the suffix unchanged: `love's → wuv's`, `love’s → wuv’s`. Recognize the suffix case-insensitively and retain its original case. This is an orthographic suffix rule; it does not need to decide whether the suffix means possession or a contraction. A trailing possessive apostrophe after `s` is likewise retained: `friends’ → fwiends’`. Other contractions receive ordinary spelling rules, without splitting off arbitrary suffixes or inventing vocabulary inflections.

The initial vocabulary is deliberately small:

| Original word | Replacement | Notes |
|---|---|---|
| `hi` | `hai` | Greeting spelling; available in both UwU and nya styles. |
| `love` | `wuv` | Explicit replacement instead of a global `ove` rewrite. |
| `loves` | `wuvs` | Explicit inflection. |
| `loved` | `wuvved` | Explicit inflection. |
| `loving` | `wuvving` | Explicit inflection for consistent spelling. |
| `lovely` | `wuvwy` | Explicit adjective spelling. |
| `small` | `smol` | Keep this final spelling. |
| `okay` | `okie` | Eligible for optional stretching. |
| `ok` | `okie` | Eligible for optional stretching. |
| `thanks` | `thankies` | Gratitude word replacement. |

These entries define intended project vocabulary, including the user's requested style. They do not claim that every community uses the same spellings. Do not infer other inflections or replace fragments inside unrelated words. Future phrase rules will need an explicit policy for their internal whitespace.

New vocabulary results are terminal for spelling: `small → smol` must not subsequently become `smow`. These newly generated words remain eligible for explicitly permitted expression, such as `okay → okie → okieee`. In contrast, recognize destination words already present in the input as intentional stylized text and preserve them from both spelling and new word expression, even when vocabulary substitution is disabled. Thus an input `smol` stays `smol`; it does not acquire a new stutter. Recognize these forms at complete word boundaries, including supported apostrophe suffixes.

Recognize whole-word existing stretched forms of `hai` and `okie` with one or more additional copies of their final vowel, such as `haii`, `haiii`, and `okieee`; preserve them exactly and do not stretch or stutter them. Recognize existing repeated-initial stutters such as `r-really`, `w-weawwy`, and `p-p-please` as complete spans and preserve their spelling and hyphens. Use case-insensitive initial matching for recognition while copying the original case. Ordinary hyphenated words can have their lexical parts spelled independently, but do not receive new stutters. These recognizers cover known patterns, not every possible stylized word.

| Rule | Behavior | Examples |
|---|---|---|
| Letter replacement | Replace every `r`/`l` with `w`, and `R`/`L` with `W`, in eligible nonterminal words. | `hello → hewwo`; `please → pwease`; `sorry → sowwy`; `really → weawwy` |
| Nya spelling, words scope | In nya style, transform only the allowlisted complete words `no`, `not`, `now`, `new`, and `nice`. This feature is independent of the vocabulary toggle. | `no → nyo`; `not → nyot`; `now → nyow`; `new → nyew`; `nice → nyice` |
| Nya spelling, full scope | In nya style, insert `y` after `n` immediately before an ASCII vowel in eligible nonterminal words. Do not insert before an existing `y`. | `no → nyo`; `nice → nyice`; `banana → banyanya` |
| Nya case | Use lowercase `y` within lowercase/title-case words and uppercase `Y` in all-capital words. | `No → Nyo`; `NO → NYO` |

Keep nya spelling independently switchable within nya style. Use words scope for light and medium intensity and full scope for heavy intensity; `nyaScope` overrides that choice. Words outside the allowlist still receive ordinary `r/l` replacement when enabled. Allowlist outputs already in the input, such as `nyo`, receive the same preservation from spelling and word expression as existing vocabulary destinations. `style: "uwu"` does not enable nya spelling or nya particles.

Do not apply a global `th → d` or `ove → uv` rule in the first version. Explicit vocabulary allows review of the intended word rather than rewriting every matching substring.

Spelling substitutions are generally one-way: `r` and `l` both become `w`. The converter cannot reliably reconstruct the original input from the output.

## Expression rules

Expression is optional. The core spelling rules do not depend on random choices.

| Feature | Eligibility and behavior |
|---|---|
| Stutter | For an editable word with at least three ASCII letters, repeat the first letter of its final converted spelling once with a hyphen: `please → p-pwease`, `really → w-weawwy`, `Really → W-Weawwy`. Skip protected, mixed-case, already stretched, or already hyphenated words. At most one newly stuttered word per sentence. |
| Stretch | Use an allowlist: `hai → haiii` and `okie → okieee`, with case transferred. Add two copies of the final vowel. Skip already stretched forms. At most one newly stretched word per sentence. |
| Tilde | Insert one `~` after the final editable word, before any terminal `.`, `!`, or `?`. Example: `okay! → okie~!`. Preserve punctuation; skip a sentence whose final content is protected or already ends in a tilde. |
| Nya particle | In nya style, append ` nya~` after the sentence's punctuation and closing quotes. Use only in an already playful, affectionate, or cute context, or with compatible author-selected intent. |
| Emoticon | Append one space and a compatible canonical dictionary face after punctuation and closing quotes, or after a newly added nya particle when combined. Use the dictionary's intent, style, intensity, and selection restrictions. |

Do not newly stretch and stutter the same word; stretching has priority when both decisions succeed. A soft ending is either a word-final tilde or a nya particle, never both. A nya particle already includes its own tilde.

With `endings.allowCombination: true`, a sentence may receive one face plus one soft ending. This allows outputs such as `haiii~ :3` and `I wuv you! nya~ uwu` when context, options, and sampling permit. With combinations disabled, the sentence receives at most one component. Evaluate the face decision first; then try an eligible nya particle, falling back to a tilde. With combinations enabled, retain the selected face and soft ending; with combinations disabled, a selected face takes priority. Failed eligibility or rate checks insert nothing. Actual frequencies can be below attempt rates because of eligibility, priority, and budgets.

Render a word-final tilde before existing terminal punctuation, and render a particle followed by a face after terminal punctuation and closing quotes. Do not add commas or remove punctuation just to accommodate decorations. A combined ending consumes one decorated-sentence slot, not two; limits are defined below.

An existing face, standalone nya particle, or terminal tilde suppresses all new ending components in that sentence, even when combinations are enabled. Preserve these tokens as existing expression. Count that sentence once for spacing, regardless of how many components it already contains. Do not create expression inside quotations in the first version. Sentences with only protected content receive none. For editable prose, the intent states below determine which new expression is eligible.

| Intent state | Definition | Eligible expression |
|---|---|---|
| Matched | A supported contextual rule or compatible author-selected intent identifies the intended tone. | Word expression and endings that satisfy their individual usage constraints. |
| Neutral | No expressive cue or ambiguity flag was detected in otherwise clear prose. This is a heuristic classification, not proof of emotionlessness. | Requested stutters, allowlisted stretching, and tildes; no automatic emotional face or nya particle without a compatible supported intent override. |
| Uncertain | Conflicting cues, suspected sarcasm, an unsupported emotional cue, unclear attribution, or uncertain structure prevents a reliable choice. | No new expression. Vocabulary and spelling can still apply to confidently identified prose. |

For example, `Status: ready.` may receive the chosen spelling style and a tilde, while `Thanks for nothing.` must not gain a cheerful face or other automatic flourish from the word `thanks`. An ordinary question is not automatically confusion. Existing expressions are preserved in all states.

## Presets and configuration

The default is `style: "uwu"`, `intensity: "medium"`, and `seed: "0"`. Intensity controls vocabulary and expression, not whether half of a word's letters happen to change.

All values in this table are the initial implementation defaults, to tune with example outputs; they are not measured conventions.

| Setting | Light | Medium | Heavy |
|---|---:|---:|---:|
| Letter replacement | on | on | on |
| Vocabulary | off | on | on |
| Nya spelling, when style is nya | on, words scope | on, words scope | on, full scope |
| Stutter attempt rate per eligible word | 0 | 0.03 | 0.10 |
| Stretch attempt rate per eligible word | 0 | 0.05 | 0.15 |
| Tilde attempt rate per eligible sentence | 0 | 0.10 | 0.25 |
| Nya-particle attempt rate, when style is nya | 0 | 0.08 | 0.20 |
| Face attempt rate per eligible sentence | 0.10 | 0.20 | 0.35 |
| Maximum face intensity | 1 | 2 | 3 |
| Allow one face plus one soft ending | off | on | on |
| Maximum newly decorated sentences per message | 1 | 2 | 3 |
| Undecorated sentences between new endings | 2 | 2 | 1 |

For messages of at most 240 Unicode code points, cap newly decorated sentences at one regardless of the preset. That one sentence may still contain a face plus a soft ending when combinations are enabled. A budget is a maximum, never a requirement to insert something. Every sentence with an existing face, nya particle, or terminal tilde starts the same spacing gap, but does not count against the number of newly decorated sentences. Word-level stretching and stuttering retain their separate per-sentence limits.

The public options object should support:

| Option | Contract |
|---|---|
| `style` | `"uwu"` or `"nya"`. Determines cat behavior and the emoticon style tag. |
| `intensity` | `"light"`, `"medium"`, or `"heavy"`. |
| `seed` | String, default `"0"`; stable input to deterministic variation. |
| `preserveTerms` | Array of nonempty strings; default `[]`. |
| `quotedText` | `"preserve"` by default or `"convert"`; conversion changes quoted vocabulary/spelling while retaining quotation marks and separate speaker attribution. |
| `nyaScope` | `"words"` or `"full"`, defaulted by intensity. Used only when nya spelling is enabled. |
| `features.vocabulary` | Boolean override of the preset. |
| `features.letterSwap` | Boolean override; default `true`. |
| `features.nyaSpelling` | Boolean override within nya style. Setting it to `true` in UwU style is invalid. |
| `rates.stutter`, `rates.stretch`, `rates.tilde`, `rates.nya`, `rates.emoticon` | Finite numbers from 0 through 1, overriding preset attempt rates. `rates.nya` must be zero in UwU style. |
| `endings.maxPerMessage` | Nonnegative integer limiting newly decorated sentences, subject to the short-message cap. A face-plus-soft-ending combination counts once. Zero disables all new ending components. |
| `endings.minSentenceGap` | Nonnegative integer overriding the preset. |
| `endings.allowCombination` | Boolean overriding the preset; allows at most one face plus one soft ending per newly decorated sentence. |
| `emoticons.enabled` | Boolean, default `true`. |
| `emoticons.intent` | `"auto"` by default, or one of the intent tags present in the dictionary. An explicit intent is an author preference, not a detected fact. |
| `emoticons.detectedIntents` | Array of distinct intent tags present in the dictionary; default `[]`. These are moods detected by an outside classifier, such as the optional model in the Vencord plugin. They apply only to sentences the phrase rules classify as neutral and never override uncertainty. They are not an author choice, so they cannot enable `selection: "explicit"` entries or author-only faces. |
| `emoticons.maxIntensity` | Integer 1 through 3 overriding the preset. |
| `emoticons.asciiOnly` | Boolean, default `false`; filters the actual canonical face characters. Does not rewrite original Unicode input. |
| `diagnostics` | Boolean, default `false`; includes the optional change report without altering conversion decisions. |

Merge nested option objects by field, so setting only `rates.stutter` does not erase the other rates. Reject unknown keys, invalid enum values, nonfinite rates, invalid types, and conflicting settings rather than silently guessing. Treat omitted fields as defaults; `null` is not an omitted field.

To request spelling conversion alone, set all five rates to zero. To disable spelling as well, set all three spelling/vocabulary features to `false`. The resulting output must equal the original input exactly.

## Emoticon selection and intent

Load entries from the versioned JSON dictionary. Match `styles` against the converter's `style`; a `classic`-only entry is not automatically eligible for UwU/nya output. Match meanings through the existing `intents` tags, not through new labels that the data does not contain.

Implement a small initial set of phrase-based intent detectors: greetings, farewells, explicit gratitude, taking responsibility for a mistake, bedtime messages, clear celebrations, and direct offers of comfort. Classify the rest as neutral or uncertain under the expression-state rules; neither state by itself licenses an emotional face. Broad sentiment detection is not required for the first version.

Keep machine-readable intent rules separate from the dictionary's descriptive `use_when` and `avoid_when` strings. Each contextual entry needs an implemented eligibility rule covering its usage constraints before it enters the automatic pool. Initially unsupported entries remain available for future rules; being present in the dictionary alone does not enable insertion.

For `selection: "explicit"` entries, require a matching author-selected `emoticons.intent`. A keyword match never enables them. An explicit intent may narrow selection and permit its matching explicit entries, but it does not override protected spans, existing expressions, style/intensity limits, or a clear contextual contradiction. In a mixed message, apply it only to compatible sentences. Use a supported intent override as a cue for nya particles only when it denotes affection, cuteness, or cat playfulness.

Filter candidates before sampling; skip if none remain. Sort candidates by stable ID and initially give eligible entries equal weight. More aliases do not increase a face's chance of selection. Avoid repeating the previously inserted face if another eligible entry exists. Use canonical `text` for insertion; preserve an input alias exactly.

This remains heuristic context matching. Sarcasm, indirect speech, and mixed emotions will sometimes be unclear; uncertain sentences receive no new expression. Clear neutral prose can still receive the explicitly requested non-emotional style features. The [dictionary guide](emoticon-dictionary.md) supplies additional review cases.

## Determinism and versions

The same input, fully resolved conversion options, seed, engine version, spelling-rule version, segmentation version, and emoticon-dictionary version must produce the same output in the browser and API. Enabling diagnostics must not change the output text.

Use versioned deterministic sampling rather than `Math.random()`. Derive each decision from the seed, rule ID, and original source position, with a distinct decision key for face selection versus rate checks. Define the exact hash/PRNG and its cross-runtime golden vectors when implementing the engine; changing that algorithm requires an engine-version change. Original positions should use UTF-16 offsets for consistent JavaScript indexing, while the public input limit and short-message threshold count Unicode code points.

Ship the same versioned tokenization rules and Unicode boundary data in the browser and API builds, and expose their combined revision as `segmentationVersion`. Do not make output decisions depend on the host's default locale or unpinned `Intl.Segmenter` behavior. The ECMAScript specification allows implementation-dependent segmentation, so a shared seed alone does not establish identical output across runtimes. [ECMAScript boundary determination](https://tc39.es/ecma402/#sec-findboundary)

Specify normalization-free UTF-8 encoding and an unambiguous field serialization for random-decision keys. Sort stable ASCII rule and entry IDs by code-unit order, not locale-sensitive collation. Version changes to segmentation data, existing-expression recognition, and sentence ownership. Run the same Unicode and seeded-output fixtures in the browser and server runtimes. Unicode boundaries protect original sequences; they do not authorize normalizing those sequences.

The browser's optional shuffle control changes the seed. Re-rendering the same input must not silently choose new decorations. Return the resolved seed and versions with each result so a saved configuration can reproduce it when those versions are available.

Repeated conversion is not guaranteed to be idempotent: decorations can accumulate and lossy spellings cannot always be recognized. Browser previews must always convert the original input, not the previous output.

Known stylized-word and existing-ending rules reduce accidental amplification, but do not replace that original-input requirement. Test the known cases directly instead of promising universal detection of already converted text.

## Optional change report

With `diagnostics: true`, include a `diagnostics` object alongside `text` and `meta`. The library and HTTP adapter use the same shape; omit it by default. This supports development, example review, and optional change highlighting without exposing implementation details in the normal converter flow.

- `changes`: final replacements and insertions with `inputStart`, `inputEnd`, `outputStart`, `outputEnd`, `before`, `after`, and ordered `ruleIds`. Use half-open UTF-16 ranges. For insertions, the input range is empty. Combine multiple passes on one source token into one final change, and coalesce insertions at the same source position in rendered order.
- `protectedSpans`: source `inputStart`/`inputEnd` ranges and `reasonCodes`, such as `url`, `code`, `quoted_text`, `preserve_term`, or `existing_expression`. Overlapping recognizers produce a merged span with all applicable reasons.
- `decisions`: one summary per evaluated expression rule and location, with its source range, `intentState`, `ruleId`, optional matched `intent`/`entryId`, `outcome` (`selected` or `skipped`), and `reasonCode`. Separate summaries can explain a selected face and a rejected soft ending at the same location. Explain outcomes such as `no_matching_intent`, `context_uncertain`, `existing_ending`, `unsupported_eligibility`, `intensity_limit`, `rate_not_selected`, or `budget_exhausted`. Do not present heuristic classifications as measured confidence scores.
- `truncated`: boolean. Cap the combined report at 2,000 records in deterministic source order, using changes, protected spans, then decisions as tie-break priority. Truncation affects only the report and never the output.

Report offsets into the unmodified original input and final output, and keep all endpoints outside grapheme-cluster interiors. Resolve overlapping recognition at word edges conservatively before editing. The report should make it possible to explain both `really → w-weawwy` and why no emoticon was added to a sentence. Tests must also verify that diagnostics on/off produce identical text and reproducibility metadata.

## Shared library, browser, and API

Expose a pure synchronous core function:

```ts
convert(text: string, options?: ConversionOptions): ConversionResult
```

It should have no DOM, network, clock, environment-randomness, or storage dependencies. Supply versioned data with the build. Browser and server adapters call the same function and use the same resolved defaults.

The browser interface needs input and output text areas, UwU/nya selection, an intensity control, optional expression controls, copy output, and a shuffle action. Advanced controls include quoted-text conversion, words/full nya spelling, and decoration combinations. Keep optional change highlighting separate from the normal output. Retain the original input. Once assets are loaded, conversion should work locally without a server request. Debounce live previews for larger input and consider a worker if profiling shows a responsiveness problem.

Render strings as text, including faces containing `<`, `>`, `*`, or backslashes. Avoid HTML interpretation. Clipboard content is the raw converted text, not renderer escape sequences.

The HTTP endpoint is `POST /v1/convert` with `Content-Type: application/json`:

```json
{
  "text": "Hello world!",
  "options": {
    "style": "uwu",
    "intensity": "light",
    "seed": "demo",
    "rates": {
      "stutter": 0,
      "stretch": 0,
      "tilde": 0,
      "nya": 0,
      "emoticon": 0
    }
  }
}
```

The response and library result share this shape. Version values below illustrate the planned initial release:

```json
{
  "text": "Hewwo wowwd!",
  "meta": {
    "engineVersion": "0.2.0",
    "rulesVersion": "0.1.0",
    "segmentationVersion": "0.1.0",
    "emoticonDictionaryVersion": "0.1.0",
    "seed": "demo"
  }
}
```

Accept empty input and return empty output. Set an initial shared limit of 100,000 Unicode code points of input; also cap the HTTP request body at 1 MiB. Reject unpaired UTF-16 surrogates rather than silently replacing characters. Do not coerce numbers, arrays, or objects into strings.

Use a structured error object with `error.code`, `error.message`, and an optional `error.field`. The core throws a typed validation error; the HTTP adapter maps it to the following statuses:

| Status | Meaning |
|---|---|
| `200` | Conversion succeeded, including an empty string. |
| `400` | Malformed JSON, missing `text`, wrong input type, or invalid Unicode scalar sequence. |
| `413` | Input or request body exceeds its limit. |
| `415` | Unsupported request content type. |
| `422` | Invalid, unknown, or conflicting options. |

This specifies an adapter contract, not a hosting choice. Authentication, deployment, and application-specific quotas can be added when an API consumer is selected.

## Acceptance examples

All examples in this table have all expression rates set to zero. Exact and behavioral fixtures are automated in the [test suite](../tests/core.test.ts).

| Style / intensity | Input | Expected output |
|---|---|---|
| UwU / light | `Hello world!` | `Hewwo wowwd!` |
| UwU / medium | `Hi! Please bring the small cat.` | `Hai! Pwease bwing the smol cat.` |
| UwU / medium | `Thanks, I really love it.` | `Thankies, I weawwy wuv it.` |
| UwU / medium | `Sorry! Okay, no problem.` | `Sowwy! Okie, no pwobwem.` |
| Nya / medium | `No, I love nice cats.` | `Nyo, I wuv nyice cats.` |
| Nya / medium, words scope | `Banana` | `Banana` |
| Nya / heavy, full scope | `Banana` | `Banyanya` |
| Nya / light | `No, really?` | `Nyo, weawwy?` |
| UwU / medium | `PLEASE LOVE SMALL` | `PWEASE WUV SMOL` |
| UwU / medium | `LoVe userName read_file R2D2` | `LoVe userName read_file R2D2` |
| UwU / medium | `Visit https://example.com/hello` | `Visit https://example.com/hello` |
| UwU / medium | `She said "Hello!"` | `She said "Hello!"` |
| UwU / medium, quoted text convert | `She said "Hello!"` | `She said "Hewwo!"` |
| UwU / medium | `hello :3` | `hewwo :3` |
| UwU / medium | `café world` | `café wowwd` |
| UwU / medium | `small smol` | `smol smol` |
| UwU / medium | `loving lovely love’s` | `wuvving wuvwy wuv’s` |
| UwU / medium | `I'll say we're ready.` | `I'ww say we'we weady.` |
| UwU / medium | `haiii smol w-weawwy` | `haiii smol w-weawwy` |
| UwU / medium, preserve term `Luna` | `Hello Luna!` | `Hewwo Luna!` |

The [40-case review collection](converter-examples.md) expands these into ordinary conversation, expression combinations, difficult attribution, technical text, existing UwU speech, and Unicode cases. Maintain it alongside the rules. Exact cases become automated fixtures; acceptable-output cases also require human review because passing a spelling test does not establish natural usage.

Add implementation checks for exact whitespace and CRLF preservation, empty input, protected code and links, Unicode faces, quote/apostrophe boundaries, option validation, spelling overrides, and identical browser/API results. Force expression rates to 0 or 1 and use fixed seeds to test budgets, eligibility, non-repetition, combination accounting, existing-face ownership, and insertion placement without flaky probability assertions. Include precomposed/decomposed text, emoji modifiers and joiners, and diagnostics offsets.

Check semantic mismatches as well as spelling: `not happy` must not produce joy, a routine question must not imply confusion, an apology must not gain a wink through automatic selection, and a sad cat-related sentence must not receive a playful nya ending.

Measure latency and output growth on representative short messages and the maximum supported input. A fixed number of bounded token passes should scale with input size; avoid repeated whole-string rebuilding or unbounded backtracking. Set a browser responsiveness target after measuring the actual implementation rather than promising an unmeasured speed.

## Implementation sequence (completed)

1. Turn exact cases from the review collection into fixtures; add versioned vocabulary, protected-span tokenization, and deterministic spelling conversion.
2. Implement seeded expression, the initial intent rules, and optional diagnostics; enable dictionary entries only as their eligibility rules become available.
3. Add the browser interface, verify acceptance cases, and review actual outputs for readability, intended tone, and appropriate emoticon use.
4. Add the HTTP adapter when API access is needed, using the same core and fixtures.

Keep initial work focused on English plain-text conversion. Additional dialects, custom dictionaries, structured document parsing, and contextual generative rewriting can be considered after the base behavior is reviewed.
