import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";

import { Form, Link, useNavigation } from "@remix-run/react";

import { PassageJump } from "~/features/passage-jump/PassageJump";
import { sortCanonicalBooks } from "~/features/search/canons";
import type { StoredFilters } from "~/features/search/types";
import type { BrowserPassage } from "~/lib/scripture-cache.server";

import { buildChapterIndex, chapterKey } from "./chapter-index";

const TRANSLATION_ABBREVIATION = "WEB";
const HEADER_SCROLL_OFFSET = 118;
const READING_ANCHOR_RATIO = 0.38;
const MIN_READING_ANCHOR_OFFSET = 220;
const INITIAL_PREVIOUS_CHAPTERS = 10;
const INITIAL_NEXT_CHAPTERS = 24;
const CHAPTER_WINDOW_EXPAND_COUNT = 10;
const CHAPTER_WINDOW_EDGE_PX = 2200;
const READER_SETTINGS_STORAGE_KEY = "cross-cannon:reader-settings:v1";
const useBrowserLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

const READER_PRESETS = {
  default: {
    label: "Default",
    fontScale: 1,
    lineHeight: 1.72,
    contentWidth: 820
  },
  compact: {
    label: "Compact",
    fontScale: 0.94,
    lineHeight: 1.54,
    contentWidth: 880
  },
  open: {
    label: "Open",
    fontScale: 1.07,
    lineHeight: 1.86,
    contentWidth: 760
  },
  relaxed: {
    label: "Relaxed",
    fontScale: 1.14,
    lineHeight: 1.96,
    contentWidth: 700
  }
} as const;

const READER_THEMES = {
  paper: "Paper",
  sepia: "Sepia",
  dark: "Dark",
  contrast: "Contrast"
} as const;

type ReaderPreset = keyof typeof READER_PRESETS;
type ReaderTheme = keyof typeof READER_THEMES;

type ReaderSettings = {
  contentWidth: number;
  fontScale: number;
  lineHeight: number;
  preset: ReaderPreset | "custom";
  theme: ReaderTheme;
};

const DEFAULT_READER_SETTINGS = createPresetReaderSettings("default", "paper");

type PassageReaderProps = {
  filters: StoredFilters;
  initialPassageId: string;
  isScriptureReady: boolean;
  onJumpToPassage?: (passageId: string) => void;
  onLocationChange?: (passageId: string) => void;
  onOpenSearch?: () => void;
  passages: BrowserPassage[];
};

export function PassageReader({
  filters,
  initialPassageId,
  isScriptureReady,
  onJumpToPassage,
  onLocationChange,
  onOpenSearch,
  passages
}: PassageReaderProps) {
  const navigation = useNavigation();
  const canReportLocationRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hasScrolledToInitialPassageRef = useRef(false);
  const lastReportedPassageIdRef = useRef("");
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const [readerSettings, setReaderSettings] = useState(DEFAULT_READER_SETTINGS);
  const [hasLoadedReaderSettings, setHasLoadedReaderSettings] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [playingAudioUrl, setPlayingAudioUrl] = useState<string | null>(null);
  const [renderedRange, setRenderedRange] = useState({
    endIndex: -1,
    startIndex: 0
  });
  const prependSnapshotRef = useRef<{
    scrollHeight: number;
    scrollY: number;
  } | null>(null);
  const chapterIndex = useMemo(() => buildChapterIndex(passages), [passages]);
  const orderedChapterEntries = useMemo(
    () => {
      const chapters = [...chapterIndex.chaptersByKey.values()];
      const bookOrder = new Map(
        sortCanonicalBooks([...new Set(chapters.map((chapter) => chapter.book))])
          .map((book, index) => [book, index])
      );

      return chapters
        .sort((left, right) => {
          const leftBookOrder = bookOrder.get(left.book) ?? Number.MAX_SAFE_INTEGER;
          const rightBookOrder = bookOrder.get(right.book) ?? Number.MAX_SAFE_INTEGER;

          if (leftBookOrder !== rightBookOrder) {
            return leftBookOrder - rightBookOrder;
          }

          return left.chapter - right.chapter;
        })
        .map((chapter) => ({
          chapter,
          key: chapterKey(chapter.book, chapter.chapter)
        }));
    },
    [chapterIndex]
  );
  const renderedChapterKeys = useMemo(
    () => orderedChapterEntries.map((entry) => entry.key),
    [orderedChapterEntries]
  );
  const initialLocation = chapterIndex.locationByPassageId.get(initialPassageId);
  const initialChapterKey = initialLocation
    ? chapterKey(initialLocation.book, initialLocation.chapter)
    : orderedChapterEntries[0]?.key ?? null;
  const [activeChapterKey, setActiveChapterKey] = useState(initialChapterKey);
  const [selectedPassageId, setSelectedPassageId] = useState("");
  const activeChapter = activeChapterKey
    ? chapterIndex.chaptersByKey.get(activeChapterKey)
    : null;
  const initialChapterIndex = initialChapterKey
    ? renderedChapterKeys.indexOf(initialChapterKey)
    : -1;
  const renderedChapterEntries = useMemo(
    () => {
      if (renderedRange.endIndex < renderedRange.startIndex) {
        return [];
      }

      return orderedChapterEntries.slice(
        Math.max(0, renderedRange.startIndex),
        renderedRange.endIndex + 1
      );
    },
    [orderedChapterEntries, renderedRange.endIndex, renderedRange.startIndex]
  );
  const passageJumpInitialPassageId =
    activeChapter?.passages[0]?.id ?? initialPassageId;
  const activeAudioUrl = activeChapter?.audioUrl ?? null;
  const isActiveChapterPlaying = Boolean(
    activeAudioUrl && playingAudioUrl === activeAudioUrl
  );

  const toggleActiveChapterAudio = useCallback(() => {
    const audio = audioRef.current;

    if (!audio || !activeAudioUrl) {
      return;
    }

    if (isActiveChapterPlaying) {
      audio.pause();
      setPlayingAudioUrl(null);
      return;
    }

    audio.src = activeAudioUrl;
    void audio.play()
      .then(() => setPlayingAudioUrl(activeAudioUrl))
      .catch(() => setPlayingAudioUrl(null));
  }, [activeAudioUrl, isActiveChapterPlaying]);

  useBrowserLayoutEffect(() => {
    const nextRange = getInitialRenderedRange(
      initialChapterIndex,
      orderedChapterEntries.length
    );

    setRenderedRange(nextRange);
    setActiveChapterKey(initialChapterKey);
    setSelectedPassageId("");
    prependSnapshotRef.current = null;
    canReportLocationRef.current = false;
    lastReportedPassageIdRef.current = initialPassageId;
    hasScrolledToInitialPassageRef.current = false;
  }, [initialChapterIndex, initialChapterKey, initialPassageId, orderedChapterEntries.length]);

  useBrowserLayoutEffect(() => {
    if (!isScriptureReady || renderedChapterEntries.length === 0) {
      return;
    }

    if (hasScrolledToInitialPassageRef.current) {
      return;
    }

    const scrollToInitialPassage = () => {
      const initialPassage = findRenderedPassageElement(initialPassageId);

      if (!initialPassage) {
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
        return;
      }

      const top = initialPassage.getBoundingClientRect().top
        + window.scrollY
        - HEADER_SCROLL_OFFSET;

      window.scrollTo({
        behavior: "auto",
        left: 0,
        top: Math.max(0, top)
      });
    };

    scrollToInitialPassage();

    let settleFrame = 0;
    let settleTimeout = 0;
    let didCancel = false;

    const finishInitialScroll = () => {
      if (didCancel) {
        return;
      }

      scrollToInitialPassage();
      hasScrolledToInitialPassageRef.current = true;
    };

    settleFrame = window.requestAnimationFrame(() => {
      scrollToInitialPassage();

      settleFrame = window.requestAnimationFrame(() => {
        scrollToInitialPassage();
      });
    });

    settleTimeout = window.setTimeout(finishInitialScroll, 180);
    void document.fonts?.ready.then(finishInitialScroll).catch(finishInitialScroll);

    return () => {
      didCancel = true;

      if (settleFrame) {
        window.cancelAnimationFrame(settleFrame);
      }

      if (settleTimeout) {
        window.clearTimeout(settleTimeout);
      }
    };
  }, [initialPassageId, isScriptureReady, renderedChapterEntries.length]);

  useBrowserLayoutEffect(() => {
    const snapshot = prependSnapshotRef.current;

    if (!snapshot) {
      return;
    }

    prependSnapshotRef.current = null;

    const nextScrollHeight = document.documentElement.scrollHeight;
    const addedHeight = nextScrollHeight - snapshot.scrollHeight;

    if (addedHeight > 0) {
      window.scrollTo({
        behavior: "auto",
        left: 0,
        top: snapshot.scrollY + addedHeight
      });
    }
  }, [renderedRange.startIndex]);

  useEffect(() => {
    if (!isScriptureReady || orderedChapterEntries.length === 0) {
      return;
    }

    let frame = 0;

    const expandRenderedWindow = () => {
      frame = 0;

      const distanceToTop = window.scrollY;
      const distanceToBottom = document.documentElement.scrollHeight
        - (window.scrollY + window.innerHeight);

      if (distanceToTop < CHAPTER_WINDOW_EDGE_PX) {
        setRenderedRange((range) => {
          if (range.startIndex <= 0) {
            return range;
          }

          const nextStartIndex = Math.max(
            0,
            range.startIndex - CHAPTER_WINDOW_EXPAND_COUNT
          );

          if (nextStartIndex === range.startIndex) {
            return range;
          }

          prependSnapshotRef.current = {
            scrollHeight: document.documentElement.scrollHeight,
            scrollY: window.scrollY
          };

          return {
            ...range,
            startIndex: nextStartIndex
          };
        });
      }

      if (distanceToBottom < CHAPTER_WINDOW_EDGE_PX) {
        setRenderedRange((range) => {
          if (range.endIndex >= orderedChapterEntries.length - 1) {
            return range;
          }

          return {
            ...range,
            endIndex: Math.min(
              orderedChapterEntries.length - 1,
              range.endIndex + CHAPTER_WINDOW_EXPAND_COUNT
            )
          };
        });
      }
    };

    const scheduleExpand = () => {
      if (!frame) {
        frame = window.requestAnimationFrame(expandRenderedWindow);
      }
    };

    window.addEventListener("scroll", scheduleExpand, { passive: true });
    window.addEventListener("resize", scheduleExpand);
    window.requestAnimationFrame(expandRenderedWindow);

    return () => {
      window.removeEventListener("scroll", scheduleExpand);
      window.removeEventListener("resize", scheduleExpand);

      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [isScriptureReady, orderedChapterEntries.length]);

  useEffect(() => {
    if (!isScriptureReady) {
      return;
    }

    const enableLocationReporting = () => {
      canReportLocationRef.current = true;
    };
    const enableLocationReportingFromKey = (event: KeyboardEvent) => {
      if (
        event.key === "ArrowDown"
        || event.key === "ArrowUp"
        || event.key === "PageDown"
        || event.key === "PageUp"
        || event.key === " "
        || event.key === "Home"
        || event.key === "End"
      ) {
        enableLocationReporting();
      }
    };

    window.addEventListener("wheel", enableLocationReporting, { passive: true });
    window.addEventListener("touchmove", enableLocationReporting, { passive: true });
    window.addEventListener("keydown", enableLocationReportingFromKey);

    return () => {
      window.removeEventListener("wheel", enableLocationReporting);
      window.removeEventListener("touchmove", enableLocationReporting);
      window.removeEventListener("keydown", enableLocationReportingFromKey);
    };
  }, [isScriptureReady]);

  useEffect(() => {
    if (orderedChapterEntries.length === 0) {
      return;
    }

    let frame = 0;

    const updateLocation = () => {
      frame = 0;

      if (!hasScrolledToInitialPassageRef.current || !canReportLocationRef.current) {
        return;
      }

      const passageElements = [
        ...document.querySelectorAll<HTMLElement>(".reader-passage")
      ];
      const currentPassage = findElementAtReadingAnchor(passageElements);
      const passageId = currentPassage?.dataset.passageId;

      if (passageId && passageId !== lastReportedPassageIdRef.current) {
        lastReportedPassageIdRef.current = passageId;
        onLocationChange?.(passageId);
      }

      const chapterElements = [
        ...document.querySelectorAll<HTMLElement>(".reader-chapter")
      ];
      const currentChapter = findElementAtReadingAnchor(chapterElements);
      const currentChapterKey = currentChapter?.dataset.chapterKey;

      if (currentChapterKey) {
        setActiveChapterKey((existingChapterKey) => {
          if (existingChapterKey === currentChapterKey) {
            return existingChapterKey;
          }

          return currentChapterKey;
        });
      }
    };

    const scheduleUpdate = () => {
      if (!frame) {
        frame = window.requestAnimationFrame(updateLocation);
      }
    };

    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.requestAnimationFrame(updateLocation);

    return () => {
      window.removeEventListener("scroll", scheduleUpdate);
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [
    onLocationChange,
    orderedChapterEntries.length
  ]);

  const isSearchingSimilar = navigation.state === "submitting"
    && navigation.formData?.get("intent") === "similar-passage";
  const readerStyle = {
    "--reader-content-width": `${readerSettings.contentWidth}px`,
    "--reader-font-scale": readerSettings.fontScale,
    "--reader-line-height": readerSettings.lineHeight
  } as CSSProperties;

  useEffect(() => {
    const savedSettings = readSavedReaderSettings();

    if (savedSettings) {
      setReaderSettings(savedSettings);
    }

    setHasLoadedReaderSettings(true);
  }, []);

  useEffect(() => {
    if (!hasLoadedReaderSettings) {
      return;
    }

    window.localStorage.setItem(
      READER_SETTINGS_STORAGE_KEY,
      JSON.stringify(readerSettings)
    );
  }, [hasLoadedReaderSettings, readerSettings]);

  useEffect(() => {
    if (!isSettingsOpen) {
      return;
    }

    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (
        target instanceof Node
        && !settingsRef.current?.contains(target)
      ) {
        setIsSettingsOpen(false);
      }
    };

    window.addEventListener("pointerdown", closeOnPointerDown);
    return () => window.removeEventListener("pointerdown", closeOnPointerDown);
  }, [isSettingsOpen]);

  if (!isScriptureReady) {
    return (
      <section className="reader-empty">
        <p>Loading Scripture...</p>
      </section>
    );
  }

  if (!activeChapter) {
    return (
      <section className="reader-empty">
        <p>This passage could not be found.</p>
        <Link className="context-button" to="/">
          Back to reader
        </Link>
      </section>
    );
  }

  return (
    <section
      className={`reader-page reader-theme-${readerSettings.theme}`}
      aria-labelledby="reader-title"
      style={readerStyle}
    >
      <header className="reader-header">
        <audio
          ref={audioRef}
          onEnded={() => setPlayingAudioUrl(null)}
          onPause={() => setPlayingAudioUrl(null)}
          preload="none"
        />
        <div className="reader-header-title">
          <h1 id="reader-title">
            {activeChapter.book} {activeChapter.chapter}
          </h1>
        </div>
        <div className="reader-header-actions">
          <PassageJump
            filters={filters}
            initialPassageId={passageJumpInitialPassageId}
            isScriptureReady={isScriptureReady}
            label="Jump"
            launcherVariant="inline"
            onJumpToPassage={onJumpToPassage}
            passages={passages}
          />
          <button
            aria-label={
              activeAudioUrl
                ? `${isActiveChapterPlaying ? "Pause" : "Play"} ${activeChapter.book} ${activeChapter.chapter} audio`
                : `Audio unavailable for ${activeChapter.book} ${activeChapter.chapter}`
            }
            className="context-button reader-icon-button"
            disabled={!activeAudioUrl}
            onClick={toggleActiveChapterAudio}
            title={
              activeAudioUrl
                ? `${isActiveChapterPlaying ? "Pause" : "Play"} audio`
                : "Audio unavailable"
            }
            type="button"
          >
            {isActiveChapterPlaying ? "❚❚" : "🔊"}
          </button>
          {onOpenSearch ? (
            <button
              aria-label="Search"
              className="context-button reader-icon-button"
              onClick={onOpenSearch}
              title="Search"
              type="button"
            >
              🔍
            </button>
          ) : (
            <Link
              aria-label="Search"
              className="context-button reader-icon-button"
              title="Search"
              to="/"
            >
              🔍
            </Link>
          )}
          <div className="reader-settings" ref={settingsRef}>
            <button
              aria-expanded={isSettingsOpen}
              aria-haspopup="dialog"
              className="context-button reader-settings-trigger"
              onClick={() => setIsSettingsOpen((isOpen) => !isOpen)}
              type="button"
            >
              Aa
            </button>
            {isSettingsOpen ? (
              <ReaderSettingsPanel
                onChange={setReaderSettings}
                settings={readerSettings}
              />
            ) : null}
          </div>
        </div>
      </header>

      <div className="reader-passages">
        {renderedChapterEntries.map(({ chapter, key: currentChapterKey }) => {
          return (
            <section
              className="reader-chapter"
              data-chapter-key={currentChapterKey}
              key={currentChapterKey}
            >
              <h2 className="reader-chapter-heading">
                {chapter.book} {chapter.chapter}
                <span title="World English Bible">{TRANSLATION_ABBREVIATION}</span>
              </h2>
              <div className="reader-chapter-passages">
                {chapter.passages.map((passage) => {
                  const isSelected = passage.id === selectedPassageId;

                  return (
                    <article
                      className={[
                        "reader-passage",
                        isSelected ? "is-selected" : ""
                      ].filter(Boolean).join(" ")}
                      data-passage-id={passage.id}
                      key={passage.id}
                    >
                      <button
                        aria-expanded={isSelected}
                        className="reader-passage-button"
                        onClick={() => setSelectedPassageId(isSelected ? "" : passage.id)}
                        type="button"
                      >
                        <span className="reader-passage-reference">
                          {passage.reference}
                        </span>
                        <span className="reader-passage-text">
                          {passage.verses.map((verse, index) => (
                            <span className="reader-verse" key={verse.number}>
                              {verse.text}
                              {index < passage.verses.length - 1 ? " " : ""}
                            </span>
                          ))}
                        </span>
                      </button>
                      {isSelected ? (
                        <div className="reader-passage-actions">
                          <Form action="/?index" method="post">
                            <input
                              type="hidden"
                              name="intent"
                              value="similar-passage"
                            />
                            <input
                              type="hidden"
                              name="sourcePassageId"
                              value={passage.id}
                            />
                            <SearchFilterInputs filters={filters} />
                            <button
                              className="context-button"
                              disabled={isSearchingSimilar}
                              type="submit"
                            >
                              {isSearchingSimilar ? "Finding similar" : "Similar passages"}
                            </button>
                          </Form>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}

function ReaderSettingsPanel({
  onChange,
  settings
}: {
  onChange: (settings: ReaderSettings) => void;
  settings: ReaderSettings;
}) {
  return (
    <section
      aria-label="Reader settings"
      className="reader-settings-panel"
      role="dialog"
    >
      <div className="reader-setting-group">
        <span>Preset</span>
        <div className="reader-segmented-control">
          {Object.entries(READER_PRESETS).map(([preset, config]) => (
            <button
              className={settings.preset === preset ? "is-active" : ""}
              key={preset}
              onClick={() => {
                onChange(createPresetReaderSettings(preset as ReaderPreset, settings.theme));
              }}
              type="button"
            >
              {config.label}
            </button>
          ))}
        </div>
      </div>

      <div className="reader-setting-group">
        <span>Theme</span>
        <div className="reader-swatch-grid">
          {Object.entries(READER_THEMES).map(([theme, label]) => (
            <div className="reader-theme-option" key={theme}>
              <button
                aria-label={label}
                className={[
                  "reader-theme-swatch",
                  `reader-theme-swatch-${theme}`,
                  settings.theme === theme ? "is-active" : ""
                ].filter(Boolean).join(" ")}
                onClick={() => {
                  onChange({
                    ...settings,
                    preset: settings.preset,
                    theme: theme as ReaderTheme
                  });
                }}
                title={label}
                type="button"
              />
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>

      <ReaderRange
        label="Text"
        max={1.35}
        min={0.86}
        onChange={(fontScale) => onChange({ ...settings, fontScale, preset: "custom" })}
        step={0.01}
        value={settings.fontScale}
        valueLabel={`${Math.round(settings.fontScale * 100)}%`}
      />
      <ReaderRange
        label="Spacing"
        max={2.08}
        min={1.42}
        onChange={(lineHeight) => onChange({ ...settings, lineHeight, preset: "custom" })}
        step={0.01}
        value={settings.lineHeight}
        valueLabel={settings.lineHeight.toFixed(2)}
      />
      <ReaderRange
        label="Width"
        max={880}
        min={620}
        onChange={(contentWidth) => onChange({ ...settings, contentWidth, preset: "custom" })}
        step={10}
        value={settings.contentWidth}
        valueLabel={`${settings.contentWidth}px`}
      />
    </section>
  );
}

function ReaderRange({
  label,
  max,
  min,
  onChange,
  step,
  value,
  valueLabel
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step: number;
  value: number;
  valueLabel: string;
}) {
  return (
    <label className="reader-range">
      <span>
        {label}
        <strong>{valueLabel}</strong>
      </span>
      <input
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        step={step}
        type="range"
        value={value}
      />
    </label>
  );
}

function readSavedReaderSettings() {
  try {
    const savedSettings = window.localStorage.getItem(READER_SETTINGS_STORAGE_KEY);

    if (!savedSettings) {
      return null;
    }

    const parsedSettings = JSON.parse(savedSettings) as Partial<ReaderSettings>;

    if (!parsedSettings || typeof parsedSettings !== "object") {
      return null;
    }

    return {
      ...DEFAULT_READER_SETTINGS,
      contentWidth: clampNumber(parsedSettings.contentWidth, 620, 880),
      fontScale: clampNumber(parsedSettings.fontScale, 0.86, 1.35),
      lineHeight: clampNumber(parsedSettings.lineHeight, 1.42, 2.08),
      preset: isReaderPreset(parsedSettings.preset)
        ? parsedSettings.preset
        : parsedSettings.preset === "custom"
          ? "custom"
          : DEFAULT_READER_SETTINGS.preset,
      theme: isReaderTheme(parsedSettings.theme)
        ? parsedSettings.theme
        : DEFAULT_READER_SETTINGS.theme
    };
  } catch {
    return null;
  }
}

function getInitialRenderedRange(initialChapterIndex: number, chapterCount: number) {
  if (chapterCount <= 0) {
    return {
      endIndex: -1,
      startIndex: 0
    };
  }

  const safeInitialChapterIndex = initialChapterIndex >= 0 ? initialChapterIndex : 0;

  return {
    endIndex: Math.min(
      chapterCount - 1,
      safeInitialChapterIndex + INITIAL_NEXT_CHAPTERS
    ),
    startIndex: Math.max(
      0,
      safeInitialChapterIndex - INITIAL_PREVIOUS_CHAPTERS
    )
  };
}

function findRenderedPassageElement(passageId: string) {
  return [...document.querySelectorAll<HTMLElement>(".reader-passage")]
    .find((element) => element.dataset.passageId === passageId);
}

function findElementAtReadingAnchor(elements: HTMLElement[]) {
  const anchorY = getReadingAnchorY();

  return elements.find((element) => {
    const rect = element.getBoundingClientRect();
    return rect.top <= anchorY && rect.bottom >= anchorY;
  }) ?? elements.find((element) => element.getBoundingClientRect().top > anchorY)
    ?? elements[elements.length - 1];
}

function getReadingAnchorY() {
  return Math.max(
    HEADER_SCROLL_OFFSET + 40,
    Math.min(window.innerHeight * READING_ANCHOR_RATIO, MIN_READING_ANCHOR_OFFSET)
  );
}

function createPresetReaderSettings(
  preset: ReaderPreset,
  theme: ReaderTheme
): ReaderSettings {
  const { contentWidth, fontScale, lineHeight } = READER_PRESETS[preset];

  return {
    contentWidth,
    fontScale,
    lineHeight,
    preset,
    theme
  };
}

function clampNumber(value: unknown, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

function isReaderPreset(value: unknown): value is ReaderPreset {
  return typeof value === "string" && value in READER_PRESETS;
}

function isReaderTheme(value: unknown): value is ReaderTheme {
  return typeof value === "string" && value in READER_THEMES;
}

function SearchFilterInputs({ filters }: { filters: StoredFilters }) {
  return (
    <>
      {filters.canon ? <input type="hidden" name="canon" value={filters.canon} /> : null}
      {filters.matchCount ? (
        <input type="hidden" name="matchCount" value={filters.matchCount} />
      ) : null}
      {filters.books?.map((book) => (
        <input key={book} type="hidden" name="books" value={book} />
      ))}
    </>
  );
}
