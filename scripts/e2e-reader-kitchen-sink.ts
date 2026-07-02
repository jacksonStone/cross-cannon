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

const stepResults: StepResult[] = [];

async function main() {
  let browser: Browser | null = null;

  try {
    browser = await puppeteer.launch({
      headless,
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
    await step("Bible: theme search, similar search, jump result", () => exerciseBibleSearch(page));
    await step("Bible: selected passage similar search", () => exerciseBibleReaderPassageSimilar(page));
    await step("Bible: selected passage similar Fathers search and jump result", () => exerciseBibleToFathersSimilar(page));
    await step("Fathers: jump picker to work and chapter", () => jumpToFathersWork(page));
    await step("Fathers: cross chapter boundary down and up", () => crossFathersChapterBoundary(page));
    await step("Fathers: theme search and jump result", () => exerciseFathersThemeSearch(page));
    await step("Fathers: selected passage similar search and jump result", () => exerciseFathersPassageSimilar(page));
    await step("Fathers: selected passage similar Bible search and jump result", () => exerciseFathersToBibleSimilar(page));

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

async function exerciseBibleSearch(page: Page) {
  await openReaderTools(page);
  await click(page, ".reader-header-actions button[aria-label='Search']");
  await themeSearch(page, "fear and comfort", ".results .scripture-result");
  await expandResult(page, ".results .scripture-result", 0);
  await clickResultAction(page, ".results .scripture-result", 0, "Similar passages");
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
  await clickSelectedPassageAction(page, "Similar passages");
  await waitForSearchIdle(page, ".results .scripture-result");
  await waitForBibleSimilarHeading(page);
  await expectModalTitle(page, "Find passages");
  await expandResult(page, ".results .scripture-result", 0);
  await clickResultAction(page, ".results .scripture-result", 0, "Jump to");
  await waitForModalClosed(page);
  await expectReaderPassages(page);
}

async function exerciseBibleToFathersSimilar(page: Page) {
  await clickVisiblePassage(page);
  await clickSelectedPassageAction(page, "Similar in Fathers");
  await waitForSearchIdle(page, ".ec-results .scripture-result");
  await expectModalTitle(page, "Find passages");
  await waitForResultsHeading(page, "Similar early Christian passages");
  await expandResult(page, ".ec-results .scripture-result", 0);
  await clickResultAction(page, ".ec-results .scripture-result", 0, "Jump to");
  await page.waitForFunction(() => location.pathname === "/church-fathers", { timeout: timeoutMs });
  await waitForReader(page, "Early Christian");
  await expectSelectedPassage(page);
}

async function jumpToFathersWork(page: Page) {
  await openReaderTools(page);
  await clickButtonByText(page, ".reader-header-actions .passage-jump-launcher button", "Jump");
  await page.waitForSelector(".passage-jump-modal", { visible: true });

  const selectedValue = await page.evaluate(() => {
    const select = document.querySelector<HTMLSelectElement>(".passage-jump-modal select");
    if (!select) {
      return "";
    }

    const option = [...select.options].find((candidate) => (
      candidate.textContent?.includes("Theophilus")
      || candidate.textContent?.includes("Clement")
      || candidate.textContent?.includes("Ignatius")
    ));

    return option?.value ?? select.options[1]?.value ?? "";
  });

  assert(selectedValue, "Could not find a Fathers work option to jump to.");
  await page.select(".passage-jump-modal select", selectedValue);
  await clickChapterButton(page, 2);
  await page.waitForSelector(".passage-jump-modal", { hidden: true });
  await waitForReader(page, "Early Christian");
  await assertReaderHealthy(page);
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
  await themeSearch(page, "unity of the church", ".ec-results .scripture-result");
  await expandResult(page, ".ec-results .scripture-result", 0);
  await clickResultAction(page, ".ec-results .scripture-result", 0, "Jump to");
  await waitForModalClosed(page);
  await expectSelectedPassage(page);
  await assertReaderHealthy(page);
}

async function exerciseFathersPassageSimilar(page: Page) {
  await clickVisiblePassage(page);
  await clickSelectedPassageAction(page, "Similar passages");
  await waitForSearchIdle(page, ".ec-results .scripture-result");
  await expectModalTitle(page, "Find chapters");
  await expandResult(page, ".ec-results .scripture-result", 0);
  await clickResultAction(page, ".ec-results .scripture-result", 0, "Jump to");
  await waitForModalClosed(page);
  await expectSelectedPassage(page);
  await assertReaderHealthy(page);
}

async function exerciseFathersToBibleSimilar(page: Page) {
  await clickVisiblePassage(page);
  await clickSelectedPassageAction(page, "Similar Bible passages");
  await waitForSearchIdle(page, ".results .scripture-result");
  await expectModalTitle(page, "Find chapters");
  await expandResult(page, ".results .scripture-result", 0);
  await clickResultAction(page, ".results .scripture-result", 0, "Jump to");
  await page.waitForFunction(() => location.pathname === "/reader" || location.pathname.startsWith("/reader/"), {
    timeout: timeoutMs
  });
  await expectReaderPassages(page);
  await assertReaderHealthy(page);
}

async function themeSearch(page: Page, query: string, resultsSelector: string) {
  await page.waitForSelector(".search-modal textarea[name='question']", { visible: true });
  await page.click(".search-modal textarea[name='question']", { clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.type(".search-modal textarea[name='question']", query);
  await rotateE2EClientIp(page);
  await Promise.all([
    wait(searchDelayMs),
    click(page, ".search-modal button.search-button")
  ]);
  await waitForSearchIdle(page, resultsSelector);
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

async function openReaderTools(page: Page) {
  const hasOpenTools = await page.$(".reader-header-actions");

  if (!hasOpenTools) {
    await click(page, ".reader-header button[aria-label='Open reader tools']");
    await page.waitForSelector(".reader-header-actions", { visible: true });
  }
}

async function clickVisiblePassage(page: Page) {
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

async function clickSelectedPassageAction(page: Page, label: string) {
  await page.waitForSelector(".reader-passage.is-selected .reader-passage-actions", {
    visible: true
  });
  await rotateE2EClientIp(page);
  const clicked = await page.evaluate((label) => {
    const actions = document.querySelector(".reader-passage.is-selected .reader-passage-actions");
    const buttons = [...actions?.querySelectorAll<HTMLButtonElement>("button") ?? []];
    const button = buttons.find((candidate) => candidate.textContent?.trim() === label);
    button?.click();
    return Boolean(button);
  }, label);

  assert(clicked, `Could not find selected passage action "${label}".`);
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
) {
  if (/Similar/i.test(label)) {
    await rotateE2EClientIp(page);
  }

  const clicked = await page.evaluate(({ resultSelector, index, label }) => {
    const result = document.querySelectorAll<HTMLElement>(resultSelector)[index];
    const controls = [...result?.querySelectorAll<HTMLElement>(".result-actions button, .result-actions a") ?? []];
    const control = controls.find((candidate) => candidate.textContent?.trim() === label);
    control?.click();
    return Boolean(control);
  }, { resultSelector, index, label });

  assert(clicked, `Could not find result action "${label}".`);
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
  await page.click(selector);
}

async function waitForReader(page: Page, expectedText: string) {
  await page.waitForSelector(".reader-page", { visible: true });
  await page.waitForFunction((expectedText) => {
    const title = document.querySelector("#reader-title")?.textContent ?? "";
    const alert = document.querySelector("[role='alert']")?.textContent ?? "";

    return title.length > 0
      && !/unavailable|Failed to load/i.test(alert)
      && document.body.textContent?.includes(expectedText);
  }, { timeout: timeoutMs }, expectedText);
  await assertReaderHealthy(page);
}

async function waitForModalClosed(page: Page) {
  await page.waitForFunction(() => !document.querySelector(".search-modal"), { timeout: timeoutMs });
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
  const delta = direction === "down" ? 850 : -850;
  await page.mouse.move(640, 640);

  for (let attempt = 0; attempt < 14; attempt += 1) {
    await page.mouse.wheel({ deltaY: delta });
    await wait(180);
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

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function roundMs(value: number) {
  return Math.round(value * 10) / 10;
}

await main();
