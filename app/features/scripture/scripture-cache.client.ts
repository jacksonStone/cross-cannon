import type { BrowserPassage } from "~/lib/scripture-cache.server";

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

      return response.json() as Promise<{ passages: BrowserPassage[] }>;
    })
    .then((data) => {
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
