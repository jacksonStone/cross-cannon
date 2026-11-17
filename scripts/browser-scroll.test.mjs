// Wheel events must reach the shared Rust scroll area through HTML button overlays.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import puppeteer from 'puppeteer';

const origin=process.env.BROWSER_TEST_URL??'http://127.0.0.1:3117';
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--use-gl=angle']});
const results=[];
try {
  for(const [width,height,label] of [[1440,1000,'desktop'],[393,852,'mobile']]) {
    const context=await browser.createBrowserContext();
    const page=await context.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.setViewport({width,height});
    await page.goto(`${origin}/reader/0c558fd2c95099cf1909774d`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.crossCanonReader&&document.querySelectorAll('.passage').length>0&&!document.querySelector('#reader').hidden,{timeout:30000});
    await page.click('#reader-library');
    const anchor='#dialog-accessibility [aria-label="Genesis"]';
    const button='#dialog-accessibility [aria-label="Read book"]';
    await page.waitForSelector(button);
    const position=()=>page.$eval(anchor,element=>element.getBoundingClientRect().top);
    const wheel=async(deltaY)=>{
      const box=await (await page.$(button)).boundingBox();
      await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
      await page.mouse.wheel({deltaY});
      // Allow egui's smooth scrolling to settle before comparing directions.
      await new Promise(resolve=>setTimeout(resolve,700));
    };
    const before=await position();
    await wheel(160);
    const down=await position();
    assert.ok(down<before-30,`${label}: wheel down over a button did not scroll (${before} -> ${down})`);
    await wheel(-160);
    const up=await position();
    assert.ok(up>down+30,`${label}: wheel up over a button did not scroll (${down} -> ${up})`);
    await fs.mkdir('docs/screenshots/rust-browser',{recursive:true});
    await page.screenshot({path:`docs/screenshots/rust-browser/${label}-wheel-library.png`});
    await page.click('#dialog-accessibility [aria-label="Close"]');
    await page.waitForFunction(()=>!document.querySelector('#reader').hidden);
    assert.deepEqual(errors,[]);
    results.push({viewport:label,before,down,up,buttonClickAfterScroll:true});
    await context.close();
  }
} finally {await browser.close();console.log(JSON.stringify(results,null,2));}
