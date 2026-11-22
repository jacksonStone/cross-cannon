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
    // The first text snapshot can precede removal of the blocking startup overlay.
    // Wait for interactive controls before sending a real pointer click.
    await page.waitForFunction(()=>window.crossCanonReader&&document.querySelectorAll('.passage').length>0&&!document.querySelector('#reader').hidden&&!document.querySelector('#loading'),{timeout:30000});
    assert.ok(await page.$('button#reader-library'), 'Reader exposes an explicit Library button');
    await page.evaluate(() => window.crossCanonReader.dispatch(JSON.stringify({action:'library'})));
    await page.waitForSelector('#dialog-accessibility [aria-label="Choose where to read"]');
    const lastPlace='#dialog-accessibility [aria-label^="Last place ·"]';
    await page.waitForSelector(lastPlace);
    const positions=await page.evaluate(()=>({
      tabs:document.querySelector('#dialog-accessibility [aria-label="Bible"]').getBoundingClientRect().bottom,
      resume:document.querySelector('#dialog-accessibility [aria-label^="Last place ·"]').getBoundingClientRect().top,
    }));
    assert.ok(positions.resume>=positions.tabs, `${label}: Last place belongs below the collection buttons`);
    // AccessKit updates precede the canvas presentation; let the preview paint.
    await new Promise(resolve=>setTimeout(resolve,150));
    await fs.mkdir('docs/screenshots/unified-library',{recursive:true});
    await page.screenshot({path:`docs/screenshots/unified-library/${label}.png`});
    await page.click('#dialog-accessibility [aria-label="Classics"]');
    await page.waitForSelector('#dialog-accessibility [aria-label="Find a work or author"]');
    await page.type('#dialog-accessibility [aria-label="Find a work or author"]','Henry');
    // A long commentary exercises the continuous picker and its virtual chapter grid.
    for(let attempt=0;attempt<20&&!await page.$('#dialog-accessibility [aria-label="119"]');attempt++) {
      await page.mouse.move(width/2, height*0.75);
      await page.mouse.wheel({deltaY:160});
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    const anchor='#dialog-accessibility [aria-label="119"]';
    const button=anchor;
    await page.waitForSelector(button);
    const position=()=>page.$eval(anchor,element=>element.getBoundingClientRect().top);
    const wheel=async(deltaY)=>{
      const box=await (await page.$(button)).boundingBox();
      await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
      await page.mouse.wheel({deltaY});
      // Allow egui's smooth scrolling to settle before comparing directions.
      await new Promise(resolve=>setTimeout(resolve,700));
    };
    // Keep the observed virtual row away from both clipping edges.
    await wheel(Math.round(height*0.3));
    const before=await position();
    await wheel(160);
    const down=await position();
    assert.ok(down<before-30,`${label}: wheel down over a button did not scroll (${before} -> ${down})`);
    await wheel(-160);
    const up=await position();
    assert.ok(up>down+30,`${label}: wheel up over a button did not scroll (${down} -> ${up})`);
    await fs.mkdir('docs/screenshots/rust-browser',{recursive:true});
    await page.screenshot({path:`docs/screenshots/rust-browser/${label}-wheel-library.png`});
    await page.mouse.move(width/2,height*0.4);
    await page.mouse.wheel({deltaY:-10000});
    await new Promise(resolve=>setTimeout(resolve,700));
    await page.click('#dialog-accessibility [aria-label="Bible"]');
    await page.waitForSelector(lastPlace);
    await page.click(lastPlace);
    await page.waitForFunction(()=>!document.querySelector('#reader').hidden);
    assert.equal(await page.$eval('#reader-jump',element=>element.textContent),'John 3');
    assert.deepEqual(errors,[]);
    results.push({viewport:label,before,down,up,buttonClickAfterScroll:true});
    await context.close();
  }
} finally {await browser.close();console.log(JSON.stringify(results,null,2));}
