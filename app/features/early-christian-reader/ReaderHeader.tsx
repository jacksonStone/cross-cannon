import type { ComponentProps, Ref, SyntheticEvent } from "react";

import {
  ReaderSettingsControl,
  ReaderTools
} from "~/features/reader-ui/ReaderControls";

import type { EarlyChristianAudio } from "./types";

type ReaderSettingsControlProps = ComponentProps<typeof ReaderSettingsControl>;

export function EarlyChristianReaderHeader({
  activeAudio,
  activeAudioUrl,
  activeHeaderTitle,
  audioRef,
  headerTitleRef,
  isActiveChapterPlaying,
  isToolsOpen,
  onAudioEnded,
  onAudioPause,
  onAudioTimeUpdate,
  onCloseTools,
  onOpenJump,
  onOpenSearch,
  onOpenTools,
  readerSettings,
  readerTitleRef,
  setReaderSettings,
  toggleActiveChapterAudio
}: {
  activeAudio: EarlyChristianAudio | null;
  activeAudioUrl: string | null;
  activeHeaderTitle: string;
  audioRef: Ref<HTMLAudioElement>;
  headerTitleRef: Ref<HTMLDivElement>;
  isActiveChapterPlaying: boolean;
  isToolsOpen: boolean;
  onAudioEnded: () => void;
  onAudioPause: () => void;
  onAudioTimeUpdate: (event: SyntheticEvent<HTMLAudioElement>) => void;
  onCloseTools: () => void;
  onOpenJump: () => void;
  onOpenSearch: () => void;
  onOpenTools: () => void;
  readerSettings: ReaderSettingsControlProps["settings"];
  readerTitleRef: Ref<HTMLHeadingElement>;
  setReaderSettings: ReaderSettingsControlProps["onChange"];
  toggleActiveChapterAudio: () => void;
}) {
  return (
    <header className="reader-header">
      <audio
        ref={audioRef}
        onEnded={onAudioEnded}
        onPause={onAudioPause}
        onTimeUpdate={onAudioTimeUpdate}
        preload="none"
      />
      <div className="reader-header-title" ref={headerTitleRef}>
        <p className="eyebrow">Early Christian Works</p>
        <h1
          className="ec-reader-title"
          id="reader-title"
          ref={readerTitleRef}
        >
          {activeHeaderTitle}
        </h1>
      </div>
      <ReaderTools
        isOpen={isToolsOpen}
        onClose={onCloseTools}
        onOpen={onOpenTools}
      >
        {activeAudioUrl && activeAudio ? (
          <button
            aria-label={`${isActiveChapterPlaying ? "Pause" : "Play"} audio covering ${activeAudio.label}`}
            className="context-button reader-icon-button"
            onClick={toggleActiveChapterAudio}
            title={`${isActiveChapterPlaying ? "Pause" : "Play"} audio covering ${activeAudio.label}`}
            type="button"
          >
            {isActiveChapterPlaying ? "❚❚" : "🔊"}
          </button>
        ) : null}
        <button
          aria-label="Search"
          className="context-button reader-icon-button"
          onClick={onOpenSearch}
          title="Search"
          type="button"
        >
          🔍
        </button>
        <section className="passage-jump-launcher is-inline" aria-label="Jump">
          <button
            className="context-button"
            onClick={onOpenJump}
            type="button"
          >
            Jump
          </button>
        </section>
        <ReaderSettingsControl
          onChange={setReaderSettings}
          settings={readerSettings}
        />
      </ReaderTools>
    </header>
  );
}
