import assert from "node:assert/strict";
import fs from "node:fs/promises";
import puppeteer from "puppeteer";

const origin = process.env.AUDIO_TEST_ORIGIN ?? "http://127.0.0.1:3005";
const manifest = JSON.parse(
  await fs.readFile("public/continuous-audio.json", "utf8")
);
const cacheManifest = JSON.parse(
  await fs.readFile("scripture-cache/manifest.json", "utf8")
);
const cache = JSON.parse(
  await fs.readFile(`.${cacheManifest.jsonPath}`, "utf8")
);
const genesis = cache.passages.find((p: { reference: string }) =>
  /^Genesis 1:/.test(p.reference)
);
assert(genesis);
const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${origin}/reader/${genesis.id}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForSelector('[aria-label="Open reader tools"]');
  await page.waitForNetworkIdle({ idleTime: 500, concurrency: 2 });
  await page.click('[aria-label="Open reader tools"]');
  await page.click('button[aria-label="Play Genesis 1 audio"]');
  await page.waitForFunction(() => {
    const a = document.querySelector("audio");
    return a && !a.paused && a.currentTime > 0;
  });
  const initial = await page.$eval("audio", (a) => ({
    source: a.currentSrc,
    duration: a.duration,
  }));
  assert(initial.source.includes("/audio/continuous/"), initial.source);
  assert(initial.duration > 10000, "Playing the whole book");
  const boundary =
    manifest.chapters["/audio/WEBD_AT/01_Genesis_02.mp3"].startSeconds;
  await page.$eval(
    "audio",
    (a, seconds) => {
      a.currentTime = seconds;
    },
    boundary - 1
  );
  await page.waitForFunction(() => !document.querySelector("audio")?.seeking);
  const client = await page.createCDPSession();
  await client.send("Emulation.setScriptExecutionDisabled", { value: true });
  await new Promise((resolve) => setTimeout(resolve, 2500));
  await client.send("Emulation.setScriptExecutionDisabled", { value: false });
  await page.waitForFunction(() =>
    document.querySelector("#reader-title")?.textContent?.includes("Genesis 2")
  );
  const after = await page.$eval("audio", (a) => ({
    source: a.currentSrc,
    time: a.currentTime,
    paused: a.paused,
  }));
  assert.equal(
    after.source,
    initial.source,
    "No source change at chapter boundary"
  );
  assert(
    after.time > boundary && !after.paused,
    "Audio crossed boundary while JS was disabled"
  );
  await page.screenshot({
    path: "docs/screenshots/continuous-audio-desktop.png",
    fullPage: false,
  });
  await page.click('button[aria-label="Pause Genesis 2 audio"]');
  const pausedAt = await page.$eval("audio", (a) => a.currentTime);
  await page.waitForSelector('button[aria-label="Play Genesis 2 audio"]');
  await page.click('button[aria-label="Play Genesis 2 audio"]');
  await page.waitForFunction(() => !document.querySelector("audio")?.paused);
  const resumedAt = await page.$eval("audio", (a) => a.currentTime);
  assert(
    Math.abs(resumedAt - pausedAt) < 2,
    "Resume preserves the playback position"
  );
  // Jump across the virtualized reader window without replacing the audio node.
  const late =
    manifest.chapters["/audio/WEBD_AT/01_Genesis_40.mp3"].startSeconds;
  await page.$eval(
    "audio",
    (a, seconds) => {
      a.currentTime = seconds + 1;
    },
    late
  );
  await page.waitForFunction(() =>
    document.querySelector("#reader-title")?.textContent?.includes("Genesis 40")
  );
  assert.equal(await page.$eval("audio", (a) => a.currentSrc), initial.source);
  assert.equal(await page.$eval("audio", (a) => a.paused), false);
  await page.setViewport({
    width: 390,
    height: 844,
    isMobile: true,
    deviceScaleFactor: 2,
    hasTouch: true,
  });
  await page.screenshot({
    path: "docs/screenshots/continuous-audio-mobile.png",
    fullPage: false,
  });
  // Byte ranges: fetch a small slice from the middle, not the entire book.
  const partial = await fetch(initial.source, {
    headers: { Range: "bytes=1000000-1001023" },
  });
  assert.equal(partial.status, 206);
  assert.equal((await partial.arrayBuffer()).byteLength, 1024);
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    "PASS: continuous playback with JS suspended, chapter sync, pause/resume, long seek, 1024-byte range, desktop/mobile screenshots"
  );
  // A failed combined asset must fall back to its original chapter recording.
  const fallback = await browser.newPage();
  await fallback.setRequestInterception(true);
  fallback.on("request", (request) => {
    if (request.url().includes("/audio/continuous/"))
      void request.respond({ status: 404 });
    else void request.continue();
  });
  await fallback.goto(`${origin}/reader/${genesis.id}`, {
    waitUntil: "domcontentloaded",
  });
  await fallback.waitForSelector('[aria-label="Open reader tools"]');
  await fallback.waitForNetworkIdle({ idleTime: 500, concurrency: 2 });
  await fallback.click('[aria-label="Open reader tools"]');
  await fallback.click('button[aria-label="Play Genesis 1 audio"]');
  await fallback.waitForFunction(() => {
    const a = document.querySelector("audio");
    return (
      a?.currentSrc.includes("/audio/WEBD_AT/") &&
      !a.paused &&
      a.currentTime > 0
    );
  });
  console.log(
    "PASS: missing combined recording falls back to the preserved original URL"
  );
} finally {
  await browser.close();
}
