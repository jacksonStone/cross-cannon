import type { BrowserPassage } from "~/lib/scripture-cache.server";
import { isRecord, isUnknownArray, readJsonResponse } from "~/lib/json";

import {
  forgetScriptureCacheLoad,
  getLoadedScriptureCache,
  getScriptureCacheLoad,
  rememberLoadedScriptureCache,
  rememberScriptureCacheLoad
} from "./scripture-cache-store";

export function loadScriptureCache(scriptureCacheUrl: string) {
  const cachedPassages = getLoadedScriptureCache(scriptureCacheUrl);

  if (cachedPassages) {
    return Promise.resolve(cachedPassages);
  }

  const existingLoad = getScriptureCacheLoad(scriptureCacheUrl);

  if (existingLoad) {
    return existingLoad;
  }

  const load = fetch(scriptureCacheUrl)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to load scripture cache: ${response.status}`);
      }

      return readJsonResponse(response);
    })
    .then((data) => {
      if (!isScriptureCachePayload(data)) {
        throw new Error("Scripture cache response was not valid.");
      }

      rememberLoadedScriptureCache(scriptureCacheUrl, data.passages);
      return data.passages;
    })
    .catch((error) => {
      forgetScriptureCacheLoad(scriptureCacheUrl);
      throw error;
    });

  rememberScriptureCacheLoad(scriptureCacheUrl, load);
  return load;
}

function isScriptureCachePayload(value: unknown): value is { passages: BrowserPassage[] } {
  return isRecord(value)
    && isUnknownArray(value.passages)
    && value.passages.every(isBrowserPassage);
}

function isBrowserPassage(value: unknown): value is BrowserPassage {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.reference === "string"
    && typeof value.text === "string"
    && value.type === "paragraph"
    && isUnknownArray(value.verses);
}
