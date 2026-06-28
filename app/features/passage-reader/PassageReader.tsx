import {
  type CSSProperties,
  useEffect,
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
const CHAPTER_WINDOW_RADIUS = 6;
const ESTIMATED_CHAPTER_HEIGHT = 820;
const READER_SETTINGS_STORAGE_KEY = "cross-cannon:reader-settings:v1";

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
  const hasScrolledToInitialPassageRef = useRef(false);
  const chapterHeightByKeyRef = useRef(new Map<string, number>());
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const [, setMeasuredChapterVersion] = useState(0);
  const [readerSettings, setReaderSettings] = useState(DEFAULT_READER_SETTINGS);
  const [hasLoadedReaderSettings, setHasLoadedReaderSettings] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
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
  const activeChapterIndex = activeChapterKey
    ? renderedChapterKeys.indexOf(activeChapterKey)
    : -1;
  const safeActiveChapterIndex = activeChapterIndex >= 0 ? activeChapterIndex : 0;
  const windowStartIndex = Math.max(
    0,
    safeActiveChapterIndex - CHAPTER_WINDOW_RADIUS
  );
  const windowEndIndex = Math.min(
    orderedChapterEntries.length,
    safeActiveChapterIndex + CHAPTER_WINDOW_RADIUS + 1
  );
  const renderedChapterEntriesInWindow = orderedChapterEntries.slice(
    windowStartIndex,
    windowEndIndex
  );
  const renderedWindowKey = renderedChapterEntriesInWindow
    .map((entry) => entry.key)
    .join("|");
  const topSpacerHeight = sumChapterHeights(
    orderedChapterEntries,
    0,
    windowStartIndex,
    chapterHeightByKeyRef.current
  );
  const bottomSpacerHeight = sumChapterHeights(
    orderedChapterEntries,
    windowEndIndex,
    orderedChapterEntries.length,
    chapterHeightByKeyRef.current
  );
  const passageJumpInitialPassageId =
    activeChapter?.passages[0]?.id ?? initialPassageId;

  useEffect(() => {
    setActiveChapterKey(initialChapterKey);
    setSelectedPassageId("");
    hasScrolledToInitialPassageRef.current = false;
  }, [initialChapterKey, initialPassageId]);

  useEffect(() => {
    if (!activeChapterKey || hasScrolledToInitialPassageRef.current) {
      return;
    }

    window.requestAnimationFrame(() => {
      const targetPassage = [
        ...document.querySelectorAll<HTMLElement>(".reader-passage")
      ].find((element) => element.dataset.passageId === initialPassageId);

      if (!targetPassage) {
        return;
      }

      targetPassage.scrollIntoView({
        block: "start",
        behavior: "auto"
      });
      hasScrolledToInitialPassageRef.current = true;
    });
  }, [activeChapterKey, initialPassageId]);

  useEffect(() => {
    if (orderedChapterEntries.length === 0) {
      return;
    }

    let frame = 0;

    const updateLocation = () => {
      frame = 0;
      const passageElements = [
        ...document.querySelectorAll<HTMLElement>(".reader-passage")
      ];
      const currentPassage = passageElements.find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.bottom > 120;
      }) ?? passageElements[0];
      const passageId = currentPassage?.dataset.passageId;

      if (passageId) {
        onLocationChange?.(passageId);
      }

      const chapterElements = [
        ...document.querySelectorAll<HTMLElement>(".reader-chapter")
      ];
      const firstChapter = chapterElements[0];
      const lastChapter = chapterElements[chapterElements.length - 1];
      const firstChapterRect = firstChapter?.getBoundingClientRect();
      const lastChapterRect = lastChapter?.getBoundingClientRect();
      const currentChapter = [...chapterElements]
        .reverse()
        .find((element) => element.getBoundingClientRect().top <= HEADER_SCROLL_OFFSET)
        ?? chapterElements.find((element) => {
          const rect = element.getBoundingClientRect();
          return rect.bottom > HEADER_SCROLL_OFFSET;
        });
      let currentChapterKey = currentChapter?.dataset.chapterKey;

      if (
        lastChapterRect
        && lastChapterRect.bottom < HEADER_SCROLL_OFFSET
        && windowEndIndex < renderedChapterKeys.length
      ) {
        currentChapterKey = renderedChapterKeys[windowEndIndex];
      } else if (
        firstChapterRect
        && firstChapterRect.top > HEADER_SCROLL_OFFSET
        && windowStartIndex > 0
      ) {
        currentChapterKey = renderedChapterKeys[windowStartIndex - 1];
      }

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
    orderedChapterEntries.length,
    renderedChapterKeys,
    windowEndIndex,
    windowStartIndex
  ]);

  useEffect(() => {
    let didMeasure = false;

    document.querySelectorAll<HTMLElement>(".reader-chapter").forEach((element) => {
      const key = element.dataset.chapterKey;

      if (!key) {
        return;
      }

      const measuredHeight = element.getBoundingClientRect().height;
      const previousHeight = chapterHeightByKeyRef.current.get(key);

      if (
        measuredHeight > 0
        && (!previousHeight || Math.abs(previousHeight - measuredHeight) > 1)
      ) {
        chapterHeightByKeyRef.current.set(key, measuredHeight);
        didMeasure = true;
      }
    });

    if (didMeasure) {
      setMeasuredChapterVersion((version) => version + 1);
    }
  }, [renderedWindowKey, selectedPassageId]);

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
          {onOpenSearch ? (
            <button className="context-button" onClick={onOpenSearch} type="button">
              Search
            </button>
          ) : (
            <Link className="context-button" to="/">
              Search
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
        {topSpacerHeight > 0 ? (
          <div
            aria-hidden="true"
            className="reader-chapter-spacer"
            style={{ height: topSpacerHeight }}
          />
        ) : null}
        {renderedChapterEntriesInWindow.map(({ chapter, key: currentChapterKey }) => {
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
        {bottomSpacerHeight > 0 ? (
          <div
            aria-hidden="true"
            className="reader-chapter-spacer"
            style={{ height: bottomSpacerHeight }}
          />
        ) : null}
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

function sumChapterHeights(
  entries: Array<{ key: string }>,
  startIndex: number,
  endIndex: number,
  measuredHeights: Map<string, number>
) {
  return entries
    .slice(startIndex, endIndex)
    .reduce(
      (sum, entry) => sum + (measuredHeights.get(entry.key) ?? ESTIMATED_CHAPTER_HEIGHT),
      0
    );
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
