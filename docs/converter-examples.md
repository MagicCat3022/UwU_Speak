# Converter review collection

This collection contains 40 implementation and style-review cases for the [converter specification](converter-spec.md). Version 0.1.0 covers A01–A24 as exact fixtures and B01–B16 as automated behavior checks in [tests/core.test.ts](../tests/core.test.ts). Keep it versioned with the spelling rules, segmentation rules, and [emoticon dictionary](../data/emoticons.json). Naturalness still benefits from human review.

Cases A01–A24 define exact text results. Cases B01–B16 define expression behavior and review expectations; some admit several suitable faces. Sampling uses the fixed seed `review` in these tests. See [implementation notes](implementation.md) for reproducible sampling and version details; one seeded face is not the only natural choice.

## Exact spelling and preservation cases

Unless overridden in the row, use `style: "uwu"`, `intensity: "medium"`, `quotedText: "preserve"`, `seed: "review"`, and all five expression rates set to zero. Features and nya scope inherit the selected style/preset. Values explicitly labeled JSON strings must be decoded, so `\t`, `\r\n`, and `\u0300` describe actual input characters rather than literal backslashes.

| ID | Input | Overrides | Expected output |
|---|---|---|---|
| A01 | `Hello world!` | intensity light | `Hewwo wowwd!` |
| A02 | `Thanks, I really love it.` | none | `Thankies, I weawwy wuv it.` |
| A03 | `Hi! Please bring the small cat.` | none | `Hai! Pwease bwing the smol cat.` |
| A04 | `PLEASE LOVE SMALL` | none | `PWEASE WUV SMOL` |
| A05 | `LoVe userName read_file R2D2` | none | `LoVe userName read_file R2D2` |
| A06 | `She said "Hello world!"` | none | `She said "Hello world!"` |
| A07 | `She said "Hello world!"` | quotedText convert | `She said "Hewwo wowwd!"` |
| A08 | `I'll say we're ready.` | none | `I'ww say we'we weady.` |
| A09 | `I’ll say we’re ready.` | none | `I’ww say we’we weady.` |
| A10 | `love's meaning` | none | `wuv's meaning` |
| A11 | `loving lovely love’s` | none | `wuvving wuvwy wuv’s` |
| A12 | `friends’ plans` | none | `fwiends’ pwans` |
| A13 | `No, not now. New, nice.` | style nya, words scope | `Nyo, nyot nyow. Nyew, nyice.` |
| A14 | `Banana` | style nya, intensity medium | `Banana` |
| A15 | `Banana` | style nya, intensity heavy | `Banyanya` |
| A16 | `No, really?` | style nya, intensity light | `Nyo, weawwy?` |
| A17 | `hi small` | features.vocabulary false | `hi smaww` |
| A18 | `Hello! Nice.` | style nya; vocabulary, letterSwap, and nyaSpelling all false | `Hello! Nice.` |
| A19 | `Hello https://example.com/hello` | none | `Hewwo https://example.com/hello` |
| A20 | `Hello Luna!` | preserveTerms contains `Luna` | `Hewwo Luna!` |
| A21 | `haiii smol w-weawwy` | none | `haiii smol w-weawwy` |
| A22 | JSON string `"crème cre\u0300me hello"` | none | JSON string `"crème cre\u0300me hewwo"` |
| A23 | JSON string `"Hello\tworld!\r\nNo."` | none | JSON string `"Hewwo\twowwd!\r\nNo."` |
| A24 | JSON string `""` | none | JSON string `""` |

## Expression and context cases

Start from the same zero-rate baseline and override only the named rates; use the row's style/intensity and intent overrides where specified. An attempt rate of 1 removes a probability gate but still respects eligibility, budgets, and existing-expression protection. Example faces below demonstrate acceptable choices and are not precomputed seeded results. Default gaps and budgets remain in force unless overridden.

| ID | Input and settings | Required behavior / acceptable result |
|---|---|---|
| B01 | `Hi`; medium; stretch, tilde, and emoticon rates 1; compatible explicit cuteness intent | A face and a tilde may combine. `Haiii~ :3` is an acceptable example if `cat_smile` is selected. Count one decorated sentence. |
| B02 | `I love you!`; nya/medium; nya and emoticon rates 1; explicit affection intent | Permit one nya particle plus one fitting face, such as `I wuv you! nya~ uwu`. Do not add a separate word-final tilde or new punctuation. |
| B03 | `Hi!`; light; emoticon and tilde rates 1 | Light defaults disable combinations. The eligible greeting face wins, producing `Hi! (*・ω・)ﾉ`; no extra tilde. |
| B04 | `really`; stutter rate 1 | Use the converted initial: exactly `w-weawwy`, with no second stutter. |
| B05 | `r-really haiii smol`; stutter and stretch rates 1 | Preserve all three existing stylized spans exactly. Do not add a stutter or extend the existing repeated vowel. |
| B06 | `Hello! :3`; emoticon, tilde, and stutter rates 1 | `:3` belongs to `Hello!` and blocks new ending components. Word spelling or an eligible word stutter may still occur. |
| B07 | `Hello! :3 Goodbye!`; emoticon and tilde rates 1 | The existing face decorates the first sentence and starts the default gap. Neither sentence gets another ending; spelling result is `Hewwo! :3 Goodbye!`. |
| B08 | `Status: ready.`; tilde, nya, and emoticon rates 1; style nya, scope words | Neutral prose may receive a tilde, but no emotional face or nya particle merely because their rates are 1. Expected result: `Status: weady~.` |
| B09 | `I'm not happy about this.`; emoticon rate 1 | Do not select joy based on `happy`. If no supported compatible intent rule is available, add no face. |
| B10 | `Thanks for nothing.`; stutter, stretch, tilde, and emoticon rates 1 | Recognize the ambiguity/sarcasm cue and suppress new expression. Spelling may still yield `Thankies fow nothing.` |
| B11 | `Can you send the file?`; emoticon rate 1 | A question mark does not establish confusion. Add no confused face without a supported cue or compatible explicit intent. |
| B12 | `She wrote "I'm so happy!"`; quotedText convert; emoticon rate 1 | Do not assign the quotation's emotion to the narrator or insert new expression inside the quote. Preserve its punctuation and existing faces. |
| B13 | `My cat is missing.`; nya/medium; nya, tilde, and emoticon rates 1 | No playful cat face, nya particle, or cheerful flourish. An unsupported emotional cue should produce the uncertain state and suppress new expression. |
| B14 | `I'm sorry your day was so rough. I'm here for you.`; emoticon rate 1 | Treat the support offer as comfort, not an admission of responsibility. A fitting comfort face may follow the second sentence. Do not add an apology bow merely from `sorry`. |
| B15 | Technical and Unicode fragments listed below; all rates 1 in nya style | Preserve every protected fragment and complete Unicode sequence exactly. Do not attach an ending to a segment containing only protected content. Handle punctuation without swallowing adjacent prose. |
| B16 | `Hello! Thanks for the tea.`; all applicable rates 1; repeat with seed `review` and diagnostics on/off in browser and API | Same resolved options and versions yield identical text across runtimes and report modes. All reported offsets map correctly to original/final strings. Changing seed may change a choice, but need not do so when only one candidate is eligible. |

For B15, exercise each fragment alone and between two simple prose words:

```text
https://example.com/a_(b)?q=hello
person@example.com
@Luna
C:\Users\Luna\notes.txt
`return hello_world;`
(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧
👩🏽‍💻
👨‍👩‍👧‍👦
❤️
```

Also exercise a fenced code block containing `return hello_world;`. Add a period after the URL to verify that the path's balanced parentheses stay inside the URL while sentence punctuation remains outside it. For a face following a line break, check the conservative ownership fallback rather than assigning an emotion to an arbitrary adjacent sentence.

## Human review and regression use

Review representative actual outputs for four properties: preservation of the message, readability, strength of the requested style, and suitability of the face or particle in context. Record the input, resolved options, seed, all returned versions, output, and reviewer notes. Where several faces fit, record an acceptable set or a contextual constraint rather than declaring a single preferred face universally correct.

Use diagnostics to inspect rejected candidates and protected spans. Do not change a test's expected output merely because the implementation produced something different; first decide whether the implementation or the specification should change. Add newly discovered edge cases to this collection and the appropriate automated fixtures.

Keep structural tests separate from subjective ratings: exact text, whitespace, cluster preservation, budget accounting, and browser/API equivalence are testable properties. Naturalness and community preferences require human review. The implementation also needs validation and size-limit checks from the main spec; these 40 examples are a starter review set, not an exhaustive test suite.
