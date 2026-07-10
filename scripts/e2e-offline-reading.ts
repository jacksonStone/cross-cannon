import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";

import puppeteer, { type Page } from "puppeteer";

const manageServer = process.env.E2E_MANAGE_SERVER === "1";
const managedPort = Number(process.env.E2E_PORT ?? (30_000 + (process.pid % 10_000)));
const baseUrl = (
  process.env.E2E_BASE_URL
  ?? `http://127.0.0.1:${manageServer ? managedPort : 3005}`
).replace(/\/$/, "");
const timeoutMs = Number(process.env.E2E_TIMEOUT_MS ?? 30_000);
let managedServer: ChildProcess | null = null;
const failedRequests: string[] = [];
const browserErrors: string[] = [];
const errorResponses: string[] = [];

if (manageServer) {
  managedServer = spawn(
    path.resolve("node_modules/.bin/remix-serve"),
    ["./build/server/index.js"],
    {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(managedPort)
    },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  await waitForServer(baseUrl, managedServer, timeoutMs);
}

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"]
});

try {
  const page = await browser.newPage();
  page.on("requestfailed", (request) => failedRequests.push(
    `${request.url()} (${request.failure()?.errorText ?? "failed"})`
  ));
  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => browserErrors.push(
    error instanceof Error ? error.message : String(error)
  ));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      errorResponses.push(`${response.status()} ${response.url()}`);
    }
  });
  page.setDefaultTimeout(timeoutMs);
  await page.setViewport({ height: 844, width: 390 });
  await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".reader-page");
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/cross-canon-sw.js");
    await navigator.serviceWorker.ready;
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".reader-page");

  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), {
    timeout: 5_000
  });

  await page.waitForSelector("#reader-title");
  const scriptureChapter = await page.$eval("#reader-title", (heading) => (
    heading.textContent?.trim() ?? ""
  ));
  await openReaderTools(page);
  await clickButtonByText(page, "Jump");
  await page.waitForSelector(".passage-jump-verse");
  const scriptureReaderUrl = await page.$eval(".passage-jump-verse", (link) => (
    (link as HTMLAnchorElement).href
  ));
  const downloadedWorkUrl = `${baseUrl}/church-fathers?chapter=anf05%3Aiv.vi.i`;
  await page.goto(downloadedWorkUrl, {
    waitUntil: "domcontentloaded"
  });
  await page.waitForSelector("#reader-title");
  const unavailableWorkUrl = await captureAnotherWorkUrl(page);
  const canceledWorkTitle = await page.$eval("#reader-title", (heading) => (
    heading.textContent?.trim() ?? ""
  ));
  await openReaderTools(page);
  await installDelayedChapterFetch(page);
  await clickButtonByText(page, "Download work");
  await page.waitForFunction(() => document.body.textContent?.includes("Downloading"));
  await page.$eval("button[aria-label='Close reader tools']", (button) => (
    (button as HTMLButtonElement).click()
  ));
  await openReaderTools(page);
  await clickButtonByText(page, "Jump");
  await page.waitForSelector(".ec-jump-modal");
  await chooseAnotherWorkInOpenJump(page);
  await openReaderTools(page);
  const competingDownloadState = await page.evaluate(() => {
    const downloadButton = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Download work");

    return {
      disabled: downloadButton?.disabled ?? false,
      status: document.querySelector(".offline-download-status")?.textContent?.trim() ?? ""
    };
  });
  assert(
    competingDownloadState.disabled
      && competingDownloadState.status.includes("Downloading"),
    `Expected the active Work download to follow navigation and lock a second download: ${JSON.stringify(competingDownloadState)}`
  );
  await clickButtonByText(page, "Cancel download");
  const cancellationReleasedLock = await waitForEnabledButton(page, "Download work", 10_000);
  assert(cancellationReleasedLock, "Expected cancellation to release the download lock.");
  await restoreDelayedChapterFetch(page);
  await page.goto(downloadedWorkUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#reader-title");
  const downloadedWorkTitle = await page.$eval("#reader-title", (heading) => (
    heading.textContent?.trim() ?? ""
  ));
  await openReaderTools(page);
  await installQuotaAndPersistenceFailure(page);
  await clickButtonByText(page, "Download work");
  await page.waitForFunction(() => document.body.textContent?.includes("Not enough storage"));
  await page.waitForFunction(() => (
    [...document.querySelectorAll("button")].some((button) => (
      button.textContent?.trim() === "Retry download"
    ))
  ));
  await restoreCacheWrites(page);
  await clickButtonByText(page, "Retry download");
  const quotaRetryCompleted = await page.waitForFunction(() => (
    [...document.querySelectorAll("button")].some((button) => (
      button.textContent?.includes("Remove download")
    ))
  ), { timeout: 15_000 }).then(() => true).catch(() => false);
  if (!quotaRetryCompleted) {
    const retryState = await page.evaluate(() => ({
      body: document.body.textContent?.trim().slice(0, 600),
      buttons: [...document.querySelectorAll("button")].map((button) => (
        button.textContent?.trim()
      )),
      records: localStorage.getItem("cross-cannon:offline-early-christian-works:v1")
    }));
    throw new Error(`Quota retry did not complete: ${JSON.stringify(retryState)}`);
  }
  await page.waitForFunction(() => document.body.textContent?.includes("Available offline"));
  await page.$eval("button[aria-label='Search']", (button) => (
    (button as HTMLButtonElement).click()
  ));
  await page.waitForSelector(".search-modal");
  await page.type("textarea[name='question']", "hope in suffering");

  browserErrors.length = 0;
  errorResponses.length = 0;
  failedRequests.length = 0;

  if (managedServer) {
    await stopServer(managedServer);
    await waitForServerStop(baseUrl, timeoutMs);
    managedServer = null;
  } else {
    await page.setOfflineMode(true);
  }

  await page.$eval(".search-button", (button) => (
    (button as HTMLButtonElement).click()
  ));
  await page.waitForSelector(".offline-indicator");
  await page.waitForSelector(".search-modal", { hidden: true });
  await stagePriorCompleteWorkVersion(page);

  await page.goto(scriptureReaderUrl, {
    waitUntil: "domcontentloaded"
  });
  const scriptureReaderOpened = await page.waitForSelector("#reader h1, #reader-title", {
    timeout: 5_000
  }).then(() => true).catch(() => false);
  if (!scriptureReaderOpened) {
    const scriptureDiagnostic = await page.evaluate(async () => ({
      body: document.body.innerHTML.slice(0, 1_000),
      cacheKeys: (await caches.keys()),
      scripts: [...document.scripts].map((script) => script.src || "inline"),
      title: document.title,
      url: location.href
    }));
    throw new Error(`Offline Scripture Reader Link failed: ${JSON.stringify({
      browserErrors,
      errorResponses: [...new Set(errorResponses)],
      failedRequests: [...new Set(failedRequests)],
      scriptureDiagnostic
    })}`);
  }
  const offlineScriptureTitle = await page.$eval("#reader h1, #reader-title", (heading) => (
    heading.textContent ?? ""
  ));
  assert(
    offlineScriptureTitle.includes(scriptureChapter),
    `Expected offline Reader Link ${scriptureChapter}, got ${offlineScriptureTitle}.`
  );

  await page.goto(downloadedWorkUrl, {
    waitUntil: "domcontentloaded"
  });
  if (!manageServer) {
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  }
  const hydratedOfflineReader = await waitForReaderTools(page, 15_000);
  if (!hydratedOfflineReader) {
    const pageState = await page.evaluate(() => ({
      bodyText: document.body.textContent?.trim().slice(0, 500) ?? "",
      hasEntryScript: [...document.scripts].some((script) => (
        script.textContent?.includes("entry.client")
      )),
      hasReaderToolsTrigger: Boolean(document.querySelector(
        "button[aria-label='Open reader tools']"
      )),
      readyState: document.readyState,
      routeModuleIds: Object.keys((window as Window & {
        __remixRouteModules?: Record<string, unknown>;
      }).__remixRouteModules ?? {})
    }));
    throw new Error(`Offline reader did not hydrate: ${JSON.stringify({
      browserErrors,
      errorResponses: [...new Set(errorResponses)],
      failedRequests: [...new Set(failedRequests)].slice(0, 20),
      pageState
    })}`);
  }
  const hasOfflineIndicator = await page.waitForSelector(".offline-indicator", {
    timeout: 15_000
  }).then(() => true).catch(() => false);

  if (!hasOfflineIndicator) {
    const diagnostic = await page.evaluate(() => ({
      bodyText: document.body.textContent?.trim().slice(0, 240) ?? "",
      controlled: Boolean(navigator.serviceWorker?.controller),
      hasOfflineFallback: Boolean(document.querySelector(".offline")),
      online: navigator.onLine,
      title: document.title,
      url: location.href
    }));
    throw new Error(`Offline indicator missing: ${JSON.stringify(diagnostic)}`);
  }
  await page.waitForSelector("#reader-title");

  const offlineControls = await page.evaluate(() => ({
    hasAudio: Boolean(document.querySelector("button[aria-label*='audio']")),
    hasSearch: Boolean(document.querySelector("button[aria-label='Search']")),
    hasSimilar: document.body.textContent?.includes("Similar passages") ?? false,
    indicator: document.querySelector(".offline-indicator")?.outerHTML ?? "",
    search: document.querySelector("button[aria-label='Search']")?.outerHTML ?? "",
    tools: document.querySelector(".reader-header-actions")?.textContent?.trim() ?? ""
  }));

  assert(!offlineControls.hasAudio, "Expected Audio to be removed offline.");
  assert(!offlineControls.hasSearch, `Expected Search to be removed offline: ${JSON.stringify(offlineControls)}`);
  assert(!offlineControls.hasSimilar, "Expected Similar Passages to be removed offline.");

  await clickButtonByText(page, "Jump");
  await page.waitForSelector(".ec-jump-modal");
  const offlineWorkCount = await page.$$eval(".ec-work-option", (works) => works.length);
  assert(offlineWorkCount === 1, `Expected one downloaded Work offline, got ${offlineWorkCount}.`);
  await clickButtonByText(page, "Close");

  await page.goto(unavailableWorkUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".reader-empty");
  const unavailableState = await page.$eval(".reader-empty", (state) => (
    state.textContent?.trim() ?? ""
  ));
  assert(
    unavailableState.includes("isn’t available offline")
      && unavailableState.includes("Open downloaded works"),
    `Expected an explicit unavailable Work state, got ${unavailableState}.`
  );
  assert(page.url() === unavailableWorkUrl, "Expected the unavailable Reader Link to remain intact.");

  await page.evaluate((unavailableUrl) => {
    const chapterKey = new URL(unavailableUrl).searchParams.get("chapter") ?? "";
    localStorage.setItem(
      "cross-cannon:church-fathers-position:v1",
      JSON.stringify({ chapterKey, corpus: "fathers", version: 2 })
    );
  }, unavailableWorkUrl);
  await page.goto(`${baseUrl}/church-fathers`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction((expectedTitle) => (
    document.querySelector("#reader-title")?.textContent?.trim() === expectedTitle
  ), {}, downloadedWorkTitle);

  await page.setViewport({ height: 800, width: 1280 });
  const desktopOfflineLayout = await page.evaluate(() => {
    const indicator = document.querySelector<HTMLElement>(".offline-indicator");
    const reader = document.querySelector<HTMLElement>(".reader-shell");
    const indicatorRect = indicator?.getBoundingClientRect();
    const readerPaddingBottom = reader
      ? Number.parseFloat(getComputedStyle(reader).paddingBottom)
      : 0;

    return {
      indicatorBottom: indicatorRect?.bottom ?? Number.POSITIVE_INFINITY,
      indicatorRight: indicatorRect?.right ?? Number.POSITIVE_INFINITY,
      readerPaddingBottom
    };
  });
  assert(
    desktopOfflineLayout.indicatorBottom <= 800
      && desktopOfflineLayout.indicatorRight <= 1280
      && desktopOfflineLayout.readerPaddingBottom >= 48,
    `Expected the desktop Offline indicator to stay clear of reader content: ${JSON.stringify(desktopOfflineLayout)}`
  );

  await openReaderTools(page);
  page.once("dialog", (dialog) => dialog.accept());
  await clickButtonByText(page, "Remove download");
  await page.waitForFunction(() => location.pathname === "/");
  await page.waitForSelector(".reader-page");

  await page.goto(`${baseUrl}/church-fathers`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".reader-empty");
  const emptyState = await page.$eval(".reader-empty", (state) => state.textContent?.trim() ?? "");
  assert(
    emptyState.includes("No Early Christian works are available offline"),
    `Expected the no-download offline state, got ${emptyState}.`
  );

  console.log(JSON.stringify({
    emptyState: true,
    downloadLifecycle: canceledWorkTitle,
    offlineWorkCount,
    passed: true,
    priorCompleteVersion: true,
    quotaRecovery: true,
    scripture: scriptureChapter,
    unavailableWork: true
  }, null, 2));
} finally {
  await browser.close();
  if (managedServer) {
    await stopServer(managedServer);
  }
}

async function openReaderTools(page: Page) {
  const clicked = await page.$eval(
    "button[aria-label='Open reader tools']",
    (trigger) => {
      (trigger as HTMLButtonElement).click();
      return true;
    }
  ).catch(() => false);

  assert(clicked, "Expected the reader tools trigger.");
}

async function captureAnotherWorkUrl(page: Page) {
  const currentUrl = page.url();
  await openReaderTools(page);
  await clickButtonByText(page, "Jump");
  await page.waitForSelector(".ec-jump-modal");
  await chooseAnotherWorkInOpenJump(page);
  await page.waitForFunction((url) => location.href !== url, {}, currentUrl);
  return page.url();
}

async function chooseAnotherWorkInOpenJump(page: Page) {
  const choseAnotherWork = await page.evaluate(() => {
    const option = [...document.querySelectorAll<HTMLElement>(".ec-work-option")]
      .find((candidate) => !candidate.classList.contains("is-selected"));
    option?.querySelector<HTMLButtonElement>(".ec-work-select")?.click();
    return Boolean(option);
  });
  assert(choseAnotherWork, "Expected another Early Christian Work in Jump.");
  await wait(100);
  const choseChapter = await page.evaluate(() => {
    const chapter = document.querySelector<HTMLButtonElement>(
      ".passage-jump-group[aria-label='Chapter'] button"
    );
    chapter?.click();
    return Boolean(chapter);
  });
  assert(choseChapter, "Expected a Chapter in the other Work.");
}

async function installDelayedChapterFetch(page: Page) {
  await page.evaluate(() => {
    const scope = window as typeof window & {
      __crossCanonOriginalCacheMatch?: typeof Cache.prototype.match;
      __crossCanonOriginalFetch?: typeof window.fetch;
    };
    const originalFetch = window.fetch;
    const originalMatch = Cache.prototype.match;
    scope.__crossCanonOriginalCacheMatch = originalMatch;
    scope.__crossCanonOriginalFetch = originalFetch;
    Cache.prototype.match = function(request, options) {
      const url = typeof request === "string"
        ? request
        : request instanceof Request
          ? request.url
          : request.href;

      if (url.includes("/church-fathers-preview/chapters/")) {
        return Promise.resolve(undefined);
      }

      return originalMatch.call(this, request, options);
    };
    window.fetch = (input, init) => {
      const url = typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : input.href;

      if (!url.includes("/church-fathers-preview/chapters/")) {
        return originalFetch(input, init);
      }

      return new Promise<Response>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          void originalFetch(input, init).then(resolve, reject);
        }, 10_000);
        init?.signal?.addEventListener("abort", () => {
          window.clearTimeout(timer);
          reject(new DOMException("Download canceled", "AbortError"));
        }, { once: true });
      });
    };

    try {
      Object.defineProperty(navigator.storage, "persisted", {
        configurable: true,
        value: async () => false
      });
      Object.defineProperty(navigator.storage, "persist", {
        configurable: true,
        value: async () => {
          throw new DOMException("Persistence denied", "NotAllowedError");
        }
      });
    } catch {
      // Persistence is optional and some engines expose non-configurable methods.
    }
  });
}

async function restoreDelayedChapterFetch(page: Page) {
  await page.evaluate(() => {
    const scope = window as typeof window & {
      __crossCanonOriginalCacheMatch?: typeof Cache.prototype.match;
      __crossCanonOriginalFetch?: typeof window.fetch;
    };

    if (scope.__crossCanonOriginalCacheMatch) {
      Cache.prototype.match = scope.__crossCanonOriginalCacheMatch;
      delete scope.__crossCanonOriginalCacheMatch;
    }

    if (scope.__crossCanonOriginalFetch) {
      window.fetch = scope.__crossCanonOriginalFetch;
      delete scope.__crossCanonOriginalFetch;
    }
  });
}

async function installQuotaAndPersistenceFailure(page: Page) {
  await page.evaluate(() => {
    const scope = window as typeof window & {
      __crossCanonOriginalCacheMatch?: typeof Cache.prototype.match;
      __crossCanonOriginalCachePut?: typeof Cache.prototype.put;
    };
    const originalMatch = Cache.prototype.match;
    const originalPut = Cache.prototype.put;
    scope.__crossCanonOriginalCacheMatch = originalMatch;
    scope.__crossCanonOriginalCachePut = originalPut;
    Cache.prototype.match = function(request, options) {
      const url = typeof request === "string"
        ? request
        : request instanceof Request
          ? request.url
          : request.href;

      if (url.includes("/church-fathers-preview/chapters/")) {
        return Promise.resolve(undefined);
      }

      return originalMatch.call(this, request, options);
    };
    Cache.prototype.put = function(request, response) {
      const url = typeof request === "string"
        ? request
        : request instanceof Request
          ? request.url
          : request.href;

      if (url.includes("/church-fathers-preview/chapters/")) {
        return Promise.reject(new DOMException("Quota reached", "QuotaExceededError"));
      }

      return originalPut.call(this, request, response);
    };

    try {
      Object.defineProperty(navigator.storage, "persisted", {
        configurable: true,
        value: async () => false
      });
      Object.defineProperty(navigator.storage, "persist", {
        configurable: true,
        value: async () => {
          throw new DOMException("Persistence denied", "NotAllowedError");
        }
      });
    } catch {
      // Persistence is optional and some engines expose non-configurable methods.
    }
  });
}

async function restoreCacheWrites(page: Page) {
  await page.evaluate(() => {
    const scope = window as typeof window & {
      __crossCanonOriginalCacheMatch?: typeof Cache.prototype.match;
      __crossCanonOriginalCachePut?: typeof Cache.prototype.put;
    };

    if (scope.__crossCanonOriginalCacheMatch) {
      Cache.prototype.match = scope.__crossCanonOriginalCacheMatch;
      delete scope.__crossCanonOriginalCacheMatch;
    }

    if (scope.__crossCanonOriginalCachePut) {
      Cache.prototype.put = scope.__crossCanonOriginalCachePut;
      delete scope.__crossCanonOriginalCachePut;
    }
  });
}

async function stagePriorCompleteWorkVersion(page: Page) {
  await page.evaluate(async () => {
    const storageKey = "cross-cannon:offline-early-christian-works:v1";
    const records = JSON.parse(localStorage.getItem(storageKey) ?? "{}") as Record<
      string,
      { chapterUrls: string[]; complete?: boolean; version: string }
    >;
    const cache = await caches.open("cross-canon-content-v1");

    for (const record of Object.values(records)) {
      const priorUrls: string[] = [];

      for (const chapterUrl of record.chapterUrls) {
        const response = await cache.match(chapterUrl);
        if (!response) {
          throw new Error(`Expected completed Chapter ${chapterUrl} before staging.`);
        }
        const priorUrl = new URL(chapterUrl, location.origin);
        priorUrl.searchParams.set("v", "prior-complete-version");
        await cache.put(priorUrl.href, response.clone());
        await cache.delete(chapterUrl);
        priorUrls.push(priorUrl.href);
      }

      record.chapterUrls = priorUrls;
      record.complete = true;
      record.version = "prior-complete-version";
    }

    localStorage.setItem(storageKey, JSON.stringify(records));
  });
}

async function waitForReaderTools(page: Page, timeout: number) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    const state = await page.evaluate(() => {
      if (document.querySelector(".reader-header-actions")) {
        return "open";
      }

      const trigger = document.querySelector<HTMLButtonElement>(
        "button[aria-label='Open reader tools']"
      );
      trigger?.click();
      return trigger ? "opening" : "missing";
    }).catch(() => "navigating");

    if (state === "open") {
      return true;
    }

    await wait(100);
  }

  return false;
}

async function waitForEnabledButton(page: Page, text: string, timeout: number) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    const isEnabled = await page.evaluate((label) => (
      [...document.querySelectorAll<HTMLButtonElement>("button")].some((button) => (
        button.textContent?.trim() === label && !button.disabled
      ))
    ), text).catch(() => false);

    if (isEnabled) {
      return true;
    }

    await wait(100);
  }

  return false;
}

async function clickButtonByText(page: Page, text: string) {
  const clicked = await page.evaluate((text: string) => {
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((candidate) => candidate.textContent?.trim() === text);
    button?.click();
    return Boolean(button);
  }, text);

  assert(clicked, `Expected a button labelled “${text}”.`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function waitForServer(url: string, server: ChildProcess, timeout: number) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    if (server.exitCode !== null) {
      throw new Error(`Managed E2E server exited with code ${server.exitCode}.`);
    }

    try {
      const response = await fetch(url, { method: "HEAD" });
      if (response.ok) {
        return;
      }
    } catch {
      // The production server is still starting.
    }

    await wait(200);
  }

  throw new Error(`Timed out waiting for managed E2E server at ${url}.`);
}

async function stopServer(server: ChildProcess) {
  if (server.exitCode !== null) {
    return;
  }

  server.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => server.once("exit", () => resolve())),
    wait(5_000).then(() => undefined)
  ]);
}

async function waitForServerStop(url: string, timeout: number) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    try {
      await fetch(`${url}/?offline-stop-check=${Date.now()}`, {
        cache: "no-store",
        method: "HEAD"
      });
    } catch {
      return;
    }

    await wait(100);
  }

  throw new Error(`Managed E2E server remained reachable at ${url}.`);
}
