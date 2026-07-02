export const EARLY_CHRISTIAN_MANIFEST_URL = "/church-fathers-preview/manifest.json";
export const EARLY_CHRISTIAN_PREVIEW_ASSET_VERSION = "early-christian-preview-20260702a";
export const EARLY_CHRISTIAN_READER_POSITION_STORAGE_KEY =
  "cross-cannon:church-fathers-position:v1";
export const FIRST_FATHERS_WORK_ID = "anf09:xii.iv";

type PreviewManifestLike = {
  bookIndexPath: string;
};

type BookIndexLike = {
  books: Array<{
    chapters: Array<{
      assetPath: string;
      id: string;
    }>;
    id: string;
  }>;
};

const previewJsonData = new Map<string, unknown>();
const previewJsonLoads = new Map<string, Promise<unknown>>();

export function getCachedPreviewJson<T>(path: string, version: string) {
  return previewJsonData.get(previewCacheKey(path, version)) as T | undefined;
}

export function getCachedPreviewJsonEntries<T>(version: string, pathPrefix: string) {
  const entries: T[] = [];
  const versionPrefix = `${version}:`;

  for (const [key, value] of previewJsonData) {
    if (key.startsWith(versionPrefix) && key.slice(versionPrefix.length).startsWith(pathPrefix)) {
      entries.push(value as T);
    }
  }

  return entries;
}

export function rememberCachedPreviewJson<T>(path: string, version: string, data: T) {
  previewJsonData.set(previewCacheKey(path, version), data);
}

export function loadPreviewJson<T>(path: string, version: string) {
  const cacheKey = previewCacheKey(path, version);
  const cached = previewJsonData.get(cacheKey) as T | undefined;

  if (cached) {
    return Promise.resolve(cached);
  }

  const existingLoad = previewJsonLoads.get(cacheKey) as Promise<T> | undefined;

  if (existingLoad) {
    return existingLoad;
  }

  const load = fetch(versionedPreviewUrl(path, version), { cache: "no-store" })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to load preview asset: ${response.status}`);
      }

      return response.json() as Promise<T>;
    })
    .then((data) => {
      rememberCachedPreviewJson(path, version, data);
      return data;
    })
    .catch((error) => {
      previewJsonLoads.delete(cacheKey);
      throw error;
    });

  previewJsonLoads.set(cacheKey, load);
  return load;
}

export function prefetchEarlyChristianPreview() {
  if (typeof window === "undefined") {
    return;
  }

  void loadPreviewJson<PreviewManifestLike>(
    EARLY_CHRISTIAN_MANIFEST_URL,
    EARLY_CHRISTIAN_PREVIEW_ASSET_VERSION
  )
    .then((manifest) => loadPreviewJson<BookIndexLike>(
      manifest.bookIndexPath,
      EARLY_CHRISTIAN_PREVIEW_ASSET_VERSION
    ))
    .then((bookIndex) => {
      const chapter = findPreferredPreviewChapter(bookIndex);

      if (chapter) {
        return loadPreviewJson(chapter.assetPath, EARLY_CHRISTIAN_PREVIEW_ASSET_VERSION);
      }

      return null;
    })
    .catch(() => undefined);
}

export function versionedPreviewUrl(path: string, version: string) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}v=${encodeURIComponent(version)}`;
}

export function previewCacheKey(path: string, version: string) {
  return `${version}:${path}`;
}

function findPreferredPreviewChapter(bookIndex: BookIndexLike) {
  const rememberedChapterId = readRememberedEarlyChristianChapterId();
  const rememberedChapter = rememberedChapterId
    ? findPreviewChapter(bookIndex, rememberedChapterId)
    : undefined;
  const firstFathersChapter = bookIndex.books
    .find((book) => book.id === FIRST_FATHERS_WORK_ID)
    ?.chapters[0];

  return rememberedChapter ?? firstFathersChapter ?? bookIndex.books[0]?.chapters[0];
}

function findPreviewChapter(bookIndex: BookIndexLike, chapterId: string) {
  for (const book of bookIndex.books) {
    const chapter = book.chapters.find((entry) => entry.id === chapterId);

    if (chapter) {
      return chapter;
    }
  }

  return undefined;
}

function readRememberedEarlyChristianChapterId() {
  try {
    return window.localStorage.getItem(EARLY_CHRISTIAN_READER_POSITION_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}
