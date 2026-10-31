import puppeteer from "puppeteer";
import fs from "node:fs/promises";
import path from "node:path";

const directory = path.resolve("docs/screenshots");
await fs.mkdir(directory, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1000, height: 900, deviceScaleFactor: 1 });
  await page.goto(process.env.DESKTOP_COMPARE_WEB_URL ?? "http://127.0.0.1:3005", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".reader-passage-text");
  await page.evaluate(() => document.fonts.ready);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await page.screenshot({ path: path.join(directory, "cross-canon-web-reference.png") });
  const web = await fs.readFile(path.join(directory, "cross-canon-web-reference.png"));
  const native = await fs.readFile(path.join(directory, "cross-canon-desktop.png"));
  await page.setViewport({ width: 2032, height: 970, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><style>
    *{box-sizing:border-box}body{margin:0;background:#e8e3db;font:14px system-ui;color:#24211d}
    main{display:flex;gap:16px;padding:16px}figure{margin:0;width:1000px}
    figcaption{height:38px;font-weight:600;display:flex;align-items:center;justify-content:space-between}
    small{font-weight:400;color:#686058}img{display:block;width:1000px;height:900px;border:1px solid #ddd6cc}
  </style><main><figure><figcaption>Cross Canon · Web<small>Existing app</small></figcaption><img src="data:image/png;base64,${web.toString("base64")}"></figure><figure><figcaption>Cross Canon Desktop<small>Rust · native rendering · local texts</small></figcaption><img src="data:image/png;base64,${native.toString("base64")}"></figure></main></html>`);
  await page.screenshot({ path: path.join(directory, "cross-canon-side-by-side.png") });
  console.log(path.join(directory, "cross-canon-side-by-side.png"));
} finally {
  await browser.close();
}
