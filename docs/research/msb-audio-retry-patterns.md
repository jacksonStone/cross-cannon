# MSB introduction retry patterns

Historical snapshot of the retry pass. The later timestamp-only export removed
the pause requirement described below; current results are in
`public/msb-audio-offsets.json` and [the current review list](msb-audio-offset-review.md).

Retried all 407 chapters from the original review list. 129 additional starts are now confirmed; 278 still require review. The complete index has 911 confirmed chapters out of 1,189. All 782 previously confirmed records are unchanged.

One new request per chapter, six workers, no automatic network retries. Each clip starts at the original time zero and ends within the first eight seconds. 1804.307 seconds were uploaded in this round. Estimated additional cost including per-request duration rounding: $0.1996; cumulative estimate: $1.3168. All requests, original and retry transcripts, and results are checkpointed under `storage/audio/MSB/.work/`.

## Patterns found

1. **The confidence test was too broad.** In 66 of the original 84 low-confidence cases, only later segments had bad scores. Some later segments repeated words with zero-duration timestamps or transcribed speech over likely silence. Confidence now applies to the introduction itself. A high no-speech score alone no longer rejects an otherwise confident decode; the audio pause still has to support its boundary.
2. **Much of the remaining uncertainty is timing, not missing words.** The original 183 no-pause cases yielded 152 with no nearby pause even at a 20 ms minimum, 30 with a short pause, and one with ambiguous pauses at -35 dB. This suggests connected speech or timing drift, rather than proof that the phrase is absent. The 60 ms confirmation requirement remains in place; no fixed chapter offset is inferred.
3. **An intro-focused retry recovers omitted headings.** The retry stops in the first qualifying long pause after the heading when possible, with Audio Bible/book/chapter spelling context. Raw transcripts containing the phrase rose from 278 to 331 of 407. Naming the expected phrase can bias decoding, so it is never accepted without timestamp and local-pause evidence.
4. **A newer transcript is not always better.** The final matcher checks every cached variant. It retains useful older evidence and flags confirmed boundaries that disagree by more than 150 ms. Of 216 comparable old/new phrase endings, the median change was 0.0 seconds; 5 changed by more than 150 ms. Repeating ASR therefore does not independently resolve most no-pause cases.

The API context strategy follows [OpenAI’s transcription reliability guidance](https://developers.openai.com/api/docs/guides/speech-to-text#improving-reliability). Confidence metadata is described in the [audio API reference](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions). These patterns and the acceptance policy are based on the saved recordings and transcripts, not an API guarantee.

## Outcome by original reason

| Original reason | Retried | Confirmed now | Still review |
| --- | ---: | ---: | ---: |
| no-clear-pause-after-intro | 183 | 3 | 180 |
| audio-bible-not-found-in-first-eight-seconds | 121 | 50 | 71 |
| low-transcription-confidence | 84 | 63 | 21 |
| transcription-error: Error: transcription-cache-missing; reanalysis never uploads audio | 8 | 6 | 2 |
| implausible-phrase-timing | 5 | 4 | 1 |
| multiple-audio-bible-phrases | 2 | 1 | 1 |
| unexpected-speech-before-intro | 2 | 1 | 1 |
| ambiguous-pause-after-intro | 1 | 1 | 0 |
| phrase-touches-clip-boundary | 1 | 0 | 1 |

## Remaining review reasons

| Reason | Chapters |
| --- | ---: |
| no-clear-pause-after-intro | 200 |
| audio-bible-not-found-in-first-eight-seconds | 67 |
| no-word-timestamps | 6 |
| ambiguous-pause-after-intro | 2 |
| unexpected-speech-before-intro | 2 |
| multiple-audio-bible-phrases | 1 |

## Examples

| Chapter | Original transcript | Retry transcript | Outcome |
| --- | --- | --- | --- |
| Genesis:5 | Audio Bible, Genesis, Chapter 5 This is the Book of the Generations of Adam. In the day that I was born, I saw the Son of Man, and I saw the Son of Man, and I saw | This is the Book of the Generations of Adam. | audio-bible-not-found-in-first-eight-seconds |
| Genesis:13 | So Abram went up out of Egypt into the Negev. | Audio Bible. Genesis. Chapter 13. | no-clear-pause-after-intro |
| Genesis:24 | Audio Bible, Genesis, Chapter 24 By Now Abraham 5 13 25 26 | Audio Bible. Genesis. Chapter 24. | 2.72 s |
| Genesis:12 | Audio Bible, Genesis, Chapter 12 Then the LORD said to Abram, | Audio Bible. Genesis. Chapter 12. | no-clear-pause-after-intro |
| Matthew:6 |  | Audio Bible. Matthew. Chapter 6. | 3.567 s |
| Zechariah:7 |  | Audio Bible. Zechariah. Chapter 7. | 2.254 s |

[Remaining review list with local eight-second clips](msb-audio-offset-review.md).

Resume this exact retry round with `npm run prepare:msb-audio -- --retry-review --transcription-jobs 6 --max-cost 1.50`. Use `--retry-review --reanalyze` to compare cached attempts without uploading again.
