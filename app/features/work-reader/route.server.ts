import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  json,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "@remix-run/node";
import { handleSearchRequest } from "~/features/search/search-request.server";
import { getEarlyChristianAuthors } from "~/lib/r-cross-cannon.server";
import { getClientIp, rateLimit } from "~/lib/rate-limit.server";
import { getScriptureCacheInfo } from "~/lib/scripture-cache.server";
import type {
  BookIndex,
  PreviewManifest,
} from "~/features/early-christian-reader/types";
import { WORK_COLLECTIONS, type WorkCollectionId } from "./collections";

export async function readWorkIndex(collectionId: WorkCollectionId) {
  const collection = WORK_COLLECTIONS[collectionId];
  const manifest: PreviewManifest & { version?: string } = JSON.parse(
    await readFile(
      path.join(process.cwd(), "public", collection.manifestUrl),
      "utf8"
    )
  );
  const bookIndex: BookIndex = JSON.parse(
    await readFile(
      path.join(process.cwd(), "public", manifest.bookIndexPath),
      "utf8"
    )
  );
  return { manifest, bookIndex };
}

export async function workReaderLoader(
  { request }: LoaderFunctionArgs,
  collectionId: WorkCollectionId
) {
  const collection = WORK_COLLECTIONS[collectionId];
  const [{ manifest, bookIndex }, scriptureCache] = await Promise.all([
    readWorkIndex(collectionId),
    getScriptureCacheInfo(),
  ]);
  const url = new URL(request.url);
  const chapterId = url.searchParams.get("chapter") ?? "";
  const initialChapterId = bookIndex.books.some((work) =>
    work.chapters.some((chapter) => chapter.id === chapterId)
  )
    ? chapterId
    : "";
  const [authorOptions, classicAuthors] = await Promise.all([
    getEarlyChristianAuthors().catch((): string[] => []),
    getEarlyChristianAuthors("christian-classics").catch((): string[] => []),
  ]);
  return json({
    collectionId,
    authorOptions,
    classicAuthors,
    initialChapterId,
    initialPassageRange: initialChapterId
      ? url.searchParams.get("passage") ?? ""
      : "",
    manifestUrl: collection.manifestUrl,
    previewAssetVersion: manifest.version ?? collection.assetVersion,
    scriptureCacheKey: scriptureCache.version,
    scriptureCacheUrl: scriptureCache.url,
  });
}

export type WorkReaderData = Awaited<
  ReturnType<typeof workReaderLoader>
> extends { json(): Promise<infer T> }
  ? T
  : never;

export async function workReaderAction(
  { request }: ActionFunctionArgs,
  collectionId: WorkCollectionId
) {
  const limit = rateLimit(getClientIp(request));
  if (!limit.allowed)
    return json(
      {
        error: "Rate limit reached. Try again in a moment.",
        retryAfterSeconds: limit.retryAfterSeconds,
      },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      }
    );
  return handleSearchRequest(await request.formData(), collectionId);
}
