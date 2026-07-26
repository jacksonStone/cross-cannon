import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import puppeteer, { type Browser, type Page } from "puppeteer";
import { build } from "vite";

const timeoutMs = Number(process.env.E2E_TIMEOUT_MS ?? 30_000);
const orientationFixtureRoot = path.resolve(
  "scripts/fixtures/reader-orientation"
);
const orientationFixtureOutput = path.resolve(
  ".tmp/reader-orientation-fixture"
);
const css = await fs.readFile("app/styles.css", "utf8");
const rootSource = await fs.readFile("app/root.tsx", "utf8");
const viewportContent = rootSource.match(
  /<meta\s+name="viewport"\s+content="([^"]+)"/
)?.[1];

if (!viewportContent) {
  throw new Error("Could not find the viewport meta tag in app/root.tsx.");
}

async function main() {
  let browser: Browser | null = null;

  try {
    await build({
      base: "./",
      build: {
        emptyOutDir: true,
        outDir: orientationFixtureOutput
      },
      logLevel: "silent",
      root: orientationFixtureRoot
    });
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--allow-file-access-from-files",
        "--no-sandbox",
        "--disable-setuid-sandbox"
      ]
    });

    const checks = [
      {
        name: "mobile toolbar alignment",
        run: verifyMobileToolbarAlignment
      },
      {
        name: "landscape safe-area coverage",
        run: verifyLandscapeSafeAreaCoverage
      },
      {
        name: "orientation preserves the reading anchor",
        run: verifyOrientationPreservesReadingAnchor
      }
    ];
    const failures: string[] = [];

    for (const check of checks) {
      const page = await browser.newPage();
      page.setDefaultTimeout(timeoutMs);
      page.setDefaultNavigationTimeout(timeoutMs);

      try {
        await check.run(page);
      } catch (error) {
        failures.push(
          `${check.name}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      } finally {
        await page.close();
      }
    }

    assert(
      failures.length === 0,
      `Responsive reader checks failed:\n- ${failures.join("\n- ")}`
    );

    console.log("Responsive reader checks passed.");
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    await fs.rm(orientationFixtureOutput, { force: true, recursive: true });
  }
}

async function verifyOrientationPreservesReadingAnchor(page: Page) {
  const targetPassageId = "eccl-11-1";
  const fixtureUrl = pathToFileURL(
    path.join(orientationFixtureOutput, "index.html")
  ).href;

  await setMobileViewport(page, 390, 844);
  await page.goto(fixtureUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(`[data-passage-id="${targetPassageId}"]`, {
    visible: true
  });
  await page.waitForFunction(() => (
    document.querySelector("#reader-title")?.textContent?.trim()
      === "Ecclesiastes 11"
  ));
  await wait(700);

  await page.evaluate((passageId) => {
    const passage = document.querySelector<HTMLElement>(
      `[data-passage-id="${passageId}"]`
    );

    if (!passage) {
      throw new Error("Target passage is missing.");
    }

    window.scrollTo({
      behavior: "auto",
      top: passage.getBoundingClientRect().top + window.scrollY - 128
    });
    window.dispatchEvent(new Event("scroll"));
  }, targetPassageId);
  await wait(250);

  const portraitBefore = await readOrientationState(page);
  await setMobileViewport(page, 390, 500);
  await wait(350);
  const toolbarResize = await readOrientationState(page);
  await setMobileViewport(page, 390, 844);
  await wait(700);
  await setMobileViewport(page, 844, 390);
  await wait(350);
  const landscape = await readOrientationState(page);
  await setMobileViewport(page, 390, 844);
  await wait(350);
  const portraitAfter = await readOrientationState(page);
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await setMobileViewport(page, 844, 390);
  await wait(350);
  const multiEventLandscape = await readOrientationState(page);
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await setMobileViewport(page, 390, 844);
  await wait(350);
  const multiEventPortrait = await readOrientationState(page);
  await simulatePreResizeScrollShift(page, "eccl-8-1");
  await setMobileViewport(page, 844, 390);
  await wait(350);
  const scrollFirstLandscape = await readOrientationState(page);
  await simulatePreResizeScrollShift(page, "eccl-8-1");
  await setMobileViewport(page, 390, 844);
  await wait(350);
  const scrollFirstPortrait = await readOrientationState(page);

  const failures = [
    portraitBefore.anchorPassageId !== targetPassageId
      ? `setup anchored ${portraitBefore.anchorPassageId}`
      : "",
    toolbarResize.anchorPassageId !== targetPassageId
      ? `toolbar resize anchored ${toolbarResize.anchorPassageId}`
      : "",
    toolbarResize.scrollY !== portraitBefore.scrollY
      ? `toolbar resize moved from ${portraitBefore.scrollY}px to ${toolbarResize.scrollY}px`
      : "",
    landscape.anchorPassageId !== targetPassageId
      ? `landscape anchored ${landscape.anchorPassageId}`
      : "",
    portraitAfter.anchorPassageId !== targetPassageId
      ? `portrait return anchored ${portraitAfter.anchorPassageId}`
      : "",
    multiEventLandscape.anchorPassageId !== targetPassageId
      ? `multi-event landscape anchored ${multiEventLandscape.anchorPassageId}`
      : "",
    multiEventPortrait.anchorPassageId !== targetPassageId
      ? `multi-event portrait anchored ${multiEventPortrait.anchorPassageId}`
      : "",
    scrollFirstLandscape.anchorPassageId !== targetPassageId
      ? `scroll-first landscape anchored ${scrollFirstLandscape.anchorPassageId}`
      : "",
    scrollFirstPortrait.anchorPassageId !== targetPassageId
      ? `scroll-first portrait anchored ${scrollFirstPortrait.anchorPassageId}`
      : "",
    landscape.title !== "Ecclesiastes 11"
      ? `landscape title was ${landscape.title}`
      : "",
    portraitAfter.title !== "Ecclesiastes 11"
      ? `portrait return title was ${portraitAfter.title}`
      : "",
    multiEventLandscape.title !== "Ecclesiastes 11"
      ? `multi-event landscape title was ${multiEventLandscape.title}`
      : "",
    multiEventPortrait.title !== "Ecclesiastes 11"
      ? `multi-event portrait title was ${multiEventPortrait.title}`
      : "",
    scrollFirstLandscape.title !== "Ecclesiastes 11"
      ? `scroll-first landscape title was ${scrollFirstLandscape.title}`
      : "",
    scrollFirstPortrait.title !== "Ecclesiastes 11"
      ? `scroll-first portrait title was ${scrollFirstPortrait.title}`
      : "",
    portraitAfter.maxPassageGap > 2
      ? `portrait return passage gap was ${portraitAfter.maxPassageGap}px`
      : "",
    multiEventPortrait.maxPassageGap > 2
      ? `multi-event portrait passage gap was ${multiEventPortrait.maxPassageGap}px`
      : "",
    scrollFirstPortrait.maxPassageGap > 2
      ? `scroll-first portrait passage gap was ${scrollFirstPortrait.maxPassageGap}px`
      : "",
    scrollFirstPortrait.maxPassageTextGap > 20
      ? `scroll-first portrait passage text gap was ${scrollFirstPortrait.maxPassageTextGap}px`
      : ""
  ].filter(Boolean);

  assert(
    failures.length === 0,
    `Orientation regression: ${failures.join("; ")}. State: ${JSON.stringify({
      landscape,
      multiEventLandscape,
      multiEventPortrait,
      portraitAfter,
      portraitBefore,
      scrollFirstLandscape,
      scrollFirstPortrait,
      toolbarResize
    })}`
  );
}

async function simulatePreResizeScrollShift(
  page: Page,
  passageId: string
) {
  await page.evaluate((nextPassageId) => {
    window.dispatchEvent(new Event("orientationchange"));

    const passage = document.querySelector<HTMLElement>(
      `[data-passage-id="${nextPassageId}"]`
    );

    if (!passage) {
      throw new Error("Scroll-shift passage is missing.");
    }

    window.scrollTo({
      behavior: "auto",
      top: passage.getBoundingClientRect().top + window.scrollY - 128
    });
    window.dispatchEvent(new Event("scroll"));
  }, passageId);
  await wait(50);
}

async function readOrientationState(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector<HTMLElement>(".reader-page");
    const headerOffset = Number.parseFloat(
      root
        ? getComputedStyle(root).getPropertyValue("--reader-header-offset")
        : "128"
    );
    const anchorY = Math.max(
      headerOffset + 40,
      Math.min(window.innerHeight * 0.38, 220)
    );
    const anchorPassage = [...document.querySelectorAll<HTMLElement>(
      ".reader-passage"
    )].find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.top <= anchorY && rect.bottom >= anchorY;
    });
    const targetChapter = [...document.querySelectorAll<HTMLElement>(
      ".reader-chapter"
    )].find((chapter) => chapter.dataset.chapterKey === "Ecclesiastes\t11");
    const passages = [...targetChapter?.querySelectorAll<HTMLElement>(
      ".reader-passage"
    ) ?? []];
    const passageGaps = passages.slice(1).map((passage, index) => (
      passage.getBoundingClientRect().top
        - passages[index].getBoundingClientRect().bottom
    ));
    const passageTexts = passages.flatMap((passage) => (
      [...passage.querySelectorAll<HTMLElement>(".reader-passage-text")]
    ));
    const passageTextGaps = passageTexts.slice(1).map((passageText, index) => (
      passageText.getBoundingClientRect().top
        - passageTexts[index].getBoundingClientRect().bottom
    ));

    return {
      anchorPassageId: anchorPassage?.dataset.passageId ?? "",
      maxPassageGap: Math.round(Math.max(0, ...passageGaps)),
      maxPassageTextGap: Math.round(Math.max(0, ...passageTextGaps)),
      scrollY: Math.round(window.scrollY),
      title: document.querySelector("#reader-title")?.textContent?.trim() ?? "",
      viewport: `${window.innerWidth}x${window.innerHeight}`
    };
  });
}

function setMobileViewport(page: Page, width: number, height: number) {
  return page.setViewport({
    deviceScaleFactor: 3,
    hasTouch: true,
    height,
    isMobile: true,
    width
  });
}

async function verifyMobileToolbarAlignment(page: Page) {
  await page.setViewport({ height: 844, width: 390 });
  await loadReaderFixture(page);

  const alignment = await page.evaluate(() => {
    const toolbar = document.querySelector<HTMLElement>(
      ".reader-header-actions"
    );
    const lastControl = toolbar?.lastElementChild as HTMLElement | null;

    if (!toolbar || !lastControl) {
      return null;
    }

    const toolbarRect = toolbar.getBoundingClientRect();
    const lastControlRect = lastControl.getBoundingClientRect();

    return {
      rightGap: Math.round(toolbarRect.right - lastControlRect.right),
      toolbarWidth: Math.round(toolbarRect.width)
    };
  });

  assert(alignment, "Reader toolbar did not render.");
  assert(
    alignment.rightGap <= 2,
    `Expected mobile reader controls to be right-aligned, got a ${alignment.rightGap}px right gap in a ${alignment.toolbarWidth}px toolbar.`
  );
}

async function verifyLandscapeSafeAreaCoverage(page: Page) {
  await page.setViewport({ height: 390, width: 844 });
  await loadReaderFixture(page);

  const state = await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>(".reader-shell");
    const viewportMeta = document.querySelector<HTMLMetaElement>(
      "meta[name='viewport']"
    );

    if (!shell) {
      return null;
    }

    const shellStyle = getComputedStyle(shell);
    const shellRect = shell.getBoundingClientRect();
    const readerShellRules: string[] = [];
    const pendingRules = Array.from(document.styleSheets).flatMap(
      (styleSheet) => Array.from(styleSheet.cssRules)
    );

    while (pendingRules.length > 0) {
      const rule = pendingRules.shift();

      if (rule instanceof CSSStyleRule) {
        if (rule.selectorText.includes(".reader-shell")) {
          readerShellRules.push(rule.cssText);
        }
        continue;
      }

      if (rule instanceof CSSMediaRule) {
        pendingRules.push(...Array.from(rule.cssRules));
      }
    }
    const readerShellCss = readerShellRules.join("\n");

    return {
      backgroundColor: shellStyle.backgroundColor,
      hasSafeAreaLeft: readerShellCss.includes("env(safe-area-inset-left)"),
      hasSafeAreaRight: readerShellCss.includes("env(safe-area-inset-right)"),
      leftEdgeColor:
        document.elementFromPoint(1, window.innerHeight / 2) instanceof Element
          ? getComputedStyle(
              document.elementFromPoint(
                1,
                window.innerHeight / 2
              ) as Element
            ).backgroundColor
          : "",
      rightEdgeColor:
        document.elementFromPoint(
          window.innerWidth - 2,
          window.innerHeight / 2
        ) instanceof Element
          ? getComputedStyle(
              document.elementFromPoint(
                window.innerWidth - 2,
                window.innerHeight / 2
              ) as Element
            ).backgroundColor
          : "",
      shellLeft: Math.round(shellRect.left),
      shellRight: Math.round(shellRect.right),
      viewportMeta: viewportMeta?.content ?? "",
      viewportWidth: window.innerWidth
    };
  });

  assert(state, "Reader shell did not render.");
  const failures = [
    !state.viewportMeta.includes("viewport-fit=cover")
      ? `expected viewport-fit=cover, got "${state.viewportMeta}"`
      : "",
    !state.hasSafeAreaLeft || !state.hasSafeAreaRight
      ? "expected reader-shell padding to include both horizontal safe-area insets"
      : "",
    state.shellLeft !== 0 || state.shellRight !== state.viewportWidth
      ? `expected reader shell to cover the viewport, got ${state.shellLeft}px to ${state.shellRight}px of ${state.viewportWidth}px`
      : "",
    state.leftEdgeColor !== state.backgroundColor ||
    state.rightEdgeColor !== state.backgroundColor
      ? `expected themed landscape edges, got shell ${state.backgroundColor}, left ${state.leftEdgeColor}, right ${state.rightEdgeColor}`
      : ""
  ].filter(Boolean);

  assert(
    failures.length === 0,
    `Landscape reader coverage failed: ${failures.join("; ")}.`
  );
}

async function loadReaderFixture(page: Page) {
  await page.setContent(`
    <!doctype html>
    <html>
      <head>
        <meta name="viewport" content="${viewportContent}">
        <style>${css}</style>
      </head>
      <body>
        <main class="reader-shell reader-theme-dark">
          <section class="reader-page reader-theme-dark">
            <header class="reader-header">
              <div class="reader-header-title">
                <h1 id="reader-title">Proverbs 31</h1>
              </div>
              <div class="reader-header-actions">
                <button class="context-button reader-icon-button reader-tools-close">×</button>
                <button class="context-button reader-icon-button">🔊</button>
                <button class="context-button reader-icon-button">🔍</button>
                <button class="context-button">Jump</button>
                <div class="reader-settings">
                  <button class="context-button reader-settings-trigger">Aa</button>
                </div>
              </div>
            </header>
            <div class="reader-passages">
              <p class="reader-passage-text">The words of King Lemuel.</p>
            </div>
          </section>
        </main>
      </body>
    </html>
  `);
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

void main();
