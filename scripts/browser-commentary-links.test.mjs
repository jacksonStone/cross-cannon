// Verse coverage must navigate through the actual shared Rust reader, including history.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import puppeteer from 'puppeteer';

const origin = process.env.BROWSER_TEST_URL ?? 'http://127.0.0.1:3005';
const output = 'docs/screenshots/commentary-groups';
const source = 'classics:henry:Prov.16:4-6';
const sourceSelector = `[data-passage-id="${source}"]`;
await fs.mkdir(output, {recursive: true});
const browser = await puppeteer.launch({headless: true, args: ['--no-sandbox', '--use-gl=angle']});
try {
  for (const [name, width, height] of [['mobile', 393, 852], ['desktop', 1440, 1000]]) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({width, height, isMobile: width < 600, hasTouch: width < 600});
    await page.goto(`${origin}/reader/${source}`, {waitUntil: 'domcontentloaded'});
    const group = '.commentary-group[data-group-id="classics:henry:Prov.16:1-3"]';
    const links = `${group} .scripture-links`;
    const link = `${links} a`;
    await page.waitForSelector(link, {timeout: 60000});
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.$eval(link, a => a.textContent), 'Proverbs 16:1');
    assert.deepEqual(await page.$$eval(`${group} .passage`, ps => ps.map(p => p.dataset.passageId)),
      ['1-3','4-6','7-9','10-12'].map(range => `classics:henry:Prov.16:${range}`));
    assert.equal(await page.$$eval(link, as => as.length), 1, 'A contiguous verse group needs one reference');
    assert.equal(await page.$eval(group, g => g.nextElementSibling.querySelector('.scripture-links a').textContent), 'Proverbs 16:2');
    const target = await page.$eval(link, a => new URL(a.href).pathname);
    const sourceURL = await page.$eval(sourceSelector, p => {
      const url = new URL(p.dataset.link); return url.pathname + url.search;
    });
    assert.match(target, /^\/reader\/[a-z0-9]+$/);
    assert.equal(await page.$eval(`${sourceSelector}[class]`, p => p.querySelector('a')), null);
    await page.$eval(link, a => a.scrollIntoView({block: 'center'}));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await page.$eval(link, a => getComputedStyle(a).fontSize), '12px');
    await page.screenshot({path: `${output}/${name}-commentary.png`});
    if (name === 'desktop') {
      await page.focus(link);
      await page.keyboard.press('Enter');
    } else {
      await page.tap(link);
    }
    await page.waitForFunction(path => location.pathname === path && document.querySelector('#reader-jump')?.textContent === 'Proverbs 16', {timeout: 30000}, target);
    assert.equal(await page.$('.scripture-links'), null, 'Scripture should retain its plain reading flow');
    assert.equal(await page.$('.passage.selected'), null, 'A link must navigate without selecting commentary text');
    await page.screenshot({path: `${output}/${name}-scripture.png`});
    await page.goBack();
    await page.waitForSelector(link, {timeout: 30000});
    await page.waitForFunction(url => location.pathname + location.search === url, {}, sourceURL);
    if (name === 'desktop') {
      await page.$eval(sourceSelector, p => p.scrollIntoView({block: 'center'}));
      await page.click(sourceSelector);
      await page.waitForSelector(`${sourceSelector}.selected`);
      assert.equal(await page.$eval(sourceSelector, p => p.nextElementSibling.id), 'passage-tools');
      assert.equal(await page.$eval('#passage-tools', tools => tools.closest('.commentary-group')?.dataset.groupId), 'classics:henry:Prov.16:1-3');
      await page.click('#action-highlight');
      await page.waitForSelector(`${sourceSelector}.highlight`);
      await page.click('#action-clear');
      assert.equal(await page.$$eval(link, as => as.length), 1, 'Study actions must preserve the grouped reference');
    }
    if (name === 'mobile') {
      await page.waitForFunction(() => navigator.serviceWorker.controller, {timeout: 90000});
      await page.setOfflineMode(true);
      await page.reload({waitUntil: 'domcontentloaded'});
      await page.waitForSelector(link, {timeout: 30000});
      await page.$eval(link, a => a.scrollIntoView({block: 'center'}));
      await page.tap(link);
      await page.waitForFunction(path => location.pathname === path && document.querySelector('#reader-jump')?.textContent === 'Proverbs 16', {timeout: 30000}, target);
      await page.screenshot({path: `${output}/${name}-offline-scripture.png`});
      await page.setOfflineMode(false);
    }
    assert.deepEqual(errors, []);
    console.log(`${name}: commentary → Proverbs 16:1 → back; ${name === 'desktop' ? 'keyboard' : 'touch and offline'} activation passed`);
    await context.close();
  }
} finally {
  await browser.close();
}
