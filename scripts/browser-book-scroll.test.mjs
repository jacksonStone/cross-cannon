// Exercise continuous Scripture reading through the actual WASM/DOM adapter.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import puppeteer from 'puppeteer';

const origin = process.env.BROWSER_TEST_URL ?? 'http://127.0.0.1:3005';
const output = 'docs/screenshots/book-scroll';
await fs.mkdir(output, {recursive: true});
const cacheFile = (await fs.readdir('scripture-cache')).find(name => name.endsWith('.json') && name !== 'manifest.json');
const {passages} = JSON.parse(await fs.readFile(`scripture-cache/${cacheFile}`, 'utf8'));
const first = reference => passages.find(p => p.reference.startsWith(reference)).id;
const browser = await puppeteer.launch({headless: true, args: ['--no-sandbox', '--use-gl=angle']});
const errors = [];
try {
  for (const [name, width, height] of [['mobile', 393, 852], ['desktop', 1440, 1000]]) {
    const page = await browser.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({width, height, deviceScaleFactor: 1, isMobile: width < 600, hasTouch: width < 600});
    await page.goto(`${origin}/reader/${first('Genesis 50:')}`);
    await page.waitForFunction(() => document.querySelector('#reader-jump')?.textContent === 'Genesis 50', {timeout: 120000});
    await page.waitForFunction(() => [...document.querySelectorAll('.chapter h2')].some(e => e.textContent === 'Exodus 1'));
    const url = page.url();
    // Keep Genesis's final paragraph visible alongside the next book's opening.
    await page.evaluate(() => {
      const genesis = [...document.querySelectorAll('.chapter')].find(e => e.querySelector('h2').textContent === 'Genesis 50');
      genesis.querySelector('.passage:last-child').scrollIntoView({block: 'start'});
    });
    await page.screenshot({path: `${output}/${name}-boundary.png`});
    // Native scrolling must update Passage identity across the book boundary.
    await page.evaluate(() => {
      const exodus = [...document.querySelectorAll('.chapter')].find(e => e.querySelector('h2').textContent === 'Exodus 1');
      exodus.querySelector('.passage').scrollIntoView({block: 'start'});
    });
    await page.waitForFunction(() => document.querySelector('#reader-jump').textContent === 'Exodus 1');
    assert.equal(page.url(), url, 'Passive reading must preserve browser history');
    await page.screenshot({path: `${output}/${name}-exodus.png`});
    // The same retained window supports scrolling back into Genesis.
    await page.evaluate(() => {
      const genesis = [...document.querySelectorAll('.chapter')].find(e => e.querySelector('h2').textContent === 'Genesis 50');
      genesis.querySelector('.passage:last-child').scrollIntoView({block: 'start'});
    });
    await page.waitForFunction(() => document.querySelector('#reader-jump').textContent === 'Genesis 50');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    console.log(`${name}: Genesis → Exodus → Genesis; history and layout preserved`);
    await page.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
