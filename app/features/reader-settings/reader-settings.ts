import type { CSSProperties } from "react";

import { isRecord, parseJson } from "~/lib/json";

export const READER_SETTINGS_STORAGE_KEY = "cross-cannon:reader-settings:v1";

export const READER_PRESETS = {
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

export const READER_THEMES = {
  paper: "Paper",
  sepia: "Sepia",
  dark: "Dark",
  contrast: "Contrast"
} as const;

export type ReaderPreset = keyof typeof READER_PRESETS;
export type ReaderTheme = keyof typeof READER_THEMES;

export type ReaderSettings = {
  contentWidth: number;
  fontScale: number;
  lineHeight: number;
  preset: ReaderPreset | "custom";
  theme: ReaderTheme;
};

export const DEFAULT_READER_SETTINGS = createPresetReaderSettings("default", "paper");

export function createPresetReaderSettings(
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

export function readSavedReaderSettings() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const savedSettings = window.localStorage.getItem(READER_SETTINGS_STORAGE_KEY);

    if (!savedSettings) {
      return null;
    }

    const parsedSettings = parseJson(savedSettings);

    if (!isRecord(parsedSettings)) {
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

export function readSavedReaderTheme(): ReaderTheme {
  return readSavedReaderSettings()?.theme ?? "paper";
}

export function readerSettingsStyle(settings: Pick<
  ReaderSettings,
  "contentWidth" | "fontScale" | "lineHeight"
>) {
  return {
    "--reader-content-width": `${settings.contentWidth}px`,
    "--reader-font-scale": settings.fontScale,
    "--reader-line-height": settings.lineHeight
  } as CSSProperties;
}

export function isReaderTheme(value: unknown): value is ReaderTheme {
  return typeof value === "string" && value in READER_THEMES;
}

export function isReaderPreset(value: unknown): value is ReaderPreset {
  return typeof value === "string" && value in READER_PRESETS;
}

function clampNumber(value: unknown, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}
