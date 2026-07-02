import type { BrowserPassage } from "~/lib/scripture-cache.server";

const scriptureCacheLoads = new Map<string, Promise<BrowserPassage[]>>();
const scriptureCacheData = new Map<string, BrowserPassage[]>();

export function getLoadedScriptureCache(scriptureCacheUrl: string) {
  return scriptureCacheData.get(scriptureCacheUrl) ?? null;
}

export function getScriptureCacheLoad(scriptureCacheUrl: string) {
  return scriptureCacheLoads.get(scriptureCacheUrl) ?? null;
}

export function rememberLoadedScriptureCache(
  scriptureCacheUrl: string,
  passages: BrowserPassage[]
) {
  scriptureCacheData.set(scriptureCacheUrl, passages);
}

export function rememberScriptureCacheLoad(
  scriptureCacheUrl: string,
  load: Promise<BrowserPassage[]>
) {
  scriptureCacheLoads.set(scriptureCacheUrl, load);
}

export function forgetScriptureCacheLoad(scriptureCacheUrl: string) {
  scriptureCacheLoads.delete(scriptureCacheUrl);
}
