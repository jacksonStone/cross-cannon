// Drive translation changes through the actual Rust/WASM settings and Play controls.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import puppeteer from 'puppeteer';

const origin=process.env.BROWSER_TEST_URL??'http://127.0.0.1:3005';
const output='docs/screenshots/translation-audio';
await fs.mkdir(output,{recursive:true});
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--use-gl=angle']});
try {
  for(const [width,height,label] of [[1440,1000,'desktop'],[393,852,'mobile']]) {
    const context=await browser.createBrowserContext();
    const page=await context.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.setViewport({width,height});
    // Playback transport is deterministic; source choice comes from the real reader.
    await page.evaluateOnNewDocument(()=>{
      window.players=[];
      window.Audio=class extends EventTarget {
        constructor(){super();this.paused=true;this.currentTime=0;players.push(this);}
        play(){this.paused=false;this.dispatchEvent(new Event('loadedmetadata'));this.dispatchEvent(new Event('playing'));return Promise.resolve();}
        pause(){this.paused=true;this.dispatchEvent(new Event('pause'));}
        removeAttribute(name){if(name==='src')this.src='';}
        load(){}
      };
    });
    await page.goto(`${origin}/reader/0c558fd2c95099cf1909774d`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.crossCanonReader&&document.querySelector('.passage')&&!document.querySelector('#reader').hidden&&!document.querySelector('#loading'),{timeout:30000});
    const play=async()=>{await page.locator('#reader-tools').click();await page.locator('#tools-menu [aria-label="Play audio"]').click();};
    const settings=async()=>{await page.locator('#reader-tools').click();await page.locator('#tools-menu [aria-label="Reader settings"]').click();};
    const choose=async value=>{
      await page.locator(`#reader-settings [data-setting="translation${value}"]`).click();
      await page.waitForFunction(v=>document.querySelector(`[data-setting="translation${v}"]`)?.getAttribute('aria-pressed')==='true',{},value);
    };
    const source=()=>page.evaluate(()=>players.at(-1)?.src);
    await play();
    await page.waitForFunction(()=>players.at(-1)?.src?.includes('/audio/continuous/bible-john-'));
    await page.locator('#reader-tools').click();await page.locator('#tools-menu [aria-label="Pause audio"]').click();
    await page.waitForFunction(()=>players.at(-1)?.paused);
    await settings();await choose(1);await page.locator('#settings-done').click();await play();
    await page.waitForFunction(()=>players.at(-1)?.src==='https://openbible.com/audio/msb/MSB_43_Jhn_003_D.mp3');
    assert.equal(await page.evaluate(()=>players.at(-1).paused),false);
    await settings();await choose(0);
    await page.waitForFunction(()=>players.at(-1)?.src?.includes('/audio/continuous/bible-john-'));
    await choose(1);
    await page.waitForFunction(()=>players.at(-1)?.src==='https://openbible.com/audio/msb/MSB_43_Jhn_003_D.mp3');
    await page.evaluate(()=>document.fonts.ready);
    await page.screenshot({path:`${output}/${label}-msb-settings.png`});
    await page.locator('#settings-done').click();
    await page.evaluate(()=>players.at(-1).dispatchEvent(new Event('ended')));
    await page.waitForFunction(()=>players.at(-1)?.src==='https://openbible.com/audio/msb/MSB_43_Jhn_004_D.mp3');
    const before=await page.evaluate(()=>players.length);
    await page.evaluate(()=>players.at(-1).dispatchEvent(new Event('error')));
    await page.waitForFunction(()=>document.querySelector('#reader-status')?.textContent.includes('Audio unavailable'));
    assert.equal(await page.evaluate(()=>players.length),before,'MSB failure must not load WEB');
    assert.match(await source(),/\/msb\//);
    assert.deepEqual(errors,[]);
    console.log(`${label}: WEB → paused MSB → playing WEB → playing MSB → next MSB chapter; no WEB fallback`);
    await context.close();
  }
} finally {await browser.close();}
