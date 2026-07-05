import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useRef,
  useState
} from "react";

import {
  DEFAULT_READER_SETTINGS,
  READER_PRESETS,
  READER_SETTINGS_STORAGE_KEY,
  READER_THEMES,
  type ReaderPreset,
  type ReaderSettings,
  type ReaderTheme,
  createPresetReaderSettings,
  readSavedReaderSettings
} from "~/features/reader-settings/reader-settings";
import {
  useEscapeDismiss,
  useOutsideClickDismiss
} from "~/lib/use-dialog-dismiss";

type ReaderSettingsStateOptions = {
  onThemeChange?: (theme: ReaderTheme) => void;
};

export function useStoredReaderSettings({
  onThemeChange
}: ReaderSettingsStateOptions = {}) {
  const [readerSettings, setReaderSettings] = useState(DEFAULT_READER_SETTINGS);
  const [hasLoadedReaderSettings, setHasLoadedReaderSettings] = useState(false);

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
    if (!hasLoadedReaderSettings) {
      return;
    }

    onThemeChange?.(readerSettings.theme);
  }, [hasLoadedReaderSettings, onThemeChange, readerSettings.theme]);

  return {
    readerSettings,
    setReaderSettings
  };
}

export function ReaderTools({
  children,
  isOpen,
  onClose,
  onOpen
}: {
  children: ReactNode;
  isOpen: boolean;
  onClose: () => void;
  onOpen: () => void;
}) {
  return !isOpen ? (
    <button
      aria-expanded={false}
      aria-label="Open reader tools"
      className="context-button reader-icon-button reader-tools-trigger"
      onClick={onOpen}
      title="Open reader tools"
      type="button"
    >
      ⋮
    </button>
  ) : (
    <div className="reader-header-actions">
      <button
        aria-label="Close reader tools"
        className="context-button reader-icon-button reader-tools-close"
        onClick={onClose}
        title="Close reader tools"
        type="button"
      >
        ×
      </button>
      {children}
    </div>
  );
}

export function ReaderSettingsControl({
  onChange,
  settings
}: {
  onChange: Dispatch<SetStateAction<ReaderSettings>>;
  settings: ReaderSettings;
}) {
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const closeSettings = () => setIsSettingsOpen(false);

  useEscapeDismiss({
    isOpen: isSettingsOpen,
    onDismiss: closeSettings
  });
  useOutsideClickDismiss({
    ignoreSelector: ".reader-header-actions",
    isOpen: isSettingsOpen,
    onDismiss: closeSettings,
    ref: settingsRef
  });

  return (
    <div className="reader-settings" ref={settingsRef}>
      <button
        aria-label="Reader text settings"
        aria-expanded={isSettingsOpen}
        aria-haspopup="dialog"
        className="context-button reader-settings-trigger"
        onClick={() => setIsSettingsOpen((isOpen) => !isOpen)}
        title="Reader text settings"
        type="button"
      >
        Aa
      </button>
      {isSettingsOpen ? (
        <ReaderSettingsPanel
          onChange={onChange}
          settings={settings}
        />
      ) : null}
    </div>
  );
}

export function ReaderPassageArticle({
  actions,
  dataAttributes,
  isSelected,
  onToggle,
  reference,
  text
}: {
  actions?: ReactNode;
  dataAttributes?: Record<string, string | number | undefined>;
  isSelected: boolean;
  onToggle: () => void;
  reference: ReactNode;
  text: ReactNode;
}) {
  return (
    <article
      className={[
        "reader-passage",
        isSelected ? "is-selected" : ""
      ].filter(Boolean).join(" ")}
      {...dataAttributes}
    >
      <button
        aria-expanded={isSelected}
        className="reader-passage-button"
        onClick={onToggle}
        type="button"
      >
        <span className="reader-passage-reference">
          {reference}
        </span>
        <span className="reader-passage-text">
          {text}
        </span>
      </button>
      {isSelected && actions ? (
        <div className="reader-passage-actions">
          {actions}
        </div>
      ) : null}
    </article>
  );
}

function ReaderSettingsPanel({
  onChange,
  settings
}: {
  onChange: Dispatch<SetStateAction<ReaderSettings>>;
  settings: ReaderSettings;
}) {
  return (
    <section
      aria-label="Reader settings"
      className="reader-settings-panel"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onTouchMove={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
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
