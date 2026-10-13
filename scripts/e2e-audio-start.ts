import assert from "node:assert/strict";
import fs from "node:fs/promises";
import puppeteer from "puppeteer";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";

// Exercise the real reader with deterministic media loading and seek events.
// A whole-book recording initially reports time zero before its chapter seek.
const fixtureRoot = path.resolve("scripts/fixtures/audio-start");
const fixtureOutput = path.resolve(".tmp/audio-start-fixture");
await build({ configFile: false, root: fixtureRoot, base: "./", logLevel: "silent",
  resolve: { alias: { "~": path.resolve("app") } },
  build: { outDir: fixtureOutput, emptyOutDir: true }
});
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--allow-file-access-from-files"] });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  // tsx's function-name helper is referenced by serialized browser callbacks.
  await page.evaluateOnNewDocument("window.__name = (fn) => fn");
  const installMedia = () => {
    history.replaceState = () => {};
    const states = new WeakMap<HTMLMediaElement, { time: number; paused: boolean; ready: number; seeking: boolean; url: string }>();
    const state = (a: HTMLMediaElement) => {
      let value = states.get(a);
      if (!value) { value = { time: 0, paused: true, ready: 0, seeking: false, url: "" }; states.set(a, value); }
      return value;
    };
    (window as unknown as { advanceAudio: (seconds: number) => void }).advanceAudio = (seconds) => {
      const audio = document.querySelector("audio")!;
      state(audio).time = seconds;
      audio.dispatchEvent(new Event("timeupdate"));
    };
    const getAttribute = HTMLMediaElement.prototype.getAttribute;
    const removeAttribute = HTMLMediaElement.prototype.removeAttribute;
    HTMLMediaElement.prototype.getAttribute = function (name) {
      return name === "src" ? state(this).url || null : getAttribute.call(this, name);
    };
    HTMLMediaElement.prototype.removeAttribute = function (name) {
      if (name === "src") state(this).url = "";
      else removeAttribute.call(this, name);
    };
    Object.defineProperties(HTMLMediaElement.prototype, {
      src: {
        get() { return state(this).url ? new URL(state(this).url, location.href).href : ""; },
        set(value: string) { state(this).url = value; state(this).ready = 0; }
      },
      currentTime: {
        get() { return state(this).time; },
        set(value: number) {
          const s = state(this);
          if (s.time === value) return;
          s.seeking = true;
          this.dispatchEvent(new Event("seeking"));
          // The browser may emit timeupdate for the old position during a seek.
          this.dispatchEvent(new Event("timeupdate"));
          setTimeout(() => {
            s.time = new URLSearchParams(location.search).has("ios") ? Math.floor(value * 1000) / 1000 : value; s.seeking = false;
            this.dispatchEvent(new Event("timeupdate"));
            this.dispatchEvent(new Event("seeked"));
            if (new URLSearchParams(location.search).has("ios")) {
              this.dispatchEvent(new Event("timeupdate"));
              setTimeout(() => { s.time = value + 0.25; this.dispatchEvent(new Event("timeupdate")); }, 100);
            }
          }, 100);
        }
      },
      currentSrc: { get() { return this.src; } },
      paused: { get() { return state(this).paused; } },
      readyState: { get() { return state(this).ready; } },
      seeking: { get() { return state(this).seeking; } },
      ended: { get() { return false; } },
      duration: { get() { return 20000; } }
    });
    HTMLMediaElement.prototype.load = function () { state(this).ready = 0; };
    HTMLMediaElement.prototype.pause = function () { state(this).paused = true; this.dispatchEvent(new Event("pause")); };
    HTMLMediaElement.prototype.play = function () {
      const s = state(this);
      s.paused = false;
      this.dispatchEvent(new Event("play"));
      this.dispatchEvent(new Event("timeupdate"));
      if (!s.ready) setTimeout(() => { s.ready = 1; this.dispatchEvent(new Event("loadedmetadata")); }, 100);
      return Promise.resolve();
    };
  };
  await page.evaluateOnNewDocument(installMedia);
  if (process.env.AUDIO_START_SCENARIO !== "luke") {
  await page.goto(pathToFileURL(path.join(fixtureOutput, "index.html")).href, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#reader-title")?.textContent?.trim() === "Genesis 5");
  await new Promise(resolve => setTimeout(resolve, 800));
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.evaluate(() => {
    const titles: string[] = [];
    (window as unknown as { audioStartTitles: string[] }).audioStartTitles = titles;
    const title = document.querySelector("#reader-title")!;
    new MutationObserver(() => titles.push(title.textContent!.trim())).observe(title, { childList: true, subtree: true, characterData: true });
  });
  await page.click("button");
  await new Promise(resolve => setTimeout(resolve, 1000));
  const result = await page.evaluate(() => ({
    title: document.querySelector("#reader-title")?.textContent?.trim(),
    titles: (window as unknown as { audioStartTitles: string[] }).audioStartTitles,
    paused: document.querySelector("audio")?.paused,
    time: document.querySelector("audio")?.currentTime,
    src: document.querySelector("audio")?.currentSrc
  }));
  assert.equal(errors.length, 0, errors.join("\n"));
  assert.equal(result.title, "Genesis 5", JSON.stringify(result));
  assert(result.titles.every(title => title === "Genesis 5"), `Starting audio navigated chapters: ${JSON.stringify(result)}`);
  assert.equal(result.paused, false);
  assert.equal(await page.evaluate(() => window.scrollY), scrollBefore, "Starting audio must preserve the reading position");
  console.log("PASS: starting later-chapter audio preserves the reader chapter during loading and seeking");

  await page.click("button");
  assert.equal(await page.$eval("audio", a => a.paused), true);
  await page.click("button");
  assert.equal(await page.$eval("audio", a => a.currentTime), 400, "Resume must not restart the chapter");
  assert.equal(await page.$eval("audio", a => a.paused), false);

  // Switch chapters within a source that is already loaded. Old timestamps
  // emitted while seeking must not navigate back to the previous chapter.
  await page.evaluate(() => {
    const chapter = document.querySelector<HTMLElement>('[data-passage-id="gen-10"]')!;
    window.scrollTo({ top: chapter.getBoundingClientRect().top + window.scrollY - 118 });
  });
  await page.waitForFunction(() => document.querySelector("#reader-title")?.textContent?.trim() === "Genesis 10");
  await page.evaluate(() => { (window as unknown as { audioStartTitles: string[] }).audioStartTitles.length = 0; });
  await page.click("button");
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(await page.$eval("audio", a => a.currentTime), 900);
  const switchedTitles = await page.evaluate(() => (window as unknown as { audioStartTitles: string[] }).audioStartTitles);
  assert(switchedTitles.every(title => title === "Genesis 10"), JSON.stringify(switchedTitles));

  // Settled seeks and natural chapter boundaries must still move the reader,
  // including chapters outside the currently rendered window.
  const audioElement = await page.$("audio");
  await page.evaluate(() => (window as unknown as { advanceAudio: (seconds: number) => void }).advanceAudio(1001));
  await page.waitForFunction(() => document.querySelector("#reader-title")?.textContent?.trim() === "Genesis 11");
  for (const chapter of [40, 1]) {
    await page.$eval("audio", (a, seconds) => { a.currentTime = seconds; }, (chapter - 1) * 100);
    await page.waitForFunction(number => document.querySelector("#reader-title")?.textContent?.trim() === `Genesis ${number}`, {}, chapter);
    assert.equal(await page.$eval("audio", a => a.paused), false);
    assert(await page.evaluate(element => element === document.querySelector("audio"), audioElement), "Chapter navigation must retain the audio element");
  }
  await page.setViewport({ width: 1440, height: 1000 });
  await new Promise(resolve => setTimeout(resolve, 300));
  await page.evaluate(() => {
    const chapter = document.querySelector<HTMLElement>('[data-passage-id="gen-5"]')!;
    window.scrollTo({ top: chapter.getBoundingClientRect().top + window.scrollY - 118 });
  });
  await page.waitForFunction(() => document.querySelector("#reader-title")?.textContent?.trim() === "Genesis 5");
  await page.click("button");
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(await page.$eval("#reader-title", a => a.textContent?.trim()), "Genesis 5");
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log("PASS: pause/resume, same-recording chapter start, settled chapter seeks, retained audio element, and desktop start");
  }
  const luke = await browser.newPage();
  luke.on("pageerror", error => errors.push(String(error)));
  await luke.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await luke.evaluateOnNewDocument("window.__name = (fn) => fn");
  await luke.evaluateOnNewDocument(installMedia);
  await luke.goto(pathToFileURL(path.join(fixtureOutput, "index.html")).href + "?luke&ios", { waitUntil: "domcontentloaded" });
  await luke.waitForFunction(() => document.querySelector("#reader-title")?.textContent?.trim() === "Luke 7");
  await new Promise(resolve => setTimeout(resolve, 800));
  const before = await luke.$eval('[data-passage-id="luke-7"]', p => p.getBoundingClientRect().top);
  await luke.evaluate(() => {
    const trace = window as unknown as { audioStartTitles: string[]; audioScrolls: unknown[][] };
    trace.audioStartTitles = [];
    trace.audioScrolls = [];
    const scrollTo = window.scrollTo;
    window.scrollTo = (...args: unknown[]) => {
      trace.audioScrolls.push(args);
      Reflect.apply(scrollTo, window, args);
    };
    const title = document.querySelector("#reader-title")!;
    new MutationObserver(() => (window as unknown as { audioStartTitles: string[] }).audioStartTitles.push(title.textContent!.trim())).observe(title, { childList: true, subtree: true, characterData: true });
  });
  await luke.click("button");
  await new Promise(resolve => setTimeout(resolve, 1000));
  const after = await luke.$eval('[data-passage-id="luke-7"]', p => p.getBoundingClientRect().top);
  const titles = await luke.evaluate(() => (window as unknown as { audioStartTitles: string[] }).audioStartTitles);
  assert.equal(errors.length, 0, errors.join("\n"));
  assert(titles.every(title => title === "Luke 7"), `Audio start navigated away from Luke 7: ${JSON.stringify(titles)}`);
  assert(Math.abs(after - before) < 1, `Audio start moved the Luke 7 passage from ${before}px to ${after}px`);
  assert.equal(await luke.evaluate(() => (window as unknown as { audioScrolls: unknown[][] }).audioScrolls.length), 0, "Audio startup must not request any reader scroll");
  // A later rounded clock reading must not undo a completed startup seek.
  await luke.evaluate(() => (window as unknown as { advanceAudio: (seconds: number) => void }).advanceAudio(2094.367));
  await luke.evaluate(() => (window as unknown as { advanceAudio: (seconds: number) => void }).advanceAudio(2094.62));
  assert.equal(await luke.$eval("#reader-title", title => title.textContent?.trim()), "Luke 7");
  await luke.click("button");
  const pausedTime = await luke.$eval("audio", a => a.currentTime);
  await luke.click("button");
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(await luke.$eval("audio", a => a.currentTime), pausedTime, "Resume must preserve audio position");
  assert.equal(await luke.evaluate(() => (window as unknown as { audioScrolls: unknown[][] }).audioScrolls.length), 0, "Audio resume must not request any reader scroll");
  const resumedTitles = await luke.evaluate(() => (window as unknown as { audioStartTitles: string[] }).audioStartTitles);
  assert(resumedTitles.every(title => title === "Luke 7"), JSON.stringify(resumedTitles));
  await luke.evaluate(() => (window as unknown as { advanceAudio: (seconds: number) => void }).advanceAudio(2455.96));
  await luke.waitForFunction(() => document.querySelector("#reader-title")?.textContent?.trim() === "Luke 8");
  await new Promise(resolve => setTimeout(resolve, 100));
  assert(await luke.evaluate(() => (window as unknown as { audioScrolls: unknown[][] }).audioScrolls.length > 0), "Finishing Luke 7 must scroll to Luke 8");
  console.log("PASS: fractional Luke 7 chapter start preserves the visible passage with iOS-style timestamp rounding");
} finally { await browser.close(); await fs.rm(fixtureOutput, { recursive: true, force: true }); }
