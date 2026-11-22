// Exercise the public browser entry points against the real Rust reader.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import puppeteer from 'puppeteer';

const base = process.env.BROWSER_TEST_URL ?? 'http://127.0.0.1:3005';
const output = 'docs/screenshots/library-release';
const browser = await puppeteer.launch({headless:true,args:['--no-sandbox','--use-gl=angle']});
await fs.mkdir(output,{recursive:true});
try {
  for (const [width,height,label] of [[393,852,'mobile'],[1440,1000,'desktop']]) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror',error=>errors.push(error.message));
    await page.setViewport({width,height,isMobile:width < 700,hasTouch:width < 700});
    await page.goto(base+'/reader/0c558fd2c95099cf1909774d',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>performance.getEntriesByName('cross-canon-readable').length,{timeout:30000});
    await page.evaluate(()=>document.fonts.ready.then(()=>true));
    const dialog = '#library-navigation';
    const title = name => page.waitForFunction(expected=>document.querySelector('#reader-jump').textContent===expected,{},name);
    const shot = async name => {
      await page.$$eval(dialog+' img', async images => {
        const rect = document.querySelector('#library-navigation').getBoundingClientRect();
        await Promise.all(images.filter(img=>img.getBoundingClientRect().top < rect.bottom).map(img=>img.decode()));
      });
      await page.evaluate(()=>document.getAnimations().forEach(animation=>animation.finish()));
      const fits = await page.$eval(dialog,d=>d.scrollWidth<=d.clientWidth);
      assert.ok(fits,`${label}: ${name} fits horizontally`);
      await page.screenshot({path:`${output}/${label}-${name}.png`});
    };
    await title('John 3');
    await page.click('#reader-library');
    await page.waitForSelector(dialog+'[data-screen="home"][open]');
    await shot('home');
    await page.click(dialog+' .library-hero [data-action="picker"]');
    await page.waitForSelector(dialog+'[data-step="books"] [data-book="John"]');
    await shot('books');
    await page.click(dialog+' [data-book="John"]');
    await page.waitForSelector(dialog+'[data-step="chapters"] [data-chapter="4"]',{visible:true});
    await page.waitForSelector(dialog+' [data-verse="36"]',{visible:true});
    assert.equal(await page.$(dialog+' [data-verse-mode]'),null,'Verses are always available without a toggle');
    const verseBelowChapters = await page.$eval(dialog,d=>d.querySelector('.library-verses').getBoundingClientRect().top >= d.querySelector('.library-chapters > .library-numbers').getBoundingClientRect().bottom);
    assert.ok(verseBelowChapters,`${label}: verses appear below chapters`);
    await shot('chapters');
    await page.click(dialog+' [data-chapter="4"]');
    await page.waitForSelector(dialog+' [data-chapter="4"][aria-pressed="true"]');
    await page.waitForSelector(dialog+' [data-verse="54"]');
    assert.equal(await page.$(dialog+' [data-verse="55"]'),null,'Verses match the selected chapter');
    await page.click(dialog+' [data-action="open-chapter"]');
    await title('John 4');
    assert.equal(await page.$(dialog+'[open]'),null);

    // A reader-title tap opens the current book with one chapter tap left.
    await page.click('#reader-jump');
    await page.waitForSelector(dialog+'[data-step="chapters"] [data-chapter="5"]',{visible:true});
    const field = dialog+' [data-reference-search]';
    await page.type(field,'Rom 8:28');
    await page.waitForFunction(()=>document.querySelector('#library-navigation [data-match] strong')?.textContent==='Romans 8:28');
    await shot('reference');
    await page.keyboard.press('Enter');
    await title('Romans 8');
    await page.waitForFunction(()=>[...document.querySelectorAll('.passage')].some(p=>p.dataset.reference?.includes('Romans 8:28') || p.textContent.includes('work together for good')));

    await page.click('#reader-jump');
    await page.click(dialog+' [data-chapter="8"]');
    await page.waitForSelector(dialog+' [data-verse="28"]',{visible:true});
    await shot('verses');
    await page.click(dialog+' [data-verse="28"]');
    await page.waitForSelector(dialog+'[open]',{hidden:true});

    await page.click('#reader-jump');
    if (width < 700) await page.click(dialog+' [data-action="books"]');
    await page.click(dialog+' [data-book="Philemon"]');
    await page.waitForSelector(dialog+' [data-chapter="1"][aria-pressed="true"]');
    await page.waitForSelector(dialog+' [data-verse="25"]');
    assert.equal(await page.$(dialog+' [data-verse="26"]'),null,'Changing books resets to a valid chapter');
    await page.keyboard.press('Escape');

    await page.click('#reader-library');
    await page.click(dialog+' .library-shelf-heading [data-action="browse"]');
    await page.waitForSelector(dialog+'[data-screen="browse"]');
    await shot('library');
    const work = dialog+' [data-work="npnf101:vi"]';
    await page.type(dialog+' [data-work-search]','Confessions');
    await page.waitForSelector(work);
    await shot('library-search');
    await page.click(dialog+' [data-favorite="npnf101:vi"]');
    await page.click(dialog+' [data-collection="favorites"]');
    await page.waitForSelector(work);
    await page.click(dialog+' [data-contents="npnf101:vi"]');
    await page.waitForSelector(dialog+'[data-screen="contents"] [data-chapter]',{visible:true});
    await page.click(dialog+' [data-chapter]');
    await page.waitForFunction(()=>document.querySelector('#reader-jump').textContent.includes('Confessions'));
    await page.click('#reader-jump');
    await page.waitForSelector(dialog+'[data-screen="contents"][open]');
    await page.keyboard.press('Escape');
    await page.waitForSelector(dialog+'[open]',{hidden:true});
    assert.deepEqual(errors,[]);
    console.log(`${label}: library covers, search, favorites, contents, chapter and verse navigation passed`);
    await context.close();
  }
} finally { await browser.close(); }
