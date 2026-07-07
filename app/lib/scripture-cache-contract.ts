import { isRecord, isUnknownArray } from "./json";

export type BrowserPassage = {
  audioUrl?: string;
  id: string;
  reference: string;
  text: string;
  type: "paragraph";
  verses: BrowserVerse[];
};

export type BrowserVerse = {
  number: number;
  text: string;
};

export type ScriptureCachePayload = {
  passages: BrowserPassage[];
};

export function isScriptureCachePayload(
  value: unknown
): value is ScriptureCachePayload {
  return isRecord(value)
    && isUnknownArray(value.passages)
    && value.passages.every(isBrowserPassage);
}

export function isBrowserPassage(value: unknown): value is BrowserPassage {
  return isRecord(value)
    && (value.audioUrl === undefined || typeof value.audioUrl === "string")
    && typeof value.id === "string"
    && typeof value.reference === "string"
    && typeof value.text === "string"
    && value.type === "paragraph"
    && isUnknownArray(value.verses)
    && value.verses.every(isBrowserVerse);
}

export function isBrowserVerse(value: unknown): value is BrowserVerse {
  return isRecord(value)
    && Number.isInteger(value.number)
    && typeof value.text === "string";
}
