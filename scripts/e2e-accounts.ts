import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as wait } from "node:timers/promises";
import { getMigrations } from "better-auth/db/migration";
import puppeteer, { type Page } from "puppeteer";
import { authOptions, getAccountsDatabase, getAuth } from "../app/features/account/auth.server";
import type { ScriptureCachePayload } from "../app/lib/scripture-cache-contract";

const port = 34_000 + process.pid % 10_000;
const origin = `http://127.0.0.1:${port}`;
const directory = await mkdtemp(path.join(tmpdir(), "cross-canon-account-browser-"));
const secret = randomBytes(32).toString("base64");
Object.assign(process.env, {
  BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: secret,
  GOOGLE_CLIENT_ID: "browser-test.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "browser-test-only",
  ACCOUNTS_DATABASE_PATH: path.join(directory, "accounts.db"),
});
const database = new DatabaseSync(process.env.ACCOUNTS_DATABASE_PATH!);
await (await getMigrations(authOptions(database))).runMigrations();
database.exec(await readFile("scripts/accounts-schema.sql", "utf8"));
database.close();
const auth = getAuth();
const context = await auth.$context;
const user = await context.internalAdapter.createUser({ name: "Alex Reader", email: "alex@example.com", emailVerified: true }, { method: "oauth" });
async function cookie() {
  const session = await context.internalAdapter.createSession(user.id);
  const signature = createHmac("sha256", secret).update(session.token).digest("base64");
  return { name: context.authCookies.sessionToken.name, value: encodeURIComponent(`${session.token}.${signature}`), domain: "127.0.0.1", path: "/", httpOnly: true };
}
const manifest = JSON.parse(await readFile("scripture-cache/manifest.json", "utf8"));
const scripture = await readFile(`.${manifest.jsonPath}`, "utf8");
const payload: ScriptureCachePayload = JSON.parse(scripture);
const first = payload.passages.find((passage) => passage.reference.startsWith("John 3:"))!;
assert.ok(first);
const errors: string[] = [];
const server = spawn(process.execPath, ["build/server/serve.mjs"], {
  env: { ...process.env, PORT: String(port), NODE_ENV: "production" }, stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (chunk) => { serverLog += chunk; });
server.stderr.on("data", (chunk) => { serverLog += chunk; });
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
const screenshots = path.resolve("docs/screenshots");

async function prepare(page: Page) {
  page.setDefaultTimeout(20_000);
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = new URL(request.url());
    // Use the existing text artifact; no search server or corpus DB mutation is needed.
    if (url.pathname === manifest.jsonPath) void request.respond({ status: 200, contentType: "application/json", body: scripture });
    else if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") void request.abort();
    else void request.continue();
  });
}

try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(origin + "/api/account")).ok) break; } catch { /* Wait for server. */ }
    if (attempt >= 80 || server.exitCode !== null) throw new Error("Account server failed to start:\n" + serverLog);
    await wait(100);
  }
  browser = await puppeteer.launch({ headless: "shell", args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  await mkdir(screenshots, { recursive: true });
  const guest = await browser.newPage();
  await prepare(guest);
  await guest.setViewport({ width: 1440, height: 1050 });
  await guest.goto(origin + "/account", { waitUntil: "networkidle0" });
  console.log("Guest account page loaded.");
  await guest.waitForFunction(() => !document.querySelector<HTMLButtonElement>(".google-sign-in")?.disabled);
  await guest.screenshot({ path: path.join(screenshots, "google-login-desktop.png"), fullPage: true });
  console.log("Desktop login preview captured.");
  await guest.setViewport({ width: 390, height: 844, isMobile: true, deviceScaleFactor: 1 });
  await guest.screenshot({ path: path.join(screenshots, "google-login-mobile.png"), fullPage: true });
  assert.equal(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

  const deviceA = await browser.createBrowserContext();
  const deviceB = await browser.createBrowserContext();
  await deviceA.setCookie(await cookie());
  await deviceB.setCookie(await cookie());
  const pageA = await deviceA.newPage();
  const pageB = await deviceB.newPage();
  await prepare(pageA);
  await prepare(pageB);
  await pageA.setViewport({ width: 1440, height: 1050 });
  await pageA.goto(origin + `/reader/${encodeURIComponent(first.id)}`, { waitUntil: "networkidle0" });
  await pageA.waitForSelector(".reader-passage-text");
  await pageA.waitForFunction(async () => {
    const account = await (await fetch("/api/account")).json();
    return account.progress.scripture?.location.chapterKey === "John\t3";
  });
  await pageA.locator('[aria-label="Open reader tools"]').click();
  await pageA.waitForSelector('[aria-label="Account and reading progress"]');
  await pageA.screenshot({ path: path.join(screenshots, "google-account-reader-desktop.png"), fullPage: false });
  await pageA.setViewport({ width: 390, height: 844, isMobile: true });
  await pageA.waitForSelector(".reader-passage-text");
  await pageA.locator('[aria-label="Open reader tools"]').click();
  await pageA.waitForSelector('[aria-label="Account and reading progress"]');
  await pageA.screenshot({ path: path.join(screenshots, "google-account-reader-mobile.png"), fullPage: false });
  assert.equal(await pageA.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await pageB.setViewport({ width: 390, height: 844, isMobile: true });
  await pageB.goto(origin + "/account", { waitUntil: "networkidle0" });
  await pageB.waitForFunction(() => document.querySelector(".account-location")?.textContent === "John 3");
  await pageB.screenshot({ path: path.join(screenshots, "google-account-synced-mobile.png"), fullPage: true });
  const continueLink = await pageB.$eval(".account-progress a", (link) => link.getAttribute("href"));
  assert.ok(continueLink?.startsWith("/reader/"));
  console.log("Progress from device A is visible on device B.");

  // An offline browser has a queued location based on an older server revision.
  await pageB.evaluate((id) => {
    const key = `cross-cannon:account:${id}:progress:scripture:v1`;
    const current = JSON.parse(localStorage.getItem(key)!);
    current.location = { ...current.location, chapterKey: "John\t4", passageKey: undefined };
    current.dirty = true;
    localStorage.setItem(key, JSON.stringify(current));
  }, user.id);
  await pageA.evaluate(async () => {
    const account = await (await fetch("/api/account")).json();
    await fetch("/api/account", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ location: { version: 2, corpus: "scripture", chapterKey: "John\t5" }, revision: account.progress.scripture.revision }) });
  });
  await pageB.locator("::-p-text(Sync now)").click();
  await pageB.waitForSelector(".account-conflict");
  await pageB.screenshot({ path: path.join(screenshots, "google-account-conflict-mobile.png"), fullPage: true });
  await pageB.locator("::-p-text(Use other device)").click();
  await pageB.waitForFunction(() => document.querySelector(".account-location")?.textContent === "John 5" && !document.querySelector(".account-conflict"));

  // The standalone offline reader must queue real navigation for a later connected visit.
  await pageB.evaluate(async (jsonPath) => {
    const cache = await caches.open("account-test-scripture");
    await cache.put(jsonPath, await fetch(jsonPath));
  }, manifest.jsonPath);
  await pageB.goto(origin + "/offline-reader.html", { waitUntil: "networkidle0" });
  await pageB.waitForSelector("#reader nav button");
  await pageB.setOfflineMode(true);
  await pageB.locator("::-p-text(Next)").click();
  await pageB.waitForFunction((id) => {
    const progress = JSON.parse(localStorage.getItem(`cross-cannon:account:${id}:progress:scripture:v1`)!);
    return progress.dirty && location.pathname.startsWith("/reader/") && progress.location.passageKey === decodeURIComponent(location.pathname.slice(8));
  }, {}, user.id);
  const offlineChapter = await pageB.evaluate((id) => JSON.parse(
    localStorage.getItem(`cross-cannon:account:${id}:progress:scripture:v1`)!
  ).location.chapterKey as string, user.id);
  await pageB.setOfflineMode(false);
  await pageB.goto(origin + "/account", { waitUntil: "networkidle0" });
  await pageB.waitForFunction(async (chapter) => {
    const account = await (await fetch("/api/account")).json();
    return account.progress.scripture?.location.chapterKey === chapter;
  }, {}, offlineChapter);
  console.log("Offline fallback navigation synced after reconnecting.");
  await pageB.locator("::-p-text(Sign out)").click();
  await pageB.waitForSelector(".google-sign-in");
  assert.equal(await pageB.evaluate(() => localStorage.getItem("cross-cannon:active-account:v1")), null);
  assert.deepEqual(errors, []);
  console.log("Account browser checks passed: two devices sync, stale offline progress requires a choice, sign-out returns to guest reading, and desktop/mobile layouts fit.");
  console.log("Previews saved under docs/screenshots/google-*.png. Real Google consent still requires configured credentials.");
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  getAccountsDatabase().close();
  await rm(directory, { recursive: true, force: true });
}
