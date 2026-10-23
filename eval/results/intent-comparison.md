# Mood detection comparison

Corpus: 145 messages (115 that deserve a mood, 30 that should get no face, 11 of them sensitive). Labels are one author's judgments; see eval/intent-corpus.json.

A model's top non-neutral label counts only if it beats "neutral" and reaches the model's cutoff (MiniLM 0.85, DistilBERT 0.3, RoBERTa 0.7; each chosen from the sweep below to maximize right − wrong − 2 × false alarms). "Rules +" uses the keyword rules for greetings, farewells, thanks, apologies and sleep, and the model for everything else. "Positive only" never lets the model add a face for sadness, disappointment, anger, frustration or skepticism. "+ guard" also stays silent whenever the current rules flag the message as uncertain (negation, sarcasm cues, sad words, third-person reports). "Plugin" is what the Vencord plugin does: the engine keeps every keyword-rule match and stays silent on uncertain messages, and MiniLM's positive moods at the plugin's own cutoff (0.6, chosen from the "Plugin at cutoff" rows) fill in only messages the rules call neutral.

## Results

| Detector | Right mood | Wrong mood | Missed | Correctly silent | False alarms | Sensitive alarms | Hits with a face today | Wrong faces today |
|---|---|---|---|---|---|---|---|---|
| Current rules | 33 (29%) | 0 | 82 | 29/30 | 1 | 0/11 | 33/33 | 1 |
| Rules + MiniLM | 56 (49%) | 10 | 49 | 20/30 | 10 | 4/11 | 50/56 | 6 |
| Rules + MiniLM, positive only | 50 (43%) | 7 | 58 | 24/30 | 6 | 0/11 | 50/50 | 6 |
| Rules + MiniLM, positive only + guard | 45 (39%) | 5 | 65 | 26/30 | 4 | 0/11 | 45/45 | 4 |
| Rules + DistilBERT | 38 (33%) | 3 | 74 | 26/30 | 4 | 1/11 | 33/38 | 1 |
| Rules + DistilBERT, positive only | 33 (29%) | 3 | 79 | 29/30 | 1 | 0/11 | 33/33 | 1 |
| Rules + DistilBERT, positive only + guard | 31 (27%) | 2 | 82 | 29/30 | 1 | 0/11 | 31/31 | 1 |
| Rules + RoBERTa | 52 (45%) | 5 | 58 | 19/30 | 11 | 6/11 | 47/52 | 6 |
| Rules + RoBERTa, positive only | 47 (41%) | 3 | 65 | 24/30 | 6 | 1/11 | 47/47 | 6 |
| Rules + RoBERTa, positive only + guard | 43 (37%) | 3 | 69 | 25/30 | 5 | 1/11 | 43/43 | 5 |
| Plugin: engine + MiniLM hint | 54 (47%) | 6 | 55 | 26/30 | 4 | 0/11 | 54/54 | 4 |
| Plugin at cutoff 0.5 | 55 (48%) | 8 | 52 | 26/30 | 4 | 0/11 | 55/55 | 4 |
| Plugin at cutoff 0.7 | 53 (46%) | 6 | 56 | 26/30 | 4 | 0/11 | 53/53 | 4 |
| Plugin at cutoff 0.85 | 51 (44%) | 5 | 59 | 26/30 | 4 | 0/11 | 51/51 | 4 |

"Hits with a face today" counts correct moods for which the current `faceEligible` rules would actually allow a face (uwu style). "Wrong faces today" counts messages that should stay silent but would actually get a face under those rules; today no face is allowed for sadness, so several sensitive alarms would not yet show a face.

## Correct by message kind

| Detector | speech_act | emotion | neutral | sensitive | sarcasm | negation | third_person |
|---|---|---|---|---|---|---|---|
| Current rules | 23/31 | 10/77 | 10/10 | 11/11 | 5/6 | 0/6 | 3/4 |
| Rules + MiniLM | 24/31 | 28/77 | 10/10 | 7/11 | 0/6 | 3/6 | 4/4 |
| Rules + MiniLM, positive only | 24/31 | 22/77 | 10/10 | 11/11 | 0/6 | 3/6 | 4/4 |
| Rules + MiniLM, positive only + guard | 24/31 | 19/77 | 10/10 | 11/11 | 2/6 | 2/6 | 3/4 |
| Rules + DistilBERT | 23/31 | 15/77 | 10/10 | 10/11 | 5/6 | 0/6 | 1/4 |
| Rules + DistilBERT, positive only | 23/31 | 10/77 | 10/10 | 11/11 | 5/6 | 0/6 | 3/4 |
| Rules + DistilBERT, positive only + guard | 23/31 | 8/77 | 10/10 | 11/11 | 5/6 | 0/6 | 3/4 |
| Rules + RoBERTa | 24/31 | 25/77 | 10/10 | 5/11 | 1/6 | 2/6 | 4/4 |
| Rules + RoBERTa, positive only | 24/31 | 20/77 | 10/10 | 10/11 | 1/6 | 2/6 | 4/4 |
| Rules + RoBERTa, positive only + guard | 24/31 | 18/77 | 10/10 | 10/11 | 2/6 | 1/6 | 3/4 |
| Plugin: engine + MiniLM hint | 24/31 | 28/77 | 10/10 | 11/11 | 2/6 | 2/6 | 3/4 |
| Plugin at cutoff 0.5 | 24/31 | 29/77 | 10/10 | 11/11 | 2/6 | 2/6 | 3/4 |
| Plugin at cutoff 0.7 | 24/31 | 27/77 | 10/10 | 11/11 | 2/6 | 2/6 | 3/4 |
| Plugin at cutoff 0.85 | 24/31 | 25/77 | 10/10 | 11/11 | 2/6 | 2/6 | 3/4 |

## Cutoff sweep (model alone)

| Model | Cutoff | Right mood | Wrong | Missed | False alarms | Sensitive alarms |
|---|---|---|---|---|---|---|
| MiniLM | 0.15 | 52 | 24 | 39 | 16 | 8 |
| MiniLM | 0.2 | 52 | 24 | 39 | 16 | 8 |
| MiniLM | 0.3 | 52 | 22 | 41 | 16 | 8 |
| MiniLM | 0.5 | 50 | 21 | 44 | 16 | 8 |
| MiniLM | 0.7 | 43 | 16 | 56 | 13 | 6 |
| MiniLM | 0.85 | 37 | 13 | 65 | 10 | 4 |
| DistilBERT | 0.15 | 43 | 24 | 48 | 15 | 7 |
| DistilBERT | 0.2 | 36 | 19 | 60 | 10 | 5 |
| DistilBERT | 0.3 | 18 | 5 | 92 | 4 | 1 |
| DistilBERT | 0.5 | 3 | 0 | 112 | 0 | 0 |
| DistilBERT | 0.7 | 0 | 0 | 115 | 0 | 0 |
| DistilBERT | 0.85 | 0 | 0 | 115 | 0 | 0 |
| RoBERTa | 0.15 | 51 | 19 | 45 | 15 | 8 |
| RoBERTa | 0.2 | 51 | 19 | 45 | 15 | 8 |
| RoBERTa | 0.3 | 51 | 18 | 46 | 15 | 8 |
| RoBERTa | 0.5 | 39 | 11 | 65 | 13 | 7 |
| RoBERTa | 0.7 | 33 | 7 | 75 | 11 | 6 |
| RoBERTa | 0.85 | 16 | 4 | 95 | 7 | 2 |

## Cost

| Model | File size | Load time | Mean per message | 95th percentile |
|---|---|---|---|---|
| MiniLM | 30.5 MB | 0.1 s | 0.6 ms | 1.0 ms |
| DistilBERT | 67.6 MB | 0.1 s | 1.1 ms | 1.5 ms |
| RoBERTa | 125.4 MB | 0.2 s | 2.8 ms | 3.6 ms |

Timings are from this machine's CPU in Node.js and include a first-run download when the model was not cached.

## Messages that should stay silent but got a mood

| Message | Kind | Current rules | Rules + MiniLM | Rules + MiniLM, positive only | Rules + MiniLM, positive only + guard | Rules + DistilBERT | Rules + DistilBERT, positive only | Rules + DistilBERT, positive only + guard | Rules + RoBERTa | Rules + RoBERTa, positive only | Rules + RoBERTa, positive only + guard | Plugin: engine + MiniLM hint | Plugin at cutoff 0.5 | Plugin at cutoff 0.7 | Plugin at cutoff 0.85 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| my grandma passed away last night | sensitive |  | sadness 0.96 |  |  |  |  |  | sadness 0.91 |  |  |  |  |  |  |
| my dog died this morning | sensitive |  | sadness 0.94 |  |  |  |  |  | sadness 0.90 |  |  |  |  |  |  |
| i'm so sorry for your loss | sensitive |  | sadness 0.97 |  |  |  |  |  | sadness 0.79 |  |  |  |  |  |  |
| sorry to hear about your dad | sensitive |  | sadness 0.93 |  |  |  |  |  | sadness 0.71 |  |  |  |  |  |  |
| i've been really depressed lately and don't know what to do | sensitive |  |  |  |  | sadness 0.31 |  |  |  |  |  |  |  |  |  |
| the hospital called, it's not good news | sensitive |  |  |  |  |  |  |  | disapproval 0.72 |  |  |  |  |  |  |
| i'm being serious, this isn't a joke | sensitive |  |  |  |  |  |  |  | amusement 0.74 | amusement 0.74 | amusement 0.74 |  |  |  |  |
| great, another monday | sarcasm |  | admiration 0.98 | admiration 0.98 | admiration 0.98 |  |  |  | admiration 0.88 | admiration 0.88 | admiration 0.88 | matched | matched | matched | matched |
| oh wonderful, the server is down again | sarcasm |  | admiration 0.98 | admiration 0.98 | admiration 0.98 |  |  |  | admiration 0.87 | admiration 0.87 | admiration 0.87 | matched | matched | matched | matched |
| thanks for nothing | sarcasm |  | gratitude 0.99 | gratitude 0.99 |  |  |  |  | gratitude 0.98 | gratitude 0.98 |  |  |  |  |  |
| yeah right, like that'll happen | sarcasm |  | approval 0.96 | approval 0.96 |  |  |  |  |  |  |  |  |  |  |  |
| love waiting in queue for 40 minutes | sarcasm |  | love 0.97 | love 0.97 | love 0.97 |  |  |  | love 0.95 | love 0.95 | love 0.95 | matched | matched | matched | matched |
| wow so helpful, thanks a lot | sarcasm | matched | rules: gratitude | rules: gratitude | rules: gratitude | rules: gratitude | rules: gratitude | rules: gratitude | rules: gratitude | rules: gratitude | rules: gratitude | matched | matched | matched | matched |
| they're mad at the mods | third_person |  |  |  |  | anger 0.44 |  |  |  |  |  |  |  |  |  |
| my friend thinks the movie was terrible | third_person |  |  |  |  | disapproval 0.35 |  |  |  |  |  |  |  |  |  |
