import type { BrowserPassage } from "~/lib/scripture-cache.server";

const scriptureCacheLoads = new Map<string, Promise<BrowserPassage[]>>();
const scriptureCacheData = new Map<string, BrowserPassage[]>();

export function loadScriptureCache(scriptureCacheUrl: string) {
  const cachedPassages = scriptureCacheData.get(scriptureCacheUrl);

  if (cachedPassages) {
    return Promise.resolve(cachedPassages);
  }

  const existingLoad = scriptureCacheLoads.get(scriptureCacheUrl);

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
      scriptureCacheData.set(scriptureCacheUrl, data.passages);
      return data.passages;
    })
    .catch((error) => {
      scriptureCacheLoads.delete(scriptureCacheUrl);
      throw error;
    });

  scriptureCacheLoads.set(scriptureCacheUrl, load);
  return load;
}
