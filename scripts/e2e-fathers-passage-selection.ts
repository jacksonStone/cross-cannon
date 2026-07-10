import puppeteer from "puppeteer";

const baseUrl = (process.env.E2E_BASE_URL ?? "http://127.0.0.1:3005").replace(/\/$/, "");
const timeoutMs = 30_000;
const chapterId = "anf09:xii.iv.i";
const savedPassageRange = "4-6";

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"]
});

try {
  const page = await browser.newPage();
  page.setDefaultTimeout(timeoutMs);
  await page.setViewport({ height: 844, width: 390 });
  await page.goto(`${baseUrl}/church-fathers`, { waitUntil: "domcontentloaded" });
  await page.evaluate(({ targetChapterId, targetPassageRange }) => {
    window.localStorage.setItem(
      "cross-cannon:church-fathers-position:v1",
      JSON.stringify({
        chapterKey: targetChapterId,
        corpus: "fathers",
        passageRange: targetPassageRange,
        version: 2
      })
    );
    window.localStorage.setItem("cross-cannon:last-reader:v1", "fathers");
  }, {
    targetChapterId: chapterId,
    targetPassageRange: savedPassageRange
  });
  await page.goto(`${baseUrl}/church-fathers`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(
    `.ec-reader-chapter[data-chapter-id="${chapterId}"] `
      + `.reader-passage.is-selected[data-passage-range="${savedPassageRange}"]`,
    { timeout: 60_000 }
  );
  await wait(750);

  const before = await readPassagePosition(page, savedPassageRange);
  const tappedPassageRange = await page.evaluate((targetChapterId) => {
    const passages = [...document.querySelectorAll<HTMLElement>(
      `.ec-reader-chapter[data-chapter-id="${targetChapterId}"] .reader-passage`
    )];
    const passage = passages.find((candidate) => (
      !candidate.classList.contains("is-selected")
    ));
    const button = passage?.querySelector<HTMLButtonElement>(".reader-passage-button");

    if (!passage?.dataset.passageRange || !button) {
      throw new Error("Expected another passage in the saved chapter.");
    }

    button.click();
    return passage.dataset.passageRange;
  }, chapterId);
  await wait(750);

  const after = await readPassagePosition(page, savedPassageRange);
  const selectedPassageRange = await page.evaluate((targetChapterId) => (
    document.querySelector<HTMLElement>(
      `.ec-reader-chapter[data-chapter-id="${targetChapterId}"] .reader-passage.is-selected`
    )?.dataset.passageRange ?? ""
  ), chapterId);
  const topDelta = Math.abs(after.top - before.top);

  if (selectedPassageRange !== tappedPassageRange) {
    throw new Error(
      `Tapping passage ${tappedPassageRange} restored saved passage `
        + `${selectedPassageRange || "(none)"}: ${JSON.stringify({ after, before })}`
    );
  }

  if (topDelta > 100) {
    throw new Error(
      `Tapping passage ${tappedPassageRange} moved the saved reading position `
        + `${topDelta.toFixed(1)}px: ${JSON.stringify({ after, before })}`
    );
  }

  console.log(JSON.stringify({
    after,
    before,
    passed: true,
    selectedPassageRange,
    tappedPassageRange,
    topDelta
  }, null, 2));
} finally {
  await browser.close();
}

async function readPassagePosition(page: import("puppeteer").Page, range: string) {
  return page.evaluate(({ selectedRange, targetChapterId }) => {
    const passage = document.querySelector<HTMLElement>(
      `.ec-reader-chapter[data-chapter-id="${targetChapterId}"] `
        + `.reader-passage[data-passage-range="${selectedRange}"]`
    );
    const firstPassage = document.querySelector<HTMLElement>(
      `.ec-reader-chapter[data-chapter-id="${targetChapterId}"] .reader-passage`
    );

    if (!passage || !firstPassage) {
      throw new Error("Expected saved and first passages to be rendered.");
    }

    return {
      firstPassageTop: firstPassage.getBoundingClientRect().top,
      scrollY: window.scrollY,
      top: passage.getBoundingClientRect().top,
      url: window.location.href
    };
  }, { selectedRange: range, targetChapterId: chapterId });
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
