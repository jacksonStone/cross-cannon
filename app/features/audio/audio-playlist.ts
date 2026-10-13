export type ChapterRecording = {
  url: string;
  startSeconds: number;
  endSeconds?: number;
};
export type AudioChapter = {
  id: string;
  title: string;
  workId: string;
  audio: ChapterRecording | null;
  originalAudio?: ChapterRecording | null;
};

export function chapterAtTime(
  chapters: AudioChapter[],
  url: string,
  seconds: number
) {
  // Preserve the first match for legacy chapters sharing an unaligned recording.
  return chapters.find(
    (chapter) =>
      chapter.audio?.url === url &&
      seconds >= chapter.audio.startSeconds &&
      seconds < (chapter.audio.endSeconds ?? Infinity)
  );
}

export function nextAudioChapter(
  chapters: AudioChapter[],
  id: string,
  direction = 1
) {
  const index = chapters.findIndex((chapter) => chapter.id === id);
  const next = chapters[index + direction];
  return index >= 0 && next?.audio && next.workId === chapters[index].workId
    ? next
    : null;
}
