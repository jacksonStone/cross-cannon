export type Word = { word: string; start: number; end: number };
export type IntroTranscript = {
  text: string;
  duration: number;
  words?: Word[];
  segments?: { start?: number; end?: number; avg_logprob: number; no_speech_prob: number }[];
};
export type IntroOffset = {
  status: "detected" | "needs-review";
  startSeconds: number | null;
  reason: string;
};
export type Pause = { start: number; end: number };
const normalizeWord = (word: string) => word.toLowerCase().replace(/[^a-z]/g, "");
function phraseMatches(words: Word[]) {
  return words.flatMap((word, i) => {
    if (normalizeWord(word.word) === "audiobible") return [{ start: i, end: i }];
    if (normalizeWord(word.word) === "audio" && normalizeWord(words[i + 1]?.word ?? "") === "bible") return [{ start: i, end: i + 1 }];
    return [];
  });
}

/** Only accept a single, timed, consecutive phrase inside the uploaded window. */
export function findIntroOffset(transcript: IntroTranscript): IntroOffset {
  const uncertain = (reason: string): IntroOffset => ({ status: "needs-review", startSeconds: null, reason });
  const words = transcript.words ?? [];
  if (!(transcript.duration > 0 && transcript.duration <= 8.05)) return uncertain("invalid-clip-duration");
  if (!words.length) return uncertain("no-word-timestamps");
  let previous = 0;
  for (const word of words) {
    if (!Number.isFinite(word.start) || !Number.isFinite(word.end) || word.start < previous - 0.05 ||
        word.start < 0 || word.end < word.start || word.end > transcript.duration + 0.05) {
      return uncertain("invalid-word-timestamps");
    }
    previous = word.end;
  }
  const matches = phraseMatches(words);
  if (matches.length !== 1) return uncertain(matches.length ? "multiple-audio-bible-phrases" : "audio-bible-not-found-in-first-eight-seconds");
  const index = matches[0].start, last = matches[0].end, audio = words[index], bible = words[last];
  if (index > 2) return uncertain("unexpected-speech-before-intro");
  if (bible.end - audio.start < 0.3 || bible.end - audio.start > 3 || (last !== index && bible.start - audio.end > 0.5) || bible.end - bible.start < 0.1) {
    return uncertain("implausible-phrase-timing");
  }
  if (bible.end > transcript.duration - 0.25) return uncertain("phrase-touches-clip-boundary");
  // Confidence of later verse text/silence does not describe this introduction.
  const introSegments = transcript.segments?.filter(s => s.start === undefined || s.end === undefined ||
    Math.min(s.end, bible.end) - Math.max(s.start, audio.start) > 0.01);
  if (transcript.segments?.length && !introSegments?.length) return uncertain("intro-has-no-transcription-segment");
  // A no-speech score alone is not a failed decode: these short recordings have
  // substantial leading/trailing silence.
  if (introSegments?.some(s => s.avg_logprob < -1)) return uncertain("low-transcription-confidence");
  return { status: "detected", startSeconds: Math.round(bible.end * 1000) / 1000, reason: "after-audio-bible" };
}

export type IntroCandidate = { source: string; transcript: IntroTranscript };
export type ReconciledIntro = IntroOffset & { transcript: string; transcriptSource: string };

/** Retain useful earlier evidence instead of letting a worse retry discard it. */
export function reconcileIntroOffsets(candidates: IntroCandidate[]): ReconciledIntro {
  if (!candidates.length) throw new Error("At least one intro transcript is required");
  const results = candidates.map(candidate => ({ ...findIntroOffset(candidate.transcript),
    transcript: candidate.transcript.text, transcriptSource: candidate.source }));
  const confirmed = results.filter(result => result.status === "detected");
  if (!confirmed.length) return results[0];
  const starts = confirmed.map(result => result.startSeconds!);
  if (Math.max(...starts) - Math.min(...starts) > 0.15) return { ...results[0],
    status: "needs-review", startSeconds: null, reason: "conflicting-transcript-boundaries" };
  return confirmed.reduce((latest, result) => result.startSeconds! > latest.startSeconds! ? result : latest);
}

export function parsePauses(stderr: string): Pause[] {
  const pauses: Pause[] = [];
  let start: number | undefined;
  for (const match of stderr.matchAll(/silence_(start|end): ([\d.]+)/g)) {
    if (match[1] === "start") start = Number(match[2]);
    else if (start !== undefined) { pauses.push({ start, end: Number(match[2]) }); start = undefined; }
  }
  return pauses;
}

/** Keep time zero unchanged; stop inside the long gap before verse one. */
export function introClipEnd(pauses: Pause[]): number {
  const gap = pauses.find(p => p.start >= 2.8 && p.start <= 6.8 && p.end - p.start >= 0.65);
  return gap ? Math.round((gap.start + 0.2) * 1000) / 1000 : 8;
}
