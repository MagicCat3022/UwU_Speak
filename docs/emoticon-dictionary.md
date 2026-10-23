# Emoticon dictionary

The [JSON dictionary](../data/emoticons.json) contains 36 hand-curated entries and 1,153 entries promoted from the [emoticon intake](emoticon-criteria.md) (marked `origin: "intake"` with their `candidate_id`). It combines short text faces, familiar sideways emoticons, and kaomoji. An entry can have several meanings and conversational intents: comforting someone is different from describing your own sadness, even though both involve sadness.

The [converter specification](converter-spec.md) defines the full transformation pipeline, public options, and the shared budget for sentences receiving faces, tildes, and nya endings. Medium/heavy presets allow one face plus one soft ending in the same sentence.

These are conventional associations, not fixed translations. For example, `uwu` commonly conveys warmth and affection, while `OwO` more often expresses surprise or excitement. [Dictionary.com](https://www.dictionary.com/culture/slang/uwu)

Likewise, `m(_ _)m` can accompany an apology, thanks, or a request; smiling eyes can read differently depending on context. [KawaiiEmoji](https://kawaiiemoji.com/articles/kaomoji-meaning-list)

## What is researched and what is designed

Each entry points to sources for its conventional form or broad meaning. The top-level `sources` registry records titles, URLs, and scope. All listed sources were reviewed on the date in `reviewed_on`.

The intent tags, intensity levels, style compatibility, selection restrictions, usage advice, examples, and alias grouping are this project's editorial annotations. They are starting recommendations to evaluate with users, not frequency measurements or a claim that a face always has one interpretation. An alias groups closely related visual spellings; it does not assert that every spelling is independently documented by every cited source.

The examples were written for this project. They illustrate the decoration stage alone and deliberately keep the original spelling so the contribution of the face is visible.

## Field contract

| Field | Purpose |
|---|---|
| `id` | Stable, unique identifier, independent of the displayed face. |
| `text` | Preferred exact Unicode spelling to insert. |
| `aliases` | Related spellings to recognize and preserve in input. Case is significant. |
| `kind` | `emoticon` or `kaomoji`; a practical display grouping, not a strict cultural boundary. |
| `meanings` | Short, overlapping descriptions of conventional readings. |
| `intents` | Conversational purposes suitable for candidate filtering. |
| `intensity` | Editorial scale: 1 = restrained, 2 = expressive, 3 = emphatic. This is emotional/visual strength, not string length. |
| `styles` | Compatible product presets: `uwu`, `nya`, or `classic`. These tags are not claims about cultural origin. |
| `selection` | `contextual` entries are eligible when context supports them; `explicit` entries require a matching author-selected intent or direct face selection. |
| `eligibility` | The insertion rule in `src/core/intent.ts`: `auto`, `explicit`, `sleep_cue`, `hug_cue`, `mishap_cue`, `affection_cue`, `comfort_intent`, or `reference` (never inserted). See the [intake criteria](emoticon-criteria.md#annotating-accepted-faces). |
| `placement` | Allowed insertion positions. The starter set uses `sentence_end`; the converter may place a face after a newly added nya particle at that ending. |
| `use_when` | A concrete context in which the face fits. |
| `avoid_when` | A common mismatch to check before insertion. |
| `example` | Original `input` and `output` strings demonstrating an appropriate insertion. |
| `source_ids` | References into the top-level source registry. |

The metadata is descriptive. It does not execute context checks by itself. The selector implements a conservative initial subset in [src/core/intent.ts](../src/core/intent.ts); `use_when` and `avoid_when` guide those rules and their evaluation. See [implementation notes](implementation.md) for active entries and reference-only faces.

## Selection behavior

1. **Protect existing expressions and structured text.** Identify known faces using `text` and `aliases`, prefer the longest match, and preserve their exact characters. Also protect URLs, email addresses, and code. Preserve quoted material by default; the converter's `quotedText: "convert"` option permits spelling conversion inside quotes without generating expression there. Alphabetic faces such as `uwu` require token boundaries so they are not found inside ordinary words or identifiers. Allow both whitespace-separated faces and faces attached to sentence punctuation. Attach a face following sentence punctuation and horizontal whitespace to the preceding sentence: `Hello! :3` already has a face. If ownership is ambiguous across a line break, preserve the face and suppress new endings on adjacent candidate sentences.
2. **Read intent from the original text.** Analyze clauses before applying UwU spelling changes. Prefer a compatible author-provided intent when available. Phrase rules can recognize clear greetings, thanks, apologies, or bedtime messages; keywords alone are insufficient. Distinguish neutral prose from uncertain emotion. Neither state alone licenses an emotional face, but neutral prose may still receive the converter's selected spelling, stuttering, stretching, or tilde features.
3. **Check who feels what.** "I am sad" expresses the author's sadness; "I'm here for you" may offer comfort. "She said she was happy" does not establish that the author is happy. Negation, quotations, sarcasm, and mixed clauses can invalidate a simple match.
4. **Filter before choosing.** Candidates must share the selected style and intent and fit the requested maximum intensity. Apply implemented eligibility rules covering their usage constraints; descriptions in this JSON do not execute checks. An `explicit` entry must not enter the automatic pool merely because a keyword matches. When intent remains unclear or no candidate fits, insert no face. Uncertain emotion or structure suppresses all new expression in that sentence.
5. **Apply a small decoration budget.** Limit faces to one per newly decorated sentence. The converter may combine that face with one tilde or one nya particle when `endings.allowCombination` is enabled. A combination consumes one decorated-sentence slot, so the short-message limit still permits `haiii~ :3`. Never add a new ending to a sentence already containing a face, terminal tilde, or nya particle. An existing decorated sentence starts the same spacing gap but does not consume a newly decorated-sentence slot. The converter's preset table controls the maximum number of such sentences and their spacing; these are editorial defaults to tune.
6. **Choose among eligible entries using a seed.** Initially give eligible entry IDs equal weight; having more aliases should not increase selection probability. Sort IDs by fixed code-unit order, not locale-dependent collation. Prefer a different entry from the previous insertion when another suitable candidate exists. Record the dictionary, engine, rule, and segmentation versions alongside the seed; identical seeds alone cannot compensate for different tokenization rules.
7. **Insert after spelling changes.** Append one space and the chosen face after the sentence's punctuation and closing quotation marks, or after a newly added nya particle when combining them. A word-final tilde goes before existing terminal punctuation, and never combines with a nya particle. For an unpunctuated message, use its end. Preserve existing whitespace and line breaks. Do not insert new expression into quoted passages or subsequently apply `r/l`, nya spelling, stutters, or punctuation rewrites to the face.

The `nya` preset expands access to cat expressions, but it does not override intent. A sad sentence about a cat should not receive a happy cat face simply because it contains the word "cat".

## Examples for evaluating the selector

These are acceptance expectations, not guaranteed face choices. The [automated review cases](../tests/core.test.ts) exercise these contexts with fixed seeds and forced attempt rates.

| Input/context | Suitable behavior |
|---|---|
| `Thank you for saving me a seat!` | A gentle smile or `uwu` may fit. |
| `Sorry I sent that twice.` | A small bow or awkward smile may fit. |
| `I'm sorry your day was so rough. I'm here for you.` | Consider a comforting expression at the supportive sentence, rather than assuming the speaker is apologizing. |
| `I'm not happy about this.` | Do not select a joyful face from the word "happy." |
| `Thanks for nothing.` | Skip automatic decoration unless sarcasm is explicitly selected and supported. |
| `Can you send the file?` | A question mark alone should not trigger confusion. |
| `She wrote "I'm so happy!"` | Do not assign the quoted emotion to the author. |
| `My cat is missing.` | Do not select a playful cat face. |
| `Hello! (*・ω・)ﾉ` | Preserve the existing face and add no second greeting face. |
| `Hello! :3 Goodbye!` | Associate `:3` with the greeting, suppress another ending there, and apply the existing-ending spacing gap. |
| `Hi` with compatible cuteness intent and combinations enabled | `haiii~ :3` is a possible result; one face plus one soft ending uses one sentence slot. |
| `She wrote "I'm so happy!"` with quoted-text conversion | Convert the quoted spelling if requested, but do not assign its happiness to the narrator or add expression inside the quote. |
| `Visit https://example.com/uwu` | Preserve the URL; its path is not an emotion cue. |
| `Status: ready.` with no selected intent | Add no face or nya particle; spelling and an enabled tilde remain available for neutral prose. |

The existing face inventory is finite. Version 0.1.0 also preserves bounded parenthesized spans containing familiar kaomoji visual cues and flags their context as uncertain. This fallback does not recognize every unfamiliar face.

## Unicode and rendering

Store and load the file as UTF-8. Keep significant spaces, combining marks, backslashes, and fullwidth characters. The shrug contains one displayed backslash, represented as `\\` in JSON. Do not lowercase faces or apply compatibility normalization such as NFKC to their display strings.

Treat complete grapheme clusters as indivisible at recognition and edit boundaries. Preserve combining accents, emoji modifiers, and joined emoji without detaching parts of their character sequences. Use the shared versioned boundary implementation specified by the converter for consistent browser/API behavior.

In a browser, render input and output as text, such as through `textContent`. For Markdown output, escape at rendering time rather than storing Markdown escapes in the dictionary. Characters such as `*`, `_`, `>`, and backslashes belong to the faces themselves.

If a consumer requires ASCII, filter candidates by the actual selected spelling's code points; do not transliterate Unicode faces or assume every alias has the same encoding needs. Font availability can affect visual appearance, so visual checks on target platforms remain useful.

## Adding entries

Collected faces go through the intake instead of being added by hand: `node scripts/emoticon-candidates.ts collect` gathers and prescreens them, reviewers classify the batches against the [criteria](emoticon-criteria.md), `merge` writes [data/emoticon-candidates.json](../data/emoticon-candidates.json) (shown on the app's **Emoticon wiki** page), and `promote` adds the accepted faces to this dictionary. Promote replaces earlier intake entries and leaves curated ones alone. Results files are applied in name order, so `recheck-*.json` overrides the first batches and `review-*.json` (manual overrides) wins over both.

For a hand-curated face, add a stable ID, exact face spelling, brief meanings, at least one intent, a contextual example, a mismatch to avoid, and a source supporting the form or meaning. Keep IDs and all exact spellings unique across entries. Extend the source registry when needed. Review variants separately if their expressions differ; for example, `uwu` and `OwO` are separate entries rather than aliases.

Keep textual particles such as `nya~` and actions such as `*blushes*` in separate future dictionaries. They can share the same intent-selection system, but they are not faces.

Before using a dictionary revision, validate its JSON, required fields, unique IDs and spellings, allowed tags, source references, intensity bounds, and example integrity. Then evaluate meaning preservation using the [review collection](converter-examples.md), including ordinary messages, negation, mixed emotions, existing faces, and quoted text. Use the converter's optional diagnostics to review why an entry was selected or skipped. This dictionary provides the vocabulary for that work; it does not make context interpretation infallible.
