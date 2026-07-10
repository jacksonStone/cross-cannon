export const OFFLINE_META_CACHE = "cross-canon-offline-meta-v1";
export const OFFLINE_WORK_REGISTRY_URL = "/__cross-canon/work-registry";
export const GENERAL_CONTENT_CACHE = "cross-canon-content-v2";
export const WORK_CACHE_PREFIX = "cross-canon-work-v1-";

const LEGACY_CONTENT_CACHE = "cross-canon-content-v1";
const LEGACY_STORAGE_KEY = "cross-canon:offline-early-christian-works:v1";

export type PendingOfflineWorkGeneration = {
  cacheName: string;
  chapterUrls: string[];
  complete?: boolean;
  completedAt?: number;
  version: string;
};

export type OfflineWorkRecord = {
  cacheName: string;
  chapterUrls: string[];
  complete: boolean;
  completedAt: number;
  pending?: PendingOfflineWorkGeneration;
  version: string;
};

export type OfflineWorkRecords = Record<string, OfflineWorkRecord>;

export async function readOfflineWorkRecords(): Promise<OfflineWorkRecords> {
  if (typeof caches === "undefined") {
    return {};
  }

  const meta = await caches.open(OFFLINE_META_CACHE);
  const response = await meta.match(registryUrl());

  if (response) {
    return parseOfflineWorkRecords(await response.json());
  }

  return migrateLegacyRecords();
}

export async function writeOfflineWorkRecords(records: OfflineWorkRecords) {
  const meta = await caches.open(OFFLINE_META_CACHE);
  await meta.put(
    registryUrl(),
    new Response(JSON.stringify(records), {
      headers: { "Content-Type": "application/json" },
    })
  );
}

export function workGenerationCacheName(workId: string, version: string) {
  return `${WORK_CACHE_PREFIX}${sanitizeCachePart(workId)}-${sanitizeCachePart(
    version
  )}`;
}

export async function deleteWorkGeneration(cacheName: string) {
  if (cacheName) {
    await caches.delete(cacheName);
  }
}

export async function cleanupInactiveWorkGenerations(
  records: OfflineWorkRecords
) {
  const activeNames = new Set(
    Object.values(records).flatMap((record) => [
      record.cacheName,
      record.pending?.cacheName ?? "",
    ])
  );
  const cacheNames = await caches.keys();

  await Promise.all(
    cacheNames
      .filter(
        (name) => name.startsWith(WORK_CACHE_PREFIX) && !activeNames.has(name)
      )
      .map((name) => caches.delete(name))
  );
}

export function promoteCompletedWorkGenerations(
  records: OfflineWorkRecords
): OfflineWorkRecords {
  return Object.fromEntries(
    Object.entries(records).map(([workId, record]) => {
      const pending = record.pending;

      if (!pending?.complete) {
        return [workId, record];
      }

      return [
        workId,
        {
          cacheName: pending.cacheName,
          chapterUrls: pending.chapterUrls,
          complete: true,
          completedAt: pending.completedAt ?? record.completedAt,
          version: pending.version,
        },
      ];
    })
  );
}

function parseOfflineWorkRecords(value: unknown): OfflineWorkRecords {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([workId, record]) =>
      isOfflineWorkRecord(record) ? [[workId, record]] : []
    )
  );
}

function isOfflineWorkRecord(value: unknown): value is OfflineWorkRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Partial<OfflineWorkRecord>;
  return (
    typeof record.cacheName === "string" &&
    record.cacheName.startsWith(WORK_CACHE_PREFIX) &&
    Array.isArray(record.chapterUrls) &&
    record.chapterUrls.every((url) => typeof url === "string") &&
    typeof record.complete === "boolean" &&
    typeof record.completedAt === "number" &&
    typeof record.version === "string" &&
    (record.pending === undefined || isPendingGeneration(record.pending))
  );
}

function isPendingGeneration(
  value: unknown
): value is PendingOfflineWorkGeneration {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const pending = value as Partial<PendingOfflineWorkGeneration>;
  return (
    typeof pending.cacheName === "string" &&
    pending.cacheName.startsWith(WORK_CACHE_PREFIX) &&
    Array.isArray(pending.chapterUrls) &&
    pending.chapterUrls.every((url) => typeof url === "string") &&
    (pending.complete === undefined || typeof pending.complete === "boolean") &&
    (pending.completedAt === undefined ||
      typeof pending.completedAt === "number") &&
    typeof pending.version === "string"
  );
}

async function migrateLegacyRecords() {
  const legacyRecords = readLegacyRecords();
  const migrated: OfflineWorkRecords = {};
  const legacyCache = await caches.open(LEGACY_CONTENT_CACHE);

  for (const [workId, record] of Object.entries(legacyRecords)) {
    const cacheName = workGenerationCacheName(workId, record.version);
    const cache = await caches.open(cacheName);

    for (const url of record.chapterUrls) {
      const response = await legacyCache.match(url);

      if (response) {
        await cache.put(url, response);
      }
    }

    migrated[workId] = {
      cacheName,
      chapterUrls: record.chapterUrls,
      complete: record.complete !== false,
      completedAt: record.completedAt,
      version: record.version,
    };
  }

  await writeOfflineWorkRecords(migrated);
  window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  return migrated;
}

function readLegacyRecords() {
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(LEGACY_STORAGE_KEY) ?? "{}"
    );

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(value).flatMap(([workId, record]) => {
        if (!record || typeof record !== "object" || Array.isArray(record)) {
          return [];
        }

        const typedRecord = record as {
          chapterUrls?: unknown;
          complete?: unknown;
          completedAt?: unknown;
          version?: unknown;
        };

        if (
          !Array.isArray(typedRecord.chapterUrls) ||
          !typedRecord.chapterUrls.every((url) => typeof url === "string") ||
          typeof typedRecord.completedAt !== "number" ||
          typeof typedRecord.version !== "string"
        ) {
          return [];
        }

        return [
          [
            workId,
            {
              chapterUrls: typedRecord.chapterUrls as string[],
              complete: typedRecord.complete,
              completedAt: typedRecord.completedAt,
              version: typedRecord.version,
            },
          ],
        ];
      })
    );
  } catch {
    return {};
  }
}

function registryUrl() {
  return new URL(OFFLINE_WORK_REGISTRY_URL, window.location.origin).href;
}

function sanitizeCachePart(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 100);
}
