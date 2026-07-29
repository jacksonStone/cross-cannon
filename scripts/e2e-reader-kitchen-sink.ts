import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import puppeteer, { type Browser, type Page } from "puppeteer";

const baseUrl = (process.env.E2E_BASE_URL ?? "http://127.0.0.1:3005").replace(/\/$/, "");
const headless = process.env.E2E_HEADLESS !== "0";
const slowMo = Number(process.env.E2E_SLOW_MO_MS ?? 0);
const timeoutMs = Number(process.env.E2E_TIMEOUT_MS ?? 90000);
const searchDelayMs = Number(process.env.E2E_SEARCH_DELAY_MS ?? 750);
const requestFailureSummary = new Map<string, number>();
let e2eClientIpCounter = 30;

type StepResult = {
  ms: number;
  name: string;
};

type SearchActionResponse = {
  error: string;
  resultCount: number;
};

type SearchActionBody = {
  earlyChristianResults?: unknown[];
  error?: string;
  results?: unknown[];
  scriptureResults?: unknown[];
};

const stepResults: StepResult[] = [];

async function main() {
  let browser: Browser | null = null;

  try {
    browser = await puppeteer.launch({
      headless,
      protocolTimeout: timeoutMs,
      slowMo,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(timeoutMs);
    page.setDefaultNavigationTimeout(timeoutMs);
    await page.setViewport({ height: 920, width: 1280 });
    attachDiagnostics(page);

    await step("Bible: load reader", () => loadBible(page));
    await step("Bible: cross chapter boundary down and up", () => crossBibleChapterBoundary(page));
    await step("Bible: persisted spot survives Fathers switch", () => exerciseBiblePositionPersistence(page));
    await step("Bible: passage position updates and restores within a chapter", () => exerciseBiblePassagePositionPersistence(page));
    await step("Bible: explicit jump supports Back", () => exerciseBibleJumpHistory(page));
    await step("Bible: theme search, similar search, jump result", () => exerciseBibleSearch(page));
    await step("Bible: selected passage similar search", () => exerciseBibleReaderPassageSimilar(page));
    await step("Fathers: invalid bookmark falls back to first work", () => exerciseFathersPositionFallback(page));
    await step("Fathers: jump picker to work and chapter", () => jumpToFathersWork(page));
    await step("Fathers: cross chapter boundary down and up", () => crossFathersChapterBoundary(page));
    await step("Fathers: theme search and jump result", () => exerciseFathersThemeSearch(page));
    await step("Fathers: selected passage similar search and jump result", () => exerciseFathersPassageSimilar(page));

    console.log(JSON.stringify({
      baseUrl,
      headless,
      passed: true,
      requestFailures: Object.fromEntries(requestFailureSummary),
      steps: stepResults
    }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  } finally {
    await browser?.close();
  }
}

async function step(name: string, action: () => Promise<void>) {
  const started = performance.now();
  console.log(`==> ${name}`);

  try {
    await action();
  } finally {
    stepResults.push({
      ms: roundMs(performance.now() - started),
      name
    });
  }
}

async function loadBible(page: Page) {
  await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    window.localStorage.removeItem("cross-cannon:reader-position:v1");
    window.localStorage.removeItem("cross-cannon:church-fathers-position:v1");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForReader(page, "Genesis");
}

async function crossBibleChapterBoundary(page: Page) {
  await assertReaderHealthy(page);
  const initialTitle = await readerTitle(page);

  await scrollUntilTitleChanges(page, initialTitle, "down");
  const nextTitle = await readerTitle(page);
  await scrollUntilTitleChanges(page, nextTitle, "up");

  await assertReaderHealthy(page);
}

async function exerciseBiblePositionPersistence(page: Page) {
  await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
  const psalm149ChapterKey = await page.evaluate(async () => {
    const cacheKey = document
      .querySelector("data[data-scripture-cache-key]")
      ?.getAttribute("value");

    if (!cacheKey) {
      return "";
    }

    const response = await fetch(`/scripture-cache/${cacheKey}.json`);
    const cache: unknown = await response.json();

    if (
      !cache
      || typeof cache !== "object"
      || !Array.isArray((cache as { passages?: unknown }).passages)
    ) {
      return "";
    }

    const passages = (cache as { passages: Array<{ id?: unknown; reference?: unknown }> })
      .passages;
    const psalm149 = passages.find((passage) => (
      passage.reference === "Psalms 149:1-7"
      || (typeof passage.reference === "string" && passage.reference.startsWith("Psalms 149:"))
    ));

    if (!psalm149) {
      return "";
    }

    window.localStorage.setItem("cross-cannon:reader-position:v1", "Psalms\t149");
    window.localStorage.setItem("cross-cannon:last-reader:v1", "scripture");
    window.localStorage.removeItem("cross-cannon:church-fathers-position:v1");
    return "Psalms\t149";
  });

  assert(psalm149ChapterKey, "Could not find Psalm 149 in scripture cache.");
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForReader(page, "Psalms");
  await waitForReaderTitle(page, "Psalms 149");
  await page.goto(`${baseUrl}/church-fathers`, { waitUntil: "domcontentloaded" });
  await waitForReader(page, "Early Christian");
  await simulateUserScroll(page, 900);

  const savedChapterKey = await page.evaluate(() => {
    const rawValue = window.localStorage.getItem("cross-cannon:reader-position:v1") ?? "";

    try {
      const parsedValue: unknown = JSON.parse(rawValue);

      if (parsedValue && typeof parsedValue === "object") {
        const chapterKey = (parsedValue as { chapterKey?: unknown }).chapterKey;
        return typeof chapterKey === "string" ? chapterKey : rawValue;
      }

      return rawValue;
    } catch {
      return rawValue;
    }
  });

  assert(
    savedChapterKey === "Psalms\t149",
    `Expected saved Bible chapter to remain Psalms 149, got "${savedChapterKey}".`
  );

  await page.goto(`${baseUrl}/?reader=scripture`, { waitUntil: "domcontentloaded" });
  await waitForReader(page, "Psalms");
  await waitForReaderTitle(page, "Psalms 149");
  await assertReaderHealthy(page);
}

async function exerciseBiblePassagePositionPersistence(page: Page) {
  await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
  const targetPassageId = await page.evaluate(async () => {
    const cacheKey = document
      .querySelector("data[data-scripture-cache-key]")
      ?.getAttribute("value");

    if (!cacheKey) {
      return "";
    }

    const response = await fetch(`/scripture-cache/${cacheKey}.json`);
    const cache: unknown = await response.json();

    if (
      !cache
      || typeof cache !== "object"
      || !Array.isArray((cache as { passages?: unknown }).passages)
    ) {
      return "";
    }

    const passage = (cache as {
      passages: Array<{ id?: unknown; reference?: unknown }>;
    }).passages.find((candidate) => candidate.reference === "Psalms 149:8-9");

    if (!passage || typeof passage.id !== "string") {
      return "";
    }

    window.localStorage.setItem(
      "cross-cannon:reader-position:v1",
      JSON.stringify({
        chapterKey: "Psalms\t149",
        corpus: "scripture",
        version: 2
      })
    );
    return passage.id;
  });

  assert(targetPassageId, "Could not find Psalms 149:8-9 in scripture cache.");
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForReaderTitle(page, "Psalms 149");
  await page.waitForSelector(`[data-passage-id="${targetPassageId}"]`, { visible: true });
  await page.evaluate((passageId) => {
    const passage = document.querySelector<HTMLElement>(
      `[data-passage-id="${passageId}"]`
    );

    if (!passage) {
      throw new Error("Target passage is missing.");
    }

    window.scrollTo({
      behavior: "auto",
      top: passage.getBoundingClientRect().top + window.scrollY - 170
    });
    window.dispatchEvent(new Event("scroll"));
  }, targetPassageId);
  await wait(250);

  const savedLocation = await page.evaluate(() => {
    const storedValue = window.localStorage.getItem(
      "cross-cannon:reader-position:v1"
    );

    return storedValue ? JSON.parse(storedValue) : null;
  });

  assert(
    savedLocation?.passageKey === targetPassageId,
    "Expected reading within Psalms 149 to update the saved passage."
  );

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForReaderTitle(page, "Psalms 149");
  await page.waitForSelector(`[data-passage-id="${targetPassageId}"]`, { visible: true });

  const targetTop = await page.$eval(
    `[data-passage-id="${targetPassageId}"]`,
    (passage) => Math.round(passage.getBoundingClientRect().top)
  );

  assert(
    targetTop >= 80 && targetTop <= 220,
    `Expected the saved passage near the reading header, got ${targetTop}px.`
  );
}

async function simulateUserScroll(page: Page, deltaY: number) {
  await page.evaluate((deltaY) => {
    window.scrollBy({
      behavior: "auto",
      top: deltaY
    });
    window.dispatchEvent(new Event("scroll"));
  }, deltaY);
  await wait(250);
}

async function exerciseBibleJumpHistory(page: Page) {
  await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
  await waitForReader(page, "Scripture");
  const beforeJumpUrl = page.url();

  await openReaderTools(page);
  await clickButtonByText(
    page,
    ".reader-header-actions .passage-jump-launcher button",
    "Jump"
  );
  await page.waitForSelector(".passage-jump-modal", { visible: true });
  await page.waitForSelector(".passage-jump-verse", { visible: true });
  const jumpUrl = await page.$eval(
    ".passage-jump-verse",
    (link) => (link as HTMLAnchorElement).href
  );
  await page.goto(jumpUrl, { waitUntil: "domcontentloaded" });
  console.log(`    jumped to ${page.url()}`);
  await expectReaderPassages(page);
  console.log("    direct Reader Location rendered");
  assert(
    new URL(page.url()).pathname.startsWith("/reader/"),
    `Expected Scripture jump URL, got ${page.url()}.`
  );

  await page.evaluate(() => window.history.back());
  await page.waitForFunction((url) => location.href === url, {
    timeout: timeoutMs
  }, beforeJumpUrl);
  console.log(`    Back restored ${page.url()}`);
  await expectReaderPassages(page);
  assert(page.url() === beforeJumpUrl, `Expected Back to restore ${beforeJumpUrl}, got ${page.url()}.`);
}

async function exerciseFathersPositionFallback(page: Page) {
  await page.goto(`${baseUrl}/church-fathers`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    window.localStorage.setItem("cross-cannon:church-fathers-position:v1", "not-a-valid-chapter");
    window.localStorage.setItem("cross-cannon:last-reader:v1", "fathers");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForReader(page, "Early Christian");
  await waitForReader(page, "First Epistle of Clement");

  const state = await page.evaluate(() => {
    const rawValue = window.localStorage.getItem("cross-cannon:church-fathers-position:v1") ?? "";
    let savedChapterId = rawValue;

    try {
      const parsedValue: unknown = JSON.parse(rawValue);

      if (parsedValue && typeof parsedValue === "object") {
        const chapterKey = (parsedValue as { chapterKey?: unknown }).chapterKey;
        savedChapterId = typeof chapterKey === "string" ? chapterKey : rawValue;
      } else {
        savedChapterId = rawValue;
      }
    } catch {
      savedChapterId = rawValue;
    }

    return {
      firstRenderedChapterId: document
        .querySelector<HTMLElement>(".ec-reader-chapter")
        ?.dataset.chapterId ?? "",
      savedChapterId,
      title: document.querySelector("#reader-title")?.textContent?.trim() ?? ""
    };
  });

  assert(
    state.savedChapterId
      && state.savedChapterId !== "not-a-valid-chapter"
      && state.savedChapterId === state.firstRenderedChapterId,
    `Expected invalid Fathers bookmark to be replaced by first rendered chapter, got ${JSON.stringify(state)}.`
  );
  assert(
    state.title.includes("First Epistle of Clement"),
    `Expected Fathers fallback title to be Clement, got "${state.title}".`
  );
}

async function exerciseBibleSearch(page: Page) {
  await openReaderTools(page);
  await click(page, ".reader-header-actions button[aria-label='Search']");
  const hasThemeResults = await themeSearch(page, "fear and comfort", ".results .scripture-result");

  if (!hasThemeResults) {
    console.warn("Skipping Bible theme-result actions: local theme search returned no results.");
    await closeSearchModal(page);
    await assertReaderHealthy(page);
    return;
  }

  await expandResult(page, ".results .scripture-result", 0);
  const similarResponse = await clickResultAction(page, ".results .scripture-result", 0, "Similar passages");

  if (!await continueIfSearchHasResults(page, similarResponse, "Bible result similarity")) {
    return;
  }

  await waitForSearchIdle(page, ".results .scripture-result");
  await waitForBibleSimilarHeading(page);
  await expandResult(page, ".results .scripture-result", 0);
  await clickResultAction(page, ".results .scripture-result", 0, "Jump to");
  await waitForModalClosed(page);
  await expectReaderPassages(page);
  await assertReaderHealthy(page);
}

async function exerciseBibleReaderPassageSimilar(page: Page) {
  await clickVisiblePassage(page);
  const response = await clickSelectedPassageAction(page, "Similar passages");

  if (!await continueIfSearchHasResults(page, response, "Bible selected-passage similarity")) {
    return;
  }

  await waitForSearchIdle(page, ".results .scripture-result");
  await waitForBibleSimilarHeading(page);
  await expectModalTitle(page, "Find passages");
  await expandResult(page, ".results .scripture-result", 0);
  await clickResultAction(page, ".results .scripture-result", 0, "Jump to");
  await waitForModalClosed(page);
  await expectReaderPassages(page);
}

async function jumpToFathersWork(page: Page) {
  const beforeJumpUrl = page.url();
  await openReaderTools(page);
  await clickButtonByText(page, ".reader-header-actions .passage-jump-launcher button", "Jump");
  await page.waitForSelector(".passage-jump-modal", { visible: true });

  const clickedWork = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>(".ec-work-option")];
    const button = buttons.find((candidate) => (
      candidate.textContent?.includes("Theophilus")
      || candidate.textContent?.includes("Clement")
      || candidate.textContent?.includes("Ignatius")
    )) ?? buttons[1] ?? buttons[0];

    button?.click();
    return Boolean(button);
  });

  assert(clickedWork, "Could not find a Fathers work option to jump to.");
  const titleRecorder = await startReaderTitleRecorder(page);
  await clickChapterButton(page, 2);
  await page.waitForSelector(".passage-jump-modal", { hidden: true });
  await waitForReader(page, "Early Christian");
  await wait(500);
  await assertReaderTitleDidNotFlicker(page, titleRecorder);
  await assertReaderHealthy(page);
  const afterJumpUrl = page.url();

  assert(
    afterJumpUrl !== beforeJumpUrl && afterJumpUrl.includes("chapter="),
    `Expected Early Christian jump URL, got ${afterJumpUrl}.`
  );

  await page.evaluate(() => window.history.back());
  await page.waitForFunction((url) => location.href === url, {
    timeout: timeoutMs
  }, beforeJumpUrl);
  await waitForReader(page, "Early Christian");
  assert(page.url() === beforeJumpUrl, `Expected Back to restore ${beforeJumpUrl}, got ${page.url()}.`);

  await page.evaluate(() => window.history.forward());
  await page.waitForFunction((url) => location.href === url, {
    timeout: timeoutMs
  }, afterJumpUrl);
  await waitForReader(page, "Early Christian");
  assert(page.url() === afterJumpUrl, `Expected Forward to restore ${afterJumpUrl}, got ${page.url()}.`);
}

async function crossFathersChapterBoundary(page: Page) {
  const initialTitle = await readerTitle(page);
  await scrollUntilTitleChanges(page, initialTitle, "down");
  const nextTitle = await readerTitle(page);
  await scrollUntilTitleChanges(page, nextTitle, "up");
  await assertReaderHealthy(page);
}

async function exerciseFathersThemeSearch(page: Page) {
  await openReaderTools(page);
  await click(page, ".reader-header-actions button[aria-label='Search']");
  const hasThemeResults = await themeSearch(page, "unity of the church", ".ec-results .scripture-result");

  if (!hasThemeResults) {
    console.warn("Skipping Fathers theme-result actions: local theme search returned no results.");
    await closeSearchModal(page);
    await assertReaderHealthy(page);
    return;
  }

  await expandResult(page, ".ec-results .scripture-result", 0);
  await clickResultAction(page, ".ec-results .scripture-result", 0, "Jump to");
  await waitForModalClosed(page);
  await expectSelectedPassage(page);
  await assertReaderHealthy(page);
}

async function exerciseFathersPassageSimilar(page: Page) {
  await clickVisiblePassage(page);
  const response = await clickSelectedPassageAction(page, "Similar passages");

  if (!await continueIfSearchHasResults(page, response, "Fathers selected-passage similarity")) {
    return;
  }

  await waitForSearchIdle(page, ".ec-results .scripture-result");
  await expectModalTitle(page, "Find chapters");
  await expandResult(page, ".ec-results .scripture-result", 0);
  await clickResultAction(page, ".ec-results .scripture-result", 0, "Jump to");
  await waitForModalClosed(page);
  await expectSelectedPassage(page);
  await assertReaderHealthy(page);
}

async function themeSearch(page: Page, query: string, resultsSelector: string) {
  await page.waitForSelector(".search-modal textarea[name='question']", { visible: true });
  await setTextareaValue(page, ".search-modal textarea[name='question']", query);
  await rotateE2EClientIp(page);
  const responsePromise = waitForSearchActionResponse(page);
  await Promise.all([
    wait(searchDelayMs),
    click(page, ".search-modal button.search-button")
  ]);
  const response = await responsePromise;

  if (response.error) {
    await saveFailureScreenshot(page);
    throw new Error(`Search failed: ${response.error}`);
  }

  if (response.resultCount === 0) {
    await waitForSearchSettled(page);
    return false;
  }

  await waitForSearchIdle(page, resultsSelector);
  return true;
}

async function setTextareaValue(page: Page, selector: string, value: string) {
  const didSetValue = await page.evaluate(({ selector, value }) => {
    const textarea = document.querySelector<HTMLTextAreaElement>(selector);

    if (!textarea) {
      return false;
    }

    textarea.focus();
    textarea.value = value;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, { selector, value });

  assert(didSetValue, `Could not set ${selector}.`);
}

async function waitForSearchIdle(page: Page, resultsSelector: string) {
  const started = performance.now();
  let lastState: {
    alert: string;
    isBusy: boolean;
    resultCount: number;
    status: string;
    url: string;
  } | null = null;

  while (performance.now() - started < timeoutMs) {
    lastState = await page.evaluate((selector) => ({
      alert: document.querySelector("[role='alert']")?.textContent?.trim() ?? "",
      isBusy: Boolean(document.querySelector(".search-modal [aria-busy='true']")),
      resultCount: document.querySelectorAll(selector).length,
      status: document.querySelector(".search-status")?.textContent?.trim() ?? "",
      url: location.href
    }), resultsSelector);

    if (/Rate limit|unavailable|Failed/i.test(lastState.alert)) {
      await saveFailureScreenshot(page);
      throw new Error(`Search failed at ${lastState.url}: ${lastState.alert}`);
    }

    if (!lastState.isBusy && lastState.resultCount > 0) {
      await assertReaderHealthy(page);
      return;
    }

    await wait(250);
  }

  await saveFailureScreenshot(page);
  throw new Error(`Timed out waiting for search results: ${JSON.stringify(lastState)}`);
}

async function waitForSearchActionResponse(page: Page): Promise<SearchActionResponse> {
  const response = await page.waitForResponse((candidate) => (
    candidate.request().method() === "POST"
    && candidate.url().startsWith(`${baseUrl}/`)
    && candidate.url().includes("_data=")
  ), { timeout: timeoutMs });

  const bodyValue: unknown = await response.json().catch(() => null);
  const body = isSearchActionBody(bodyValue) ? bodyValue : null;

  return {
    error: body?.error ?? "",
    resultCount: Array.isArray(body?.results)
      ? body.results.length
      : Array.isArray(body?.scriptureResults)
      ? body.scriptureResults.length
      : Array.isArray(body?.earlyChristianResults)
      ? body.earlyChristianResults.length
      : 0
  };
}

async function continueIfSearchHasResults(
  page: Page,
  response: SearchActionResponse | null,
  context: string
) {
  if (!response) {
    return true;
  }

  if (response.error) {
    await saveFailureScreenshot(page);
    throw new Error(`${context} failed: ${response.error}`);
  }

  if (response.resultCount === 0) {
    console.warn(`Skipping ${context}: local search returned no results.`);
    await waitForSearchSettled(page);
    await closeSearchModal(page);
    await assertReaderHealthy(page);
    return false;
  }

  return true;
}

async function waitForSearchSettled(page: Page) {
  await page.waitForFunction(() => !document.querySelector(".search-modal [aria-busy='true']"), {
    timeout: timeoutMs
  });
}

async function openReaderTools(page: Page) {
  const hasOpenTools = await page.$(".reader-header-actions");

  if (!hasOpenTools) {
    await click(page, ".reader-header button[aria-label='Open reader tools']");
    await page.waitForSelector(".reader-header-actions", { visible: true });
  }
}

async function clickVisiblePassage(page: Page) {
  if (await page.$(".reader-passage.is-selected")) {
    await assertReaderHealthy(page);
    return;
  }

  await page.waitForSelector(".reader-passage-button", { visible: true });
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>(".reader-passage-button")];
    const button = buttons.find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return rect.bottom > 90 && rect.top < window.innerHeight - 40;
    }) ?? buttons[0];

    button?.click();
  });
  await expectSelectedPassage(page);
}

async function clickSelectedPassageAction(
  page: Page,
  label: string
): Promise<SearchActionResponse | null> {
  await page.waitForSelector(".reader-passage.is-selected .reader-passage-actions", {
    visible: true
  });
  const waitsForSearchResponse = /Similar/i.test(label);
  let responsePromise: Promise<SearchActionResponse> | null = null;

  if (waitsForSearchResponse) {
    await rotateE2EClientIp(page);
    responsePromise = waitForSearchActionResponse(page);
  }

  const clicked = await page.evaluate((label) => {
    const actions = document.querySelector(".reader-passage.is-selected .reader-passage-actions");
    const buttons = [...actions?.querySelectorAll<HTMLButtonElement>("button") ?? []];
    const button = buttons.find((candidate) => candidate.textContent?.trim() === label);
    button?.click();
    return Boolean(button);
  }, label);

  assert(clicked, `Could not find selected passage action "${label}".`);
  return responsePromise;
}

async function expandResult(page: Page, resultSelector: string, index: number) {
  await page.waitForSelector(resultSelector, { visible: true });
  await page.evaluate(({ resultSelector, index }) => {
    const result = document.querySelectorAll<HTMLElement>(resultSelector)[index];
    const button = result?.querySelector<HTMLButtonElement>(".scripture-result-button");
    button?.click();
  }, { resultSelector, index });
  await page.waitForFunction(({ resultSelector, index }) => {
    const result = document.querySelectorAll<HTMLElement>(resultSelector)[index];
    return Boolean(result?.querySelector(".result-actions"));
  }, { timeout: timeoutMs }, { resultSelector, index });
}

async function clickResultAction(
  page: Page,
  resultSelector: string,
  index: number,
  label: string
): Promise<SearchActionResponse | null> {
  let responsePromise: Promise<SearchActionResponse> | null = null;

  if (/Similar/i.test(label)) {
    await rotateE2EClientIp(page);
    responsePromise = waitForSearchActionResponse(page);
  }

  const clicked = await page.evaluate(({ resultSelector, index, label }) => {
    const result = document.querySelectorAll<HTMLElement>(resultSelector)[index];
    const controls = [...result?.querySelectorAll<HTMLElement>(".result-actions button, .result-actions a") ?? []];
    const control = controls.find((candidate) => candidate.textContent?.trim() === label);
    control?.click();
    return Boolean(control);
  }, { resultSelector, index, label });

  assert(clicked, `Could not find result action "${label}".`);
  return responsePromise;
}

async function clickChapterButton(page: Page, chapterNumber: number) {
  await page.evaluate((chapterNumber) => {
    const groups = [...document.querySelectorAll<HTMLElement>(".passage-jump-group")];
    const chapterGroup = groups.find((group) => (
      group.getAttribute("aria-label") === "Chapter"
      || group.textContent?.trim().startsWith("Chapter")
    ));
    const buttons = [...chapterGroup?.querySelectorAll<HTMLButtonElement>("button") ?? []];
    const button = buttons.find((candidate) => candidate.textContent?.trim() === String(chapterNumber))
      ?? buttons[0];
    button?.click();
  }, chapterNumber);
}

async function clickButtonByText(page: Page, selector: string, label: string) {
  await page.evaluate(({ selector, label }) => {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>(selector)];
    const button = buttons.find((candidate) => candidate.textContent?.trim() === label);
    button?.click();
  }, { selector, label });
}

async function click(page: Page, selector: string) {
  await page.waitForSelector(selector, { visible: true });
  const clicked = await page.evaluate((selector) => {
    const element = document.querySelector<HTMLElement>(selector);
    element?.click();
    return Boolean(element);
  }, selector);

  assert(clicked, `Could not click ${selector}.`);
}

async function waitForReader(page: Page, expectedText: string) {
  await page.waitForSelector(".reader-page", { visible: true });
  const started = performance.now();
  let lastState: unknown = null;

  while (performance.now() - started < timeoutMs) {
    lastState = await page.evaluate((expectedText) => {
      const title = document.querySelector("#reader-title")?.textContent?.trim() ?? "";
      const alert = document.querySelector("[role='alert']")?.textContent?.trim() ?? "";

      return {
        alert,
        hasExpectedText: Boolean(document.body.textContent?.includes(expectedText)),
        isReady: title.length > 0
          && !/unavailable|Failed to load/i.test(alert)
          && Boolean(document.body.textContent?.includes(expectedText)),
        title,
        url: location.href
      };
    }, expectedText);

    if ((lastState as { isReady?: boolean }).isReady) {
      await assertReaderHealthy(page);
      return;
    }

    await wait(250);
  }

  await saveFailureScreenshot(page);
  throw new Error(`Timed out waiting for reader: ${JSON.stringify(lastState)}`);
}

async function waitForModalClosed(page: Page) {
  await page.waitForFunction(() => !document.querySelector(".search-modal"), { timeout: timeoutMs });
}

async function closeSearchModal(page: Page) {
  await click(page, ".search-modal-header .filter-modal-close");
  await waitForModalClosed(page);
}

async function expectModalTitle(page: Page, expectedTitle: string) {
  await page.waitForFunction((expectedTitle) => (
    document.querySelector("#search-modal-title")?.textContent?.trim() === expectedTitle
  ), { timeout: timeoutMs }, expectedTitle);
}

async function waitForBibleSimilarHeading(page: Page) {
  await page.waitForFunction(() => (
    document.querySelector(".results-heading")?.textContent?.trim() === "Similar passages"
  ), { timeout: timeoutMs });
}

async function waitForResultsHeading(page: Page, expectedTitle: string) {
  await page.waitForFunction((expectedTitle) => (
    [...document.querySelectorAll(".results-heading")]
      .some((heading) => heading.textContent?.trim() === expectedTitle)
  ), { timeout: timeoutMs }, expectedTitle);
}

async function expectSelectedPassage(page: Page) {
  const started = performance.now();
  let lastState: unknown = null;

  while (performance.now() - started < timeoutMs) {
    const selected = await page.$(".reader-passage.is-selected");

    if (selected) {
      await assertReaderHealthy(page);
      return;
    }

    lastState = await page.evaluate(() => ({
      chapterErrors: [...document.querySelectorAll(".reader-chapter-error")]
        .map((element) => element.textContent?.trim() ?? ""),
      passageRanges: [...document.querySelectorAll<HTMLElement>(".reader-passage")]
        .slice(0, 12)
        .map((element) => ({
          end: element.dataset.passageEnd ?? "",
          key: element.dataset.passageKey ?? element.dataset.passageId ?? "",
          range: element.dataset.passageRange ?? "",
          start: element.dataset.passageStart ?? ""
        })),
      title: document.querySelector("#reader-title")?.textContent?.trim() ?? "",
      url: location.href
    }));
    await wait(250);
  }

  await saveFailureScreenshot(page);
  throw new Error(`Timed out waiting for selected passage: ${JSON.stringify(lastState)}`);
}

async function expectReaderPassages(page: Page) {
  await page.waitForSelector(".reader-passage", { visible: true });
  await assertReaderHealthy(page);
}

async function scrollUntilTitleChanges(
  page: Page,
  initialTitle: string,
  direction: "down" | "up"
) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const didScroll = await page.evaluate((direction) => {
      const anchorY = 120;
      const chapters = [...document.querySelectorAll<HTMLElement>(".reader-chapter")];
      const activeChapter = chapters.find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.top <= anchorY && rect.bottom >= anchorY;
      }) ?? chapters.find((element) => element.getBoundingClientRect().top > anchorY)
        ?? chapters.at(-1);
      const activeIndex = activeChapter ? chapters.indexOf(activeChapter) : -1;
      const targetIndex = activeIndex + (direction === "down" ? 1 : -1);
      const targetChapter = chapters[targetIndex];

      if (!targetChapter) {
        return false;
      }

      const targetTop = targetChapter.getBoundingClientRect().top
        + window.scrollY
        - anchorY
        + 1;

      window.scrollTo({ behavior: "auto", top: targetTop });
      window.dispatchEvent(new Event("scroll"));
      return true;
    }, direction);

    assert(didScroll, `Could not find adjacent chapter while scrolling ${direction}.`);
    await wait(300);
    await assertReaderHealthy(page);

    if (await readerTitle(page) !== initialTitle) {
      return;
    }
  }

  throw new Error(`Reader title did not change while scrolling ${direction} from ${initialTitle}.`);
}

async function readerTitle(page: Page) {
  const title = await page.$eval("#reader-title", (element) => element.textContent?.trim() ?? "");

  assert(title.length > 0, "Reader title is empty.");
  return title;
}

async function startReaderTitleRecorder(page: Page) {
  return page.evaluate(() => {
    const key = `readerTitleRecorder:${Date.now()}:${Math.random()}`;
    const title = document.querySelector("#reader-title");
    const titles = [title?.textContent?.trim() ?? ""].filter(Boolean);
    const observer = new MutationObserver(() => {
      const nextTitle = title?.textContent?.trim() ?? "";

      if (nextTitle && titles.at(-1) !== nextTitle) {
        titles.push(nextTitle);
      }
    });

    if (title) {
      observer.observe(title, {
        characterData: true,
        childList: true,
        subtree: true
      });
    }

    Object.assign(window, {
      [key]: {
        observer,
        titles
      }
    });

    return key;
  });
}

async function assertReaderTitleDidNotFlicker(page: Page, recorderKey: string) {
  const titles = await page.evaluate((recorderKey) => {
    type RecorderWindow = Window & typeof globalThis & Record<string, {
      observer: MutationObserver;
      titles: string[];
    }>;
    const recorder = (window as RecorderWindow)[recorderKey];

    recorder?.observer.disconnect();
    return recorder?.titles ?? [];
  }, recorderKey);
  const uniqueTitles = [...new Set(titles)];

  assert(
    uniqueTitles.length <= 2,
    `Reader title changed through intermediate chapters during jump: ${uniqueTitles.join(" -> ")}.`
  );
}

async function waitForReaderTitle(page: Page, expectedTitle: string) {
  const started = performance.now();
  let lastTitle = "";

  while (performance.now() - started < timeoutMs) {
    lastTitle = await readerTitle(page);

    if (lastTitle === expectedTitle) {
      return;
    }

    await wait(250);
  }

  throw new Error(`Expected reader title "${expectedTitle}", got "${lastTitle}".`);
}

async function assertReaderHealthy(page: Page) {
  const state = await page.evaluate(() => ({
    alertText: document.querySelector("[role='alert']")?.textContent?.trim() ?? "",
    chapterError: document.querySelector(".reader-chapter-error")?.textContent?.trim() ?? "",
    title: document.querySelector("#reader-title")?.textContent?.trim() ?? "",
    url: location.href
  }));

  const failureText = `${state.alertText} ${state.chapterError}`;

  if (/unavailable|Failed to load|Rate limit/i.test(failureText)) {
    await saveFailureScreenshot(page);
    throw new Error(`Reader unhealthy at ${state.url}: ${failureText}`);
  }

  assert(state.title.length > 0, `Reader title missing at ${state.url}`);
}

async function saveFailureScreenshot(page: Page) {
  const outputPath = path.resolve(".tmp/e2e-reader-kitchen-sink-failure.png");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await page.screenshot({ fullPage: true, path: outputPath });
  console.error(`Saved failure screenshot to ${outputPath}`);
}

function attachDiagnostics(page: Page) {
  page.on("pageerror", (error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Page error: ${message}`);
  });
  page.on("requestfailed", (request) => {
    const url = request.url();

    if (url.startsWith(baseUrl) || url.includes("crosscanon.com")) {
      const failure = request.failure()?.errorText ?? "unknown";
      const key = url.includes("/church-fathers-preview/chapters/")
        ? `${request.method()} church-fathers-preview chapter ${failure}`
        : `${request.method()} ${url} ${failure}`;
      requestFailureSummary.set(key, (requestFailureSummary.get(key) ?? 0) + 1);
    }
  });
}

async function rotateE2EClientIp(page: Page) {
  e2eClientIpCounter += 1;
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": `127.0.42.${e2eClientIpCounter}`
  });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function isSearchActionBody(value: unknown): value is SearchActionBody {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (candidate.error === undefined || typeof candidate.error === "string")
    && (candidate.results === undefined || isUnknownArray(candidate.results))
    && (
      candidate.scriptureResults === undefined
      || isUnknownArray(candidate.scriptureResults)
    )
    && (
      candidate.earlyChristianResults === undefined
      || isUnknownArray(candidate.earlyChristianResults)
    );
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function roundMs(value: number) {
  return Math.round(value * 10) / 10;
}

await main();
