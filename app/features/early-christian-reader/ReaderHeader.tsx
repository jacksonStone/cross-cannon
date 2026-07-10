import type { ComponentProps, Ref, SyntheticEvent } from "react";

import {
  ReaderSettingsControl,
  ReaderTools
} from "~/features/reader-ui/ReaderControls";
import { useOfflineStatus } from "~/features/offline/OfflineProvider";
import type { WorkDownloadState } from "~/features/offline/early-christian-work-downloads";

import type { BookSummary, EarlyChristianAudio } from "./types";

type ReaderSettingsControlProps = ComponentProps<typeof ReaderSettingsControl>;

export function EarlyChristianReaderHeader({
  activeAudio,
  activeAudioUrl,
  activeHeaderTitle,
  activeWork,
  availableOfflineWorkId,
  audioRef,
  headerTitleRef,
  isActiveChapterPlaying,
  isToolsOpen,
  onAudioEnded,
  onAudioPause,
  onAudioTimeUpdate,
  onCloseTools,
  onCancelDownload,
  onDownloadWork,
  onOpenJump,
  onOpenSearch,
  onOpenTools,
  onRemoveDownload,
  readerSettings,
  readerTitleRef,
  setReaderSettings,
  toggleActiveChapterAudio,
  downloadState,
  isWorkDownloaded
}: {
  activeAudio: EarlyChristianAudio | null;
  activeAudioUrl: string | null;
  activeHeaderTitle: string;
  activeWork: BookSummary;
  availableOfflineWorkId: string;
  audioRef: Ref<HTMLAudioElement>;
  headerTitleRef: Ref<HTMLDivElement>;
  isActiveChapterPlaying: boolean;
  isToolsOpen: boolean;
  onAudioEnded: () => void;
  onAudioPause: () => void;
  onAudioTimeUpdate: (event: SyntheticEvent<HTMLAudioElement>) => void;
  onCloseTools: () => void;
  onCancelDownload: () => void;
  onDownloadWork: () => void;
  onOpenJump: () => void;
  onOpenSearch: () => void;
  onOpenTools: () => void;
  onRemoveDownload: () => void;
  readerSettings: ReaderSettingsControlProps["settings"];
  readerTitleRef: Ref<HTMLHeadingElement>;
  setReaderSettings: ReaderSettingsControlProps["onChange"];
  toggleActiveChapterAudio: () => void;
  downloadState: WorkDownloadState;
  isWorkDownloaded: boolean;
}) {
  const { isOffline } = useOfflineStatus();
  const isThisWorkDownloading = downloadState.kind === "downloading"
    && downloadState.workId === activeWork.id;
  const isAnotherWorkDownloading = downloadState.kind === "downloading"
    && downloadState.workId !== activeWork.id;
  const hasDownloadError = downloadState.kind === "error"
    && downloadState.workId === activeWork.id;

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
        {!isOffline && activeAudioUrl && activeAudio ? (
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
        {!isOffline ? <button
          aria-label="Search"
          className="context-button reader-icon-button"
          onClick={onOpenSearch}
          title="Search"
          type="button"
        >
          🔍
        </button> : null}
        {isThisWorkDownloading ? (
          <button className="context-button" disabled type="button">
            Downloading {downloadState.completed}/{downloadState.total}
          </button>
        ) : isWorkDownloaded ? (
          <button className="context-button" onClick={onRemoveDownload} type="button">
            Remove download
          </button>
        ) : !isOffline ? (
          <button
            className="context-button"
            disabled={isAnotherWorkDownloading}
            onClick={onDownloadWork}
            type="button"
          >
            {hasDownloadError ? "Retry download" : "Download work"}
          </button>
        ) : null}
        {isAnotherWorkDownloading ? (
          <>
            <span className="offline-download-status">
              Downloading {downloadState.workName} {downloadState.completed}/{downloadState.total}
            </span>
            <button className="context-button" onClick={onCancelDownload} type="button">
              Cancel download
            </button>
          </>
        ) : null}
        {isThisWorkDownloading ? (
          <button className="context-button" onClick={onCancelDownload} type="button">
            Cancel download
          </button>
        ) : null}
        {hasDownloadError && downloadState.error ? (
          <span className="offline-download-status" role="alert">
            {downloadState.error}
          </span>
        ) : null}
        {availableOfflineWorkId === activeWork.id ? (
          <span className="offline-download-status" role="status">
            Available offline
          </span>
        ) : null}
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
