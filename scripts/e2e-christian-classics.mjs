import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import puppeteer from "puppeteer";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

const managedPort = Number(process.env.E2E_PORT ?? 3115);
const base = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${managedPort}`;
let server = process.env.E2E_BASE_URL
  ? null
  : spawn(process.execPath, ["build/server/serve.mjs"], {
      env: {
        ...process.env,
        PORT: String(managedPort),
        NODE_ENV: "production",
      },
      stdio: "ignore",
    });
if (server) {
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      if ((await fetch(base, { method: "HEAD" })).ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(100);
  }
  if (!ready) {
    server.kill();
    throw new Error("Preview server did not start");
  }
}
const screenshots = "docs/screenshots/christian-classics";
await mkdir(screenshots, { recursive: true });
const manifest = JSON.parse(
  await readFile("scripture-cache/manifest.json", "utf8")
);
const scripture = JSON.parse(
  await readFile(`scripture-cache/${manifest.version}.json`, "utf8")
);
const beatitudes = scripture.passages.find((p) =>
  /^Matthew 5:1(?:-|$)/.test(p.reference)
);
assert(beatitudes, "Existing Scripture cache contains the Beatitudes");
const browser = await puppeteer.launch({
  headless: "shell",
  args: ["--no-sandbox"],
});
const errors = [];
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(30_000);
  page.on("pageerror", (error) => errors.push(error.message));
  if (process.env.E2E_DEBUG) {
    page.on("request", (request) => {
      if (request.method() === "POST")
        console.log("POST", request.url(), request.postData());
    });
    page.on("response", (response) => {
      if (response.request().method() === "POST")
        console.log("RESPONSE", response.status(), response.url());
    });
  }
  await page.setRequestInterception(true);
  page.on("request", (request) =>
    /https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(request.url())
      ? request.abort()
      : request.continue()
  );
  const goto = async (pathname) => {
    await page.goto(`${base}${pathname}`, { waitUntil: "networkidle2" });
  };
  const clickText = async (text, root = "body") => {
    const clicked = await page.$eval(
      root,
      (element, text) => {
        const button = [...element.querySelectorAll("button")].find(
          (button) => button.textContent.trim() === text
        );
        button?.click();
        return Boolean(button);
      },
      text
    );
    assert(clicked, `Button exists: ${text}`);
  };
  const capture = async (name) => {
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      ),
      "No horizontal page overflow"
    );
    await page.screenshot({ path: `${screenshots}/${name}.png` });
  };
  for (const [device, width, height] of [
    ["desktop", 1440, 1000],
    ["mobile", 390, 844],
  ]) {
    await page.setViewport({ width, height });
    await goto("/christian-classics");
    assert.equal(
      await page.$$eval(".classics-work-row", (nodes) => nodes.length),
      4
    );
    await page.type(
      'input[aria-label="Find a classic by title or author"]',
      "Wesley"
    );
    await page.waitForFunction(
      () => document.querySelectorAll(".classics-work-row").length === 1
    );
    assert.match(
      await page.$eval(".classics-work-row", (node) => node.innerText),
      /John Wesley/
    );
    await page.$eval('input[type="search"]', (input) => {
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // React's controlled-input setter must observe a real keyboard edit.
    await page.focus('input[type="search"]');
    await page.keyboard.press("Home");
    await page.keyboard.down("Shift");
    await page.keyboard.press("End");
    await page.keyboard.up("Shift");
    await page.keyboard.press("Backspace");
    await goto("/christian-classics");
    await clickText("Commentaries");
    await page.waitForFunction(
      () => document.querySelectorAll(".classics-work-row").length === 3
    );
    await clickText("All works");
    await capture(`library-${device}`);
    await page.click(".classics-featured");
    await page.waitForSelector(".reader-passage-button");
    await page.waitForSelector(".work-about-trigger");
    await page.click(".collection-trigger");
    await page.waitForSelector(".collection-popover");
    assert.equal(
      await page.$$eval(
        ".collection-popover .collection-links a",
        (nodes) => nodes.length
      ),
      3
    );
    await page.type(".collection-find input", "Aquinas");
    assert.equal(
      await page.$$eval(".collection-work-list a", (nodes) => nodes.length),
      1
    );
    await capture(`chooser-${device}`);
    await page.keyboard.press("Escape");
    assert.equal(await page.$(".collection-popover"), null);
    await page.click(".work-about-trigger");
    await page.waitForSelector(".work-about-dialog[open]");
    assert.match(
      await page.$eval(".work-about-dialog", (node) => node.innerText),
      /William Benham/
    );
    await page.keyboard.press("Escape");
    assert.equal(await page.$(".work-about-dialog"), null);
    await page.click(".reader-tools-trigger");
    await clickText("Jump");
    await page.waitForSelector(".ec-jump-modal");
    const works = await page.$$(".ec-work-select");
    assert.equal(works.length, 4);
    await page.keyboard.press("Escape");
    await capture(`reader-${device}`);
    if (device === "desktop") {
      await page.click(".reader-passage-button");
      await clickText("Similar passages");
      await page.waitForSelector(".ec-results .scripture-result-button");
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 15000 });
      await page.click(
        '.search-target-control label:has(input[value="early-christian"])'
      );
      const priorResult = await page.$eval(
        ".ec-results .result-meta",
        (node) => node.textContent
      );
      await page.click(".search-modal .search-button");
      await page.waitForFunction(
        (previous) => {
          const result = document.querySelector(".ec-results .result-meta");
          return (
            result &&
            result.textContent !== previous &&
            document.querySelector('input[value="early-christian"]')?.checked
          );
        },
        {},
        priorResult
      );
      await page.click(".ec-results .scripture-result-button");
      await clickText("Jump to", ".ec-results");
      await page.waitForFunction(() => location.pathname === "/church-fathers");
      await page.waitForSelector(".reader-passage-button");
    }
    await goto(`/reader/${beatitudes.id}`);
    await page.waitForSelector(
      `[data-passage-id="${beatitudes.id}"] .reader-passage-button`
    );
    await page.click(
      `[data-passage-id="${beatitudes.id}"] .reader-passage-button`
    );
    await clickText("Read with Classics");
    await page.waitForSelector(
      ".classic-commentary-notes .reader-passage-button"
    );
    assert.equal(
      await page.$$eval(
        ".classic-commentary-select option",
        (nodes) => nodes.length
      ),
      3
    );
    await capture(`commentary-${device}`);
    if (device === "mobile") {
      await page.$eval(".classic-commentary-dialog", (dialog) => {
        dialog.scrollTop = 430;
      });
      await capture("commentary-mobile-notes");
    }
    for (const work of [
      "classics:wesley",
      "classics:catena",
      "classics:henry",
    ]) {
      await page.select(".classic-commentary-select select", work);
      await page.waitForFunction(
        (work) =>
          document
            .querySelector(".classic-commentary-open")
            ?.getAttribute("href")
            ?.includes(encodeURIComponent(`${work}:`)),
        {},
        work
      );
      await page.waitForSelector(
        ".classic-commentary-notes .reader-passage-button"
      );
    }
    await page.keyboard.press("Escape");
    assert.equal(await page.$(".classic-commentary-dialog"), null);
    console.log(
      `${device}: library filters, collection chooser, edition details, Jump, original commentary and dismissal passed.`
    );
  }
  // Download all 114 chapters, then open a chapter outside the initial window
  // through its direct Reader Link with the browser genuinely offline.
  await goto(
    "/christian-classics/read?chapter=classics%3Aimitation%3Abook-1.1"
  );
  await page.waitForSelector(".reader-passage-button");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload({ waitUntil: "networkidle2" });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.click(".reader-tools-trigger");
  await page.click('button[aria-label="Download work"]');
  await page.waitForFunction(
    () => document.body.textContent.includes("Available offline"),
    { timeout: 60_000 }
  );
  if (server) {
    const exited = once(server, "exit");
    server.kill("SIGTERM");
    await exited;
    server = null;
  }
  await page.setOfflineMode(true);
  await goto(
    "/christian-classics/read?chapter=classics%3Aimitation%3Abook-4.18&passage=1-3"
  );
  await page.waitForSelector(
    '[data-chapter-id="classics:imitation:book-4.18"] .reader-passage-button'
  );
  await page.waitForSelector(".offline-indicator");
  assert.match(
    await page.$eval(".reader-header h1", (node) => node.innerText),
    /Book 4 · Chapter 18/
  );
  await page.waitForSelector(
    '[data-chapter-id="classics:imitation:book-4.18"] .reader-passage.is-selected'
  );
  await capture("offline-mobile");
  await page.click(".reader-tools-trigger");
  await clickText("Jump");
  assert.equal(
    await page.$$eval(".ec-work-select", (nodes) => nodes.length),
    1,
    "Offline Jump contains only downloaded works"
  );
  await page.keyboard.press("Escape");
  await goto("/christian-classics");
  await page.waitForFunction(() =>
    document
      .querySelector(".classics-featured")
      ?.textContent.includes("Continue reading")
  );
  const continueUrl = new URL(
    await page.$eval(".classics-featured", (link) => link.href)
  );
  assert.equal(
    continueUrl.searchParams.get("chapter"),
    "classics:imitation:book-4.18"
  );
  assert.equal(
    continueUrl.searchParams.get("passage"),
    "1-3",
    "Continue reading restores the focused Passage"
  );
  await page.click(".classics-featured");
  await page.waitForSelector(
    '[data-chapter-id="classics:imitation:book-4.18"] .reader-passage.is-selected'
  );
  await page.setOfflineMode(false);
  assert.deepEqual(errors, [], "No browser JavaScript errors");
  console.log(
    "Classics download, offline direct Reader Link, selected passage and downloaded-only Jump passed."
  );
} finally {
  server?.kill("SIGTERM");
  await browser.close();
}
