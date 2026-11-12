import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getMigrations } from "better-auth/db/migration";

// This runs on production after dev dependencies have been pruned. Keep it plain JS.
if (process.env.CROSS_CANNON_UPDATE_DB !== "1") throw new Error("Use npm run update-db:accounts.");
const path = resolve(process.env.ACCOUNTS_DATABASE_PATH ?? "storage/accounts.db");
mkdirSync(dirname(path), { recursive: true });
const database = new DatabaseSync(path);
try {
  database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  // No plugins or custom auth fields: Better Auth's core schema is sufficient.
  await (await getMigrations({ database })).runMigrations();
  database.exec(readFileSync(new URL("./accounts-schema.sql", import.meta.url), "utf8"));
  console.log("Account database is ready. Scripture indexes were not changed.");
} finally {
  database.close();
}
