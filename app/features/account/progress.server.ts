import type { DatabaseSync } from "node:sqlite";
import { parseLocation, type Progress, type SavedProgress } from "./progress";
import type { ReaderLocation } from "../reader-position/reader-position";

export function readProgress(database: DatabaseSync, userId: string): Progress {
  const result: Progress = {};
  for (const row of database.prepare("SELECT location, revision FROM reader_progress WHERE user_id = ?").all(userId)) {
    const location = parseLocation(JSON.parse(String(row.location)));
    if (location) result[location.corpus] = { location, revision: Number(row.revision) };
  }
  return result;
}

// Compare-and-swap makes offline writes safe: a stale device must resolve the conflict.
export function saveProgress(database: DatabaseSync, userId: string, location: ReaderLocation, revision: number):
  { saved: true; progress: SavedProgress } | { saved: false; progress: SavedProgress | null } {
  // Only revision zero can create a new slot; all later writes must match its revision.
  const updated = revision === 0
    ? database.prepare(`INSERT INTO reader_progress (user_id, corpus, location, revision)
        VALUES (?, ?, ?, 1) ON CONFLICT(user_id, corpus) DO NOTHING RETURNING revision`)
      .get(userId, location.corpus, JSON.stringify(location))
    : database.prepare(`UPDATE reader_progress SET location = ?, revision = revision + 1
        WHERE user_id = ? AND corpus = ? AND revision = ? RETURNING revision`)
      .get(JSON.stringify(location), userId, location.corpus, revision);
  if (updated) return { saved: true, progress: { location, revision: Number(updated.revision) } };
  return { saved: false, progress: readProgress(database, userId)[location.corpus] ?? null };
}
