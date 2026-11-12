import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import puppeteer from "puppeteer";

// Run against the production build and the existing local Rust indexes.
const port = process.env.E2E_PORT ?? "3116";
const rustPort = process.env.E2E_RUST_PORT ?? "13106";
const base = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`;
const servers = [];
let browser;
try {
  if (!process.env.E2E_BASE_URL) {
    servers.push(
      spawn("target/release/r-cross-cannon", [], {
        env: {
          ...process.env,
          CROSS_CANON_DATA_DIR: process.cwd(),
          R_CROSS_CANNON_BIND: `127.0.0.1:${rustPort}`,
        },
        stdio: "ignore",
      })
    );
    servers.push(
      spawn(process.execPath, ["build/server/serve.mjs"], {
        env: {
          ...process.env,
          PORT: port,
          NODE_ENV: "production",
          R_CROSS_CANNON_ORIGIN: `http://127.0.0.1:${rustPort}`,
        },
        stdio: "ignore",
      })
    );
    for (const url of [`http://127.0.0.1:${rustPort}/r/api/health`, base]) {
      let ready = false;
      for (let attempt = 0; attempt < 240; attempt++) {
        if (servers.some((server) => server.exitCode !== null))
          throw new Error("Preview server exited");
        try {
          ready = (await fetch(url)).ok;
        } catch {}
        if (ready) break;
        await delay(250);
      }
      assert(ready, `Preview server ready: ${url}`);
    }
  }
  const manifest = JSON.parse(
    await readFile("scripture-cache/manifest.json", "utf8")
  );
  const { passages } = JSON.parse(
    await readFile(`scripture-cache/${manifest.version}.json`, "utf8")
  );
  const passage = passages.find((item) =>
    /^Matthew 5:1(?:-|$)/.test(item.reference)
  );
  assert(passage);
  const screenshots = "docs/screenshots/verse-commentaries";
  await mkdir(screenshots, { recursive: true });
  browser = await puppeteer.launch({
    headless: "shell",
    args: ["--no-sandbox"],
  });
  for (const [device, width, height] of [
    ["desktop", 1440, 1000],
    ["mobile", 390, 844],
  ]) {
    const page = await browser.newPage();
    await page.setBypassServiceWorker(true);
    await page.setViewport({ width, height });
    page.setDefaultTimeout(30_000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const searches = [];
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (/https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(request.url())) {
        void request.abort();
      } else if (
        request.method() === "POST" ||
        /\/r\/api\/search/.test(request.url())
      ) {
        searches.push(request.url());
        void request.abort();
      } else {
        void request.continue();
      }
    });
    const capture = async (name) => {
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      );
      await page.screenshot({ path: `${screenshots}/${device}-${name}.png` });
    };
    // First visit pins the saved location used by the homepage reader.
    await page.goto(`${base}/reader/${passage.id}`, {
      waitUntil: "networkidle2",
    });
    await page.waitForSelector(
      `[data-passage-id="${passage.id}"] .reader-passage-button`
    );
    for (const [route, pathname] of [
      ["reader", `/reader/${passage.id}`],
      ["home", "/?reader=scripture"],
    ]) {
      await page.goto(`${base}${pathname}`, { waitUntil: "networkidle2" });
      const selected = `[data-passage-id="${passage.id}"]`;
      await page.waitForSelector(`${selected} .reader-passage-button`);
      await page.click(`${selected} .reader-passage-button`);
      assert.deepEqual(
        await page.$$eval(
          `${selected} .reader-passage-actions button`,
          (buttons) => buttons.map((button) => button.textContent.trim())
        ),
        ["Similar passages", "View commentaries"]
      );
      const button = await page.$(
        `${selected} .reader-passage-actions > button`
      );
      await button.evaluate((node) => node.scrollIntoView({ block: "center" }));
      await capture(`${route}-action`);
      const lookupPromise = page.waitForResponse((response) =>
        response.url().includes("/api/classic-commentary?")
      );
      await button.click();
      const response = await lookupPromise;
      assert.equal(response.status(), 200);
      const lookup = new URL(response.url());
      assert.equal(lookup.searchParams.get("book"), "Matthew");
      assert.equal(lookup.searchParams.get("chapter"), "5");
      assert.equal(
        Number(lookup.searchParams.get("verseStart")),
        passage.verses[0].number
      );
      assert.equal(
        Number(lookup.searchParams.get("verseEnd")),
        passage.verses.at(-1).number
      );
      const payload = await response.json();
      assert.deepEqual(payload.works.map((work) => work.id).sort(), [
        "classics:catena",
        "classics:henry",
        "classics:wesley",
      ]);
      await page.waitForSelector(
        ".classic-commentary-notes .reader-passage-button"
      );
      assert.equal(await page.$(".search-modal"), null);
      assert.match(
        await page.$eval(
          "#classic-commentary-title",
          (node) => node.textContent
        ),
        /^Commentaries on Matthew 5:1/
      );
      for (const work of payload.works) {
        await page.select(".classic-commentary-select select", work.id);
        await page.waitForFunction(
          (title) =>
            document.querySelector(".classic-commentary-source h3")
              ?.textContent === title,
          {},
          work.title
        );
        await page.waitForSelector(
          ".classic-commentary-notes .reader-passage-button"
        );
        assert.match(
          await page.$eval(".classic-commentary-open", (node) =>
            node.getAttribute("href")
          ),
          /christian-classics\/read/
        );
      }
      await capture(`${route}-commentaries`);
      await page.keyboard.press("Escape");
      assert.equal(await page.$(".classic-commentary-dialog"), null);
      // The old similarity action remains independent and still targets Scripture.
      assert.equal(
        await page.$eval(
          `${selected} input[name="intent"]`,
          (node) => node.value
        ),
        "similar-passage"
      );
      assert.deepEqual(
        searches,
        [],
        "Commentary lookup never performs similarity search"
      );
      console.log(
        `${device} ${route}: exactly two actions, indexed verse matches, all commentators and dismissal passed`
      );
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally {
  await browser?.close();
  for (const server of servers) server.kill();
}
