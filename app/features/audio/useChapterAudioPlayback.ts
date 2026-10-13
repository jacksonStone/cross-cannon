import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import {
  chapterAtTime,
  nextAudioChapter,
  type AudioChapter,
} from "./audio-playlist";

type Session = {
  chapters: AudioChapter[];
  id: string;
  url: string;
  pendingSeek: boolean;
  startingAt: number | null;
};

export function useChapterAudioPlayback({
  chapters,
  activeId,
  onChapterChange,
}: {
  chapters: AudioChapter[];
  activeId: string;
  onChapterChange?: (id: string) => unknown;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const session = useRef<Session | null>(null);
  const cleanupSeek = useRef<(() => void) | null>(null);
  const operation = useRef(0);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const latest = useRef({ chapters, activeId, onChapterChange });
  latest.current = { chapters, activeId, onChapterChange };

  const attachAudio = useCallback((element: HTMLAudioElement | null) => {
    const previous = audioRef.current;
    if (previous && previous !== element) {
      operation.current++;
      cleanupSeek.current?.();
      previous.pause();
      previous.removeAttribute("src");
      previous.load();
    }
    audioRef.current = element;
  }, []);

  const describe = useCallback((chapter: AudioChapter) => {
    setPlayingId(chapter.id);
    if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: chapter.title,
        artist: "Cross Canon",
      });
    }
  }, []);

  const playChapter = useCallback(
    (chapter: AudioChapter, playlist: AudioChapter[]) => {
      const audio = audioRef.current;
      if (!audio || !chapter.audio) return;
      const currentOperation = ++operation.current;
      cleanupSeek.current?.();
      session.current = {
        chapters: playlist,
        id: chapter.id,
        url: chapter.audio.url,
        pendingSeek: true,
        startingAt: chapter.audio.startSeconds,
      };
      describe(chapter);
      const offset = chapter.audio.startSeconds;
      const finishSeek = () => {
        if (operation.current !== currentOperation || !session.current) return;
        session.current.pendingSeek = false;
        cleanupSeek.current?.();
        cleanupSeek.current = null;
      };
      const seek = () => {
        if (operation.current !== currentOperation) return;
        audio.currentTime = offset;
        // A no-op seek need not emit seeked (for example, chapter one at zero).
        if (!audio.seeking) finishSeek();
      };
      audio.addEventListener("seeked", finishSeek);
      cleanupSeek.current = () => {
        audio.removeEventListener("loadedmetadata", seek);
        audio.removeEventListener("seeked", finishSeek);
      };
      if (
        audio.getAttribute("src") === chapter.audio.url &&
        audio.readyState >= 1
      ) {
        seek();
      } else {
        audio.addEventListener("loadedmetadata", seek, { once: true });
        audio.src = chapter.audio.url;
      }
      // Call play during the user gesture; metadata loading must not defer authorization.
      void audio
        .play()
        .then(() => {
          if (operation.current === currentOperation) setIsPlaying(true);
        })
        .catch(() => {
          if (operation.current === currentOperation) setIsPlaying(false);
        });
    },
    [describe]
  );

  const sync = useCallback((allowBackwardSeek = false) => {
    const audio = audioRef.current;
    const current = session.current;
    // Loading and seeking can emit timeupdate for zero or the previous position.
    // Only a settled position in the requested recording may move the reader.
    if (
      !audio || !current || current.pendingSeek || audio.seeking ||
      audio.readyState < 1 ||
      audio.currentSrc !== new URL(current.url, window.location.href).href
    ) return false;
    // A settled seek can report a rounded time just before the chapter start.
    // Starting playback owns the requested chapter; it must not scroll backward
    // while the clock catches up to that chapter's exact sample offset.
    if (current.startingAt !== null) {
      if (audio.currentTime < current.startingAt) return false;
      current.startingAt = null;
    }
    const playingChapter = current.chapters.find(chapter => chapter.id === current.id);
    // Ordinary playback updates move forward. Only a deliberate seek may move
    // the reader backward; a rounded clock at the start must leave it in place.
    if (
      !allowBackwardSeek && playingChapter?.audio &&
      audio.currentTime < playingChapter.audio.startSeconds
    ) return false;
    const chapter = chapterAtTime(
      current.chapters,
      current.url,
      audio.currentTime
    );
    if (chapter && chapter.id !== current.id) {
      current.id = chapter.id;
      describe(chapter);
      latest.current.onChapterChange?.(chapter.id);
    }
    return true;
  }, [describe]);

  const toggleActiveChapterAudio = useCallback(() => {
    const audio = audioRef.current;
    const { chapters: list, activeId: id } = latest.current;
    const chapter = list.find((entry) => entry.id === id);
    if (!audio || !chapter?.audio) return;
    if (session.current?.id === id && !audio.ended) {
      if (!audio.paused) audio.pause();
      else void audio.play().catch(() => setIsPlaying(false));
      return;
    }
    playChapter(chapter, list);
  }, [playChapter]);

  const advance = useCallback(
    (direction = 1) => {
      const current = session.current;
      if (!current) return;
      const next = nextAudioChapter(current.chapters, current.id, direction);
      if (next) {
        playChapter(next, current.chapters);
        latest.current.onChapterChange?.(next.id);
      }
    },
    [playChapter]
  );

  const handleAudioEnded = useCallback(() => {
    setIsPlaying(false);
    const current = session.current;
    if (!current) return;
    const next = nextAudioChapter(current.chapters, current.id);
    // A combined file is the entire work: never restart it at its end.
    if (next?.audio?.url !== current.url) advance();
  }, [advance]);

  const handleAudioTimeUpdate = useCallback(
    (_event?: SyntheticEvent<HTMLAudioElement>) => {
      if (!sync()) return;
      const current = session.current;
      const audio = audioRef.current;
      if (!current || !audio || audio.paused) return;
      const chapter = current.chapters.find((entry) => entry.id === current.id);
      const next = nextAudioChapter(current.chapters, current.id);
      // Continuous streams never need JS to advance at chapter boundaries or gaps.
      if (current.url.startsWith("/audio/continuous/")) return;
      if (
        chapter?.audio?.endSeconds &&
        audio.currentTime >= chapter.audio.endSeconds
      ) {
        if (next) advance();
        else audio.pause();
      }
    },
    [sync, advance]
  );

  const handleAudioError = useCallback(() => {
    const current = session.current;
    if (!current || !current.url.startsWith("/audio/continuous/")) {
      setIsPlaying(false);
      return;
    }
    // An unavailable combined asset leaves the original chapter player usable.
    const originals = current.chapters.map((chapter) => ({
      ...chapter,
      audio: chapter.originalAudio ?? chapter.audio,
    }));
    const chapter = originals.find((entry) => entry.id === current.id);
    if (chapter?.audio && chapter.audio.url !== current.url)
      playChapter(chapter, originals);
    else setIsPlaying(false);
  }, [playChapter]);

  useEffect(() => {
    const resume = () => sync();
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [sync]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const media = navigator.mediaSession;
    const handlers: Partial<
      Record<MediaSessionAction, MediaSessionActionHandler>
    > = {
      play: () => {
        void audioRef.current?.play().catch(() => setIsPlaying(false));
      },
      pause: () => audioRef.current?.pause(),
      nexttrack: () => advance(),
      previoustrack: () => advance(-1),
      seekto: (details) => {
        const audio = audioRef.current;
        if (
          audio &&
          details.seekTime !== undefined &&
          Number.isFinite(audio.duration)
        )
          audio.currentTime = Math.max(
            0,
            Math.min(audio.duration, details.seekTime)
          );
      },
      seekforward: (details) => {
        const audio = audioRef.current;
        if (audio && Number.isFinite(audio.duration))
          audio.currentTime = Math.min(
            audio.duration,
            audio.currentTime + (details.seekOffset ?? 15)
          );
      },
      seekbackward: (details) => {
        const audio = audioRef.current;
        if (audio)
          audio.currentTime = Math.max(
            0,
            audio.currentTime - (details.seekOffset ?? 15)
          );
      },
    };
    for (const [action, handler] of Object.entries(handlers)) {
      try {
        media.setActionHandler(action as MediaSessionAction, handler);
      } catch {
        /* Optional platform action. */
      }
    }
    return () => {
      for (const action of Object.keys(handlers)) {
        try {
          media.setActionHandler(action as MediaSessionAction, null);
        } catch {
          /* Optional platform action. */
        }
      }
      media.metadata = null;
      media.playbackState = "none";
    };
  }, [advance]);

  useEffect(() => {
    if ("mediaSession" in navigator)
      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
  }, [isPlaying]);
  useEffect(
    () => () => {
      operation.current++;
      cleanupSeek.current?.();
    },
    []
  );

  return {
    audioRef: attachAudio,
    isActiveChapterPlaying: isPlaying && playingId === activeId,
    toggleActiveChapterAudio,
    handleAudioEnded,
    handleAudioPause: () => setIsPlaying(false),
    handleAudioPlay: () => setIsPlaying(true),
    handleAudioTimeUpdate,
    handleAudioSeeked: () => sync(true),
    handleAudioError,
  };
}
