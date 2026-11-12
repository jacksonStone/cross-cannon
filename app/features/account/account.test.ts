import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { after, before } from "node:test";
import { runInNewContext } from "node:vm";
import { getMigrations } from "better-auth/db/migration";
import { accountsDatabasePath, authOptions, getAccountsDatabase, getAuth } from "./auth.server";
import { parseLocation, type Progress } from "./progress";
import { readProgress, saveProgress } from "./progress.server";
import { loader, action } from "../../routes/api.account";
import { action as authAction, loader as authLoader } from "../../routes/api.auth.$";
import type { ReaderLocation } from "../reader-position/reader-position";

const origin = "http://127.0.0.1:3005";
const directory = mkdtempSync(join(tmpdir(), "cross-canon-accounts-"));
const secret = "test-only-account-secret-with-at-least-32-characters";
const location: ReaderLocation = { version: 2, corpus: "scripture", chapterKey: "John\t3", passageKey: "John:3:16" };
let cookie = "";
let userId = "";

before(async () => {
  process.env.ACCOUNTS_DATABASE_PATH = join(directory, "accounts.db");
  process.env.BETTER_AUTH_URL = origin;
  process.env.BETTER_AUTH_SECRET = secret;
  process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "test-only-google-secret";
  const database = new DatabaseSync(accountsDatabasePath());
  await (await getMigrations(authOptions(database))).runMigrations();
  database.exec(readFileSync("scripts/accounts-schema.sql", "utf8"));
  database.close();
  const context = await getAuth().$context;
  const user = await context.internalAdapter.createUser({ name: "Reader", email: "reader@example.com", emailVerified: true }, { method: "oauth" });
  userId = user.id;
  const session = await context.internalAdapter.createSession(user.id, false);
  assert.ok(session);
  const signed = `${session.token}.${createHmac("sha256", secret).update(session.token).digest("base64")}`;
  cookie = `${context.authCookies.sessionToken.name}=${encodeURIComponent(signed)}`;
});

after(() => {
  getAccountsDatabase().close();
  rmSync(directory, { recursive: true, force: true });
});

function request(path: string, options: RequestInit = {}) {
  return new Request(origin + path, options);
}

test("the explicit database migration works without a TypeScript runner and can be repeated", () => {
  const path = join(directory, "migration.db");
  const env = { ...process.env, CROSS_CANNON_UPDATE_DB: "1", ACCOUNTS_DATABASE_PATH: path };
  for (let attempt = 0; attempt < 2; attempt++) {
    execFileSync(process.execPath, ["scripts/update-accounts-db.mjs"], { env, stdio: "pipe" });
  }
  const database = new DatabaseSync(path);
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
  for (const table of ["user", "account", "session", "verification", "reader_progress"]) assert.ok(tables.includes(table));
  database.close();
});

test("the service worker never serves account data from cache or mistakes account failures for reader outages", async () => {
  const source = readFileSync("public/cross-canon-sw.js", "utf8");
  type WorkerFetchEvent = { request: Request; respondWith: (response: Promise<Response>) => void };
  for (const pathname of ["/account", "/api/account", "/api/auth/callback/google"]) {
    for (const offline of [false, true]) {
      const listeners = new Map<string, (event: WorkerFetchEvent) => void>();
      let notifications = 0;
      runInNewContext(source, {
        URL, Request, Response,
        self: { location: new URL(origin + "/cross-canon-sw.js"),
          addEventListener: (name: string, callback: (event: WorkerFetchEvent) => void) => listeners.set(name, callback),
          clients: { matchAll: async () => { notifications++; return []; } } },
        caches: { open: () => { throw new Error("Private requests cannot open caches"); } },
        fetch: async () => {
          if (offline) throw new Error("Network unavailable");
          return new Response("Account service unavailable", { status: 503, headers: { "Cache-Control": "private, no-store" } });
        },
      });
      let response: Promise<Response> | undefined;
      listeners.get("fetch")!({ request: request(pathname), respondWith: (value) => { response = value; } });
      assert.ok(response);
      const result = await response;
      assert.equal(result.status, 503);
      assert.match(result.headers.get("cache-control")!, /private, no-store/);
      assert.equal(notifications, 0);
    }
  }
});

test("Google redirect uses the configured callback, state and PKCE; untrusted origins are rejected", async () => {
  const make = (requestOrigin: string) => request("/api/auth/sign-in/social", {
    method: "POST", headers: { Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "google", callbackURL: "/account" }),
  });
  const rejected = await authAction({ request: make("https://attacker.example"), params: {}, context: {} });
  assert.equal(rejected.status, 403);
  const response = await authAction({ request: make(origin), params: {}, context: {} });
  assert.equal(response.status, 200);
  const url = new URL((await response.json()).url);
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("redirect_uri"), origin + "/api/auth/callback/google");
  assert.equal(url.searchParams.get("client_id"), process.env.GOOGLE_CLIENT_ID);
  assert.ok(url.searchParams.get("state"));
  assert.ok(url.searchParams.get("code_challenge"));
  assert.match(response.headers.get("cache-control")!, /no-store/);
});

test("forged Google callback cannot create a signed-in session", async () => {
  const response = await authLoader({ request: request("/api/auth/callback/google?state=forged&code=fake"), params: {}, context: {} });
  assert.equal(response.status, 302);
  assert.match(response.headers.get("location")!, /error/);
  assert.doesNotMatch(response.headers.get("set-cookie") ?? "", /session_token=[^;]/);
});

test("session lookup exposes only a safe user summary and never caches personal data", async () => {
  const response = await loader({ request: request("/api/account", { headers: { Cookie: cookie } }), params: {}, context: {} });
  const result = await response.json();
  assert.ok("user" in result && result.user);
  assert.equal(result.user.id, userId);
  assert.equal(result.user.email, "reader@example.com");
  assert.deepEqual(Object.keys(result.user).sort(), ["email", "id", "name"]);
  assert.ok(!("session" in result));
  assert.match(response.headers.get("cache-control")!, /private, no-store/);
  assert.equal(response.headers.get("vary"), "Cookie");
});

async function post(body: unknown, requestCookie = cookie, requestOrigin = origin) {
  return action({ request: request("/api/account", {
    method: "POST", headers: { Cookie: requestCookie, Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }), params: {}, context: {} });
}

test("progress writes require a real session, same origin and a bounded, valid location", async () => {
  assert.equal((await post({ location, revision: 0 }, "")).status, 401);
  assert.equal((await post({ location, revision: 0 }, "forged=token")).status, 401);
  await assert.rejects(post({ location, revision: 0 }, cookie, "https://attacker.example"), (error: unknown) => error instanceof Response && error.status === 403);
  assert.equal((await post({ location: { ...location, corpus: "unknown" }, revision: 0 })).status, 400);
  assert.equal((await post({ location, revision: -1 })).status, 400);
  assert.equal((await post({ location, revision: 1.5 })).status, 400);
  assert.equal((await post({ location: { ...location, chapterKey: "x".repeat(5000) }, revision: 0 })).status, 413);
  assert.equal(parseLocation({ ...location, passageKey: {} }), null);
});

test("saved progress survives reopening the database and cannot overwrite another user's progress", async () => {
  const first = await post({ location, revision: 0, userId: "attacker-chosen-id" });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).progress.revision, 1);
  const otherConnection = new DatabaseSync(accountsDatabasePath());
  assert.equal(readProgress(otherConnection, userId).scripture?.location.passageKey, location.passageKey);
  assert.deepEqual(readProgress(otherConnection, "attacker-chosen-id"), {});
  const newer = { ...location, chapterKey: "John\t4", passageKey: "John:4:1" };
  assert.equal(saveProgress(otherConnection, userId, newer, 1).saved, true);
  const stale = await post({ location, revision: 1 });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).progress.location.chapterKey, "John\t4");
  assert.equal((await post({ location, revision: 0 })).status, 409);
  assert.equal((await post({ location, revision: 99 })).status, 409);
  assert.equal(readProgress(otherConnection, userId).scripture?.location.chapterKey, "John\t4");
  otherConnection.close();
});

test("browser progress is isolated between accounts and stale offline progress requires a choice", async () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    localStorage: { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) },
    dispatchEvent: () => true,
  } });
  try {
    const { activateAccount, localProgress, queueReaderProgress, readerStorageKey, reconcileProgress, writeLocalProgress } = await import("./progress-storage");
    const guestKey = "cross-cannon:reader-position:v1";
    values.set(guestKey, JSON.stringify(location));
    activateAccount("alice");
    assert.notEqual(readerStorageKey(guestKey), guestKey);
    assert.equal(localProgress("alice", "scripture"), null);
    writeLocalProgress("alice", "scripture", { location, revision: 2, dirty: false });
    const offline = { ...location, chapterKey: "John\t7" };
    queueReaderProgress(offline);
    const cloud: Progress = { scripture: { location: { ...location, chapterKey: "John\t8" }, revision: 3 } };
    reconcileProgress("alice", cloud);
    assert.equal(localProgress("alice", "scripture")?.location.chapterKey, "John\t7");
    assert.equal(localProgress("alice", "scripture")?.conflict?.location.chapterKey, "John\t8");
    activateAccount("bob");
    assert.equal(localProgress("bob", "scripture"), null);
    activateAccount(null);
    assert.equal(readerStorageKey(guestKey), guestKey);
    assert.equal(values.get(guestKey), JSON.stringify(location));
  } finally { Reflect.deleteProperty(globalThis, "window"); }
});

test("signing out invalidates the server session", async () => {
  const response = await authAction({ request: request("/api/auth/sign-out", {
    method: "POST", headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" }, body: "{}",
  }), params: {}, context: {} });
  assert.equal(response.status, 200);
  const account = await loader({ request: request("/api/account", { headers: { Cookie: cookie } }), params: {}, context: {} });
  const result = await account.json();
  assert.ok("user" in result);
  assert.equal(result.user, null);
});
