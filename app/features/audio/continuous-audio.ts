export type ContinuousAudio = {
  url: string;
  startSeconds: number;
  endSeconds: number;
};
export type ContinuousAudioManifest = {
  version: 1;
  chapters: Record<string, ContinuousAudio>;
};
