# Emoticon intake criteria

These rules decide which collected faces enter the [emoticon dictionary](emoticon-dictionary.md). Candidates come from emojidb.org searches and kaomoji.ru (see `scripts/emoticon-candidates.ts`). Every candidate keeps its verdict and reason in [data/emoticon-candidates.json](../data/emoticon-candidates.json), which the local app's **Emoticon wiki** page shows.

The converter appends at most one face to the end of a sentence in a chat message, for example `Thank you! (˶ᵔ ᵕ ᵔ˶)`. A face is acceptable only if it reads naturally in that position for a general audience.

## Accept

Accept a candidate when **all** of these hold:

1. **It is a face or a character with an expression.** Kaomoji such as `(˶˃ ᵕ ˂˶)`, sideways emoticons such as `:3`, and animal faces such as `≽^•⩊•^≼` qualify. Small decorations are fine: blush marks `⸝⸝` `,,` `˶`, hearts `♡`, sparkles `✧`, tildes, motion marks `ﾉ` `づ`, and sound marks such as `zzZ` or `chu`.
2. **It conveys at least one mood from the intent list below.**
3. **It is short enough for a sentence ending:** one line, about 30 characters or fewer.
4. **Emoji are only accents.** A face may carry up to two small emoji (`👉👈`, `💕`, `✨`). If the emoji carry the meaning, or there are more than two, reject it as `emoji_heavy`.
5. **It is suitable for a general audience.**

## Reject

Use one or more of these reason codes:

| Code | Meaning | Examples |
|---|---|---|
| `emoji_only` | Only emoji, no text face. (Applied by the script.) | `😭`, `👉👈` |
| `emoji_heavy` | Emoji carry the meaning or there are more than two. | `(˶˃ ᵕ ˂˶)🎀💗🌸✨` |
| `sexual` | Sexual, suggestive, or bodily content. | `*farts cutely*`, lewd body art |
| `hostile` | Insults, slurs, rude gestures, threats, or mockery aimed at someone. | `ᶠᶸᶜᵏᵧₒᵤ!`, `BITE ME!` |
| `violence` | Weapons, gore, killing, fighting. | gun ASCII art, `(╯°□°)︻╦╤─` |
| `substances` | Drugs, smoking, alcohol. | `ᝰ🚬` |
| `self_harm` | Self-harm, suicide, or death wishes. | |
| `identity_label` | Flags, pride or identity labels, slogans. These are not moods. | `☑️🏳️‍🌈Certified Gay` |
| `words` | Contains words or phrases beyond a short sound such as `zzZ`, `chu`, `nya`. | `b-baka!`, `s-senpai..~`, `Nyaa >w<`, `RAWR` |
| `fancy_text` | Stylized-font letters or text art. | `𝔾𝕆𝕆𝔻 𝔹𝕆𝕐`, `𝑴𝒆𝒐𝒘 :3` |
| `not_a_face` | Symbols, dividers, scenery, or decoration without an expression. | `ᯓ ✈︎`, `𓆝 𓆟 𓆞`, `.ᐟ`, `ꉂ` |
| `too_large` | Multi-line art or longer than about 30 characters. | |
| `no_fitting_intent` | A real face whose mood none of our intents covers. | nosebleed, drooling at food, fear |
| `broken` | Garbled characters, mismatched fragments, or a face cut off. | `(˶ᵔ ᵕ` |

Judgment calls:

- **Two figures.** Accept a pair (a hug, a high five, waving at each other) only when both figures share the same mood. A happy figure next to a dejected one has no single mood: reject it as `no_fitting_intent`. Props that are not faces, such as cups, signs or game boards, make it a scene: reject it as `not_a_face`.
- **Rare characters.** The `rare_script` warning means some characters (such as `𐃷` or `𖦹`) come from rare Unicode blocks and may not display on every device. That alone is not a reason to reject. Reject as `broken` only if the face is unrecognizable without them.
- **Animal faces that could insult.** A pig, monkey or similar face appended after a message about someone can read as an insult. Accept these only with `eligibility: explicit`. Cats, bears, bunnies and dogs are fine for `auto`.
- **Apology** fits bowing (`m(_ _)m`), sweating or sheepish faces only. Do not infer an apology from holding hands, hugging or crying.
- **Surprise.** A happy, excited surprise may be `auto`. A shocked, alarmed or horrified face is `explicit`.
- **Quote marks.** A `"` or `'` inside or just after a face, as in `(¬_¬")` or `(>n<")`, is a sweat drop and is fine. A single unmatched `"` at the very start is a copying artifact that the script removes; judge the face without it. A `!`, `!!` or `?` right after a face, as in `(O_O)!` or `(⊙.⊙)?`, is part of the expression and is fine.
- **Invisible fillers.** Word joiners, braille blanks (`⠀`) and Hangul fillers (`ㅤ`) are removed by the script before a face is used. Judge what remains visible; reject as `broken` only if nothing usable is left.

Rejecting is not a judgment that a face is bad in general. It only means the face does not fit an automatic, general-audience chat converter.

## Annotating accepted faces

- **`intents`**: one to three tags from this list only, most fitting first: `acknowledgment`, `affection`, `amusement`, `anger`, `apology`, `cat_playfulness`, `celebration`, `comfort`, `confusion`, `cuteness`, `determination`, `disappointment`, `embarrassment`, `emotional_overwhelm`, `farewell`, `frustration`, `gratitude`, `greeting`, `joy`, `request`, `resignation`, `sadness`, `shyness`, `skepticism`, `sleep`, `surprise`, `teasing`. If a better tag would be useful, put it in `proposed_intent`; it is recorded but not used.
- **`meanings`**: one to three short readings, such as `flustered`, `happy squint`, `cat smile`.
- **`intensity`**: 1 = restrained, 2 = expressive, 3 = emphatic (big arms, tears, many decorations).
- **`styles`**: `uwu` for cute kaomoji; `nya` for cat faces and anything that also suits a cat-girl voice; `classic` for western sideways emoticons such as `:)` or `XD`. Use one or more.
- **`kind`**: `emoticon` for short sideways or ASCII-style faces, otherwise `kaomoji`.
- **`eligibility`**: when the converter may insert it.
  - `auto`: when the message's detected mood matches one of its intents. Only for warm, positive, or mild faces: greeting, farewell, gratitude, joy, celebration, amusement, affection, cuteness, cat_playfulness, acknowledgment, determination, shyness, mild embarrassment, happy surprise, mild confusion.
  - `explicit`: only when the author picks the mood. Use for negative feelings (sadness, anger, frustration, disappointment, skepticism, resignation, emotional_overwhelm), teasing, smugness, and anything that could read as mocking the reader.
  - `sleep_cue`: sleeping or sleepy faces; inserted only when the sentence mentions bed, sleep or night.
  - `hug_cue`: hugging faces; only when the sentence mentions a hug.
  - `mishap_cue`: sheepish or oops faces; only after a small mistake such as a typo or wrong channel.
  - `affection_cue`: strong romantic faces (kisses, many hearts); only with "love you" and similar.
  - `comfort_intent`: faces that offer comfort; only when the sentence offers support.
  - `reference`: acceptable to recognize in input, but never inserted.
- **`use_when`** and **`avoid_when`**: one short sentence each.
- **`example_input`**: one short chat sentence the face fits after. Write the sentence only, not the face.
