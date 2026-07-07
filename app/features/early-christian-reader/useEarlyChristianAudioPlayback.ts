import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SyntheticEvent } from "react";

import { normalizeEarlyChristianAudio } from "./chapter-assets";
import type { ChapterEntry } from "./types";

type ChapterAudio = NonNullable<ReturnType<typeof normalizeEarlyChristianAudio>>;

type ChapterAudioPlayback = {
  audio: ChapterAudio;
  key: string;
  preferContinuous?: boolean;
};

type ChapterAudioPlaybackResult = "continued" | "loaded" | null;

export function useEarlyChristianAudioPlayback({
  activeChapterIndex,
  activeEntry,
  chapters,
  onOpenChapter,
  resolvedActiveChapterId
}: {
  activeChapterIndex: number | undefined;
  activeEntry: ChapterEntry | undefined;
  chapters: ChapterEntry[];
  onOpenChapter: (chapterId: string) => boolean;
  resolvedActiveChapterId: string;
}) {
  const [playingAudioKey, setPlayingAudioKey] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playingAudioEndSecondsRef = useRef<number | null>(null);
  const suppressNextAudioPauseRef = useRef(false);
  const activeAudio = useMemo(() => (
    activeEntry ? normalizeEarlyChristianAudio(activeEntry.chapter.audio) : null
  ), [activeEntry]);
  const activeAudioKey = activeAudio
    ? audioKey(activeAudio)
    : null;
  const activeAudioUrl = activeAudio?.url ?? null;
  const isActiveChapterPlaying = Boolean(
    activeAudioKey && playingAudioKey === activeAudioKey
  );

  const playChapterAudio = useCallback(({
    audio: chapterAudio,
    key,
    preferContinuous = false
  }: ChapterAudioPlayback): ChapterAudioPlaybackResult => {
    const audio = audioRef.current;

    if (!audio) {
      return null;
    }

    const nextAudioUrl = new URL(chapterAudio.url, window.location.href).href;
    const canContinueCurrentSource = preferContinuous && audio.currentSrc === nextAudioUrl;
    playingAudioEndSecondsRef.current = chapterAudio.endSeconds ?? null;

    if (canContinueCurrentSource) {
      setPlayingAudioKey(key);

      if (audio.paused) {
        seekAudio(audio, chapterAudio.startSeconds ?? 0);
        void audio.play()
          .then(() => setPlayingAudioKey(key))
          .catch(() => clearPlayingAudio());
      }

      return "continued";
    }

    audio.src = chapterAudio.url;
    audio.load();

    const playFromOffset = () => {
      seekAudio(audio, chapterAudio.startSeconds ?? 0);

      void audio.play()
        .then(() => setPlayingAudioKey(key))
        .catch(() => clearPlayingAudio());
    };

    if (audio.readyState >= 1) {
      playFromOffset();
    } else {
      audio.addEventListener("loadedmetadata", playFromOffset, { once: true });
    }

    return "loaded";
  }, []);

  const syncPlayingAudioToCurrentChapter = useCallback((audio: HTMLAudioElement) => {
    const matching = findChapterForAudioTime(chapters, audio);

    if (!matching) {
      return false;
    }

    playingAudioEndSecondsRef.current = matching.audio.endSeconds ?? null;
    setPlayingAudioKey(audioKey(matching.audio));

    if (matching.entry.chapter.id !== resolvedActiveChapterId) {
      onOpenChapter(matching.entry.chapter.id);
    }

    return true;
  }, [chapters, onOpenChapter, resolvedActiveChapterId]);

  const playNextChapterAudio = useCallback(() => {
    if (typeof activeChapterIndex !== "number") {
      return null;
    }

    const nextEntry = chapters[activeChapterIndex + 1];
    const nextAudio = normalizeEarlyChristianAudio(nextEntry?.chapter.audio);

    if (!nextEntry || !nextAudio) {
      return null;
    }

    onOpenChapter(nextEntry.chapter.id);
    return playChapterAudio({
      audio: nextAudio,
      key: audioKey(nextAudio),
      preferContinuous: true
    });
  }, [activeChapterIndex, chapters, onOpenChapter, playChapterAudio]);

  const toggleActiveChapterAudio = useCallback(() => {
    const audio = audioRef.current;

    if (!audio || !activeAudio || !activeAudioKey) {
      return;
    }

    if (isActiveChapterPlaying) {
      audio.pause();
      clearPlayingAudio();
      return;
    }

    playChapterAudio({
      audio: activeAudio,
      key: activeAudioKey
    });
  }, [activeAudio, activeAudioKey, isActiveChapterPlaying, playChapterAudio]);

  const handleAudioEnded = useCallback(() => {
    const playbackResult = playNextChapterAudio();

    if (playbackResult) {
      suppressNextAudioPauseRef.current = playbackResult === "loaded";
      return;
    }

    clearPlayingAudio();
  }, [playNextChapterAudio]);

  const handleAudioPause = useCallback(() => {
    if (suppressNextAudioPauseRef.current) {
      suppressNextAudioPauseRef.current = false;
      return;
    }

    clearPlayingAudio();
  }, []);

  const handleAudioTimeUpdate = useCallback((event: SyntheticEvent<HTMLAudioElement>) => {
    if (syncPlayingAudioToCurrentChapter(event.currentTarget)) {
      return;
    }

    const endSeconds = playingAudioEndSecondsRef.current;

    if (!endSeconds || event.currentTarget.currentTime < endSeconds) {
      return;
    }

    const playbackResult = playNextChapterAudio();

    if (playbackResult) {
      suppressNextAudioPauseRef.current = playbackResult === "loaded";
      return;
    }

    event.currentTarget.pause();
    clearPlayingAudio();
  }, [playNextChapterAudio, syncPlayingAudioToCurrentChapter]);

  useEffect(() => {
    const syncAudioChapter = () => {
      const audio = audioRef.current;

      if (!audio?.currentSrc) {
        return;
      }

      syncPlayingAudioToCurrentChapter(audio);
    };

    window.addEventListener("focus", syncAudioChapter);
    window.addEventListener("pageshow", syncAudioChapter);
    document.addEventListener("visibilitychange", syncAudioChapter);

    return () => {
      window.removeEventListener("focus", syncAudioChapter);
      window.removeEventListener("pageshow", syncAudioChapter);
      document.removeEventListener("visibilitychange", syncAudioChapter);
    };
  }, [syncPlayingAudioToCurrentChapter]);

  function clearPlayingAudio() {
    playingAudioEndSecondsRef.current = null;
    setPlayingAudioKey(null);
  }

  return {
    activeAudio,
    activeAudioUrl,
    audioRef,
    handleAudioEnded,
    handleAudioPause,
    handleAudioTimeUpdate,
    isActiveChapterPlaying,
    toggleActiveChapterAudio
  };
}

function findChapterForAudioTime(chapters: ChapterEntry[], audio: HTMLAudioElement) {
  const currentSource = audio.currentSrc;

  if (!currentSource || !Number.isFinite(audio.currentTime)) {
    return null;
  }

  for (const entry of chapters) {
    const chapterAudio = normalizeEarlyChristianAudio(entry.chapter.audio);

    if (!chapterAudio || new URL(chapterAudio.url, window.location.href).href !== currentSource) {
      continue;
    }

    const startSeconds = chapterAudio.startSeconds ?? 0;
    const endSeconds = chapterAudio.endSeconds ?? Number.POSITIVE_INFINITY;

    if (audio.currentTime >= startSeconds && audio.currentTime < endSeconds) {
      return {
        audio: chapterAudio,
        entry
      };
    }
  }

  return null;
}

function seekAudio(audio: HTMLAudioElement, seconds: number) {
  try {
    audio.currentTime = Math.max(0, seconds);
  } catch {
    // Some browsers reject seeking until enough metadata is available.
  }
}

function audioKey(audio: ChapterAudio) {
  return `${audio.url}#${audio.startSeconds ?? 0}`;
}
