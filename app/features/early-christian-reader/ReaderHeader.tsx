import type { ComponentProps, Ref, SyntheticEvent } from "react";

import {
  ReaderSettingsControl,
  ReaderTools,
} from "~/features/reader-ui/ReaderControls";
import { useOfflineStatus } from "~/features/offline/OfflineProvider";
import type { WorkDownloadState } from "~/features/offline/early-christian-work-downloads";

import type { BookSummary, EarlyChristianAudio } from "./types";

type ReaderSettingsControlProps = ComponentProps<typeof ReaderSettingsControl>;

function DownloadIcon({ downloaded = false }: { downloaded?: boolean }) {
  return (
    <svg aria-hidden="true" className="ec-download-icon" viewBox="0 0 24 24">
      {downloaded ? (
        <path d="m7 12 3.2 3.2L17.5 8" />
      ) : (
        <>
          <path d="M12 4v11" />
          <path d="m8 11 4 4 4-4" />
        </>
      )}
      <path d="M6 20h12" />
    </svg>
  );
}

function DownloadProgressIcon({
  completed,
  total,
}: {
  completed: number;
  total: number;
}) {
  const circumference = 2 * Math.PI * 8;
  const progress = total > 0 ? Math.min(1, completed / total) : 0;

  return (
    <svg aria-hidden="true" className="ec-download-icon" viewBox="0 0 24 24">
      <circle className="ec-download-progress-track" cx="12" cy="12" r="8" />
      <circle
        className="ec-download-progress-value"
        cx="12"
        cy="12"
        r="8"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - progress)}
      />
      <path className="ec-download-progress-cancel" d="m9.5 9.5 5 5m0-5-5 5" />
    </svg>
  );
}

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
  isWorkDownloaded,
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
  const isThisWorkDownloading =
    downloadState.kind === "downloading" &&
    downloadState.workId === activeWork.id;
  const isAnotherWorkDownloading =
    downloadState.kind === "downloading" &&
    downloadState.workId !== activeWork.id;
  const isManualDownloadBlocking =
    isAnotherWorkDownloading && downloadState.source === "manual";
  const hasDownloadError =
    downloadState.kind === "error" && downloadState.workId === activeWork.id;

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
        <h1 className="ec-reader-title" id="reader-title" ref={readerTitleRef}>
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
            aria-label={`${
              isActiveChapterPlaying ? "Pause" : "Play"
            } audio covering ${activeAudio.label}`}
            className="context-button reader-icon-button"
            onClick={toggleActiveChapterAudio}
            title={`${
              isActiveChapterPlaying ? "Pause" : "Play"
            } audio covering ${activeAudio.label}`}
            type="button"
          >
            {isActiveChapterPlaying ? "❚❚" : "🔊"}
          </button>
        ) : null}
        {!isOffline ? (
          <button
            aria-label="Search"
            className="context-button reader-icon-button"
            onClick={onOpenSearch}
            title="Search"
            type="button"
          >
            🔍
          </button>
        ) : null}
        {isThisWorkDownloading ? (
          <button
            aria-label={`Cancel ${
              downloadState.source === "background" ? "update" : "download"
            }: ${downloadState.completed} of ${downloadState.total}`}
            className="context-button reader-icon-button ec-download-control"
            onClick={onCancelDownload}
            title={`Cancel ${
              downloadState.source === "background" ? "update" : "download"
            } (${downloadState.completed}/${downloadState.total})`}
            type="button"
          >
            <DownloadProgressIcon
              completed={downloadState.completed}
              total={downloadState.total}
            />
            <span className="visually-hidden">
              {downloadState.source === "background"
                ? "Updating"
                : "Downloading"}{" "}
              {downloadState.completed}/{downloadState.total}. Cancel download
            </span>
          </button>
        ) : isWorkDownloaded ? (
          <button
            aria-label="Remove download"
            className="context-button reader-icon-button ec-download-control is-downloaded"
            onClick={onRemoveDownload}
            title="Remove download"
            type="button"
          >
            <DownloadIcon downloaded />
            <span className="visually-hidden">Remove download</span>
          </button>
        ) : !isOffline ? (
          <button
            aria-label={hasDownloadError ? "Retry download" : "Download work"}
            className="context-button reader-icon-button ec-download-control"
            disabled={isManualDownloadBlocking}
            onClick={onDownloadWork}
            title={hasDownloadError ? "Retry download" : "Download work"}
            type="button"
          >
            <DownloadIcon />
            <span className="visually-hidden">
              {hasDownloadError ? "Retry download" : "Download work"}
            </span>
          </button>
        ) : null}
        {isAnotherWorkDownloading ? (
          <>
            <span className="offline-download-status">
              {downloadState.source === "background"
                ? "Updating"
                : "Downloading"}{" "}
              {downloadState.workName} {downloadState.completed}/
              {downloadState.total}
            </span>
            <button
              className="context-button"
              onClick={onCancelDownload}
              type="button"
            >
              Cancel download
            </button>
          </>
        ) : null}
        {hasDownloadError && downloadState.error ? (
          <span className="offline-download-status" role="alert">
            {downloadState.error}
          </span>
        ) : null}
        {availableOfflineWorkId === activeWork.id ? (
          <span className="visually-hidden" role="status">
            Available offline
          </span>
        ) : null}
        <section className="passage-jump-launcher is-inline" aria-label="Jump">
          <button className="context-button" onClick={onOpenJump} type="button">
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
