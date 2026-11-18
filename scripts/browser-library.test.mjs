// Exercise explicit navigation, author completion and retained results in the real Rust/WASM UI.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import puppeteer from 'puppeteer';

const origin=process.env.BROWSER_TEST_URL??'http://127.0.0.1:3117';
const output='docs/screenshots/library-improvements';
await fs.mkdir(output,{recursive:true});
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--use-gl=angle']});
const results=[];
const selector=label=>`#dialog-accessibility [aria-label=${JSON.stringify(label)}]`;
const pause=()=>new Promise(resolve=>setTimeout(resolve,250));
let page;
try {
  for(const [width,height,label] of [[1440,1000,'desktop'],[768,1024,'tablet'],[393,852,'mobile'],[320,740,'small-mobile']]) {
    const context=await browser.createBrowserContext();page=await context.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
    await page.setViewport({width,height});
    await page.goto(`${origin}/reader/0c558fd2c95099cf1909774d`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.crossCanonReader&&document.querySelector('.passage')&&!document.querySelector('#reader').hidden&&!document.querySelector('#loading'),{timeout:30000});
    await page.evaluate(()=>document.fonts.ready);
    const geometry=await page.evaluate(()=>{
      const button=document.querySelector('button#reader-library'),title=document.querySelector('#reader-jump'),tools=document.querySelector('#reader-tools');
      const b=button.getBoundingClientRect(),t=title.getBoundingClientRect(),r=tools.getBoundingClientRect();
      const text=document.querySelector('#reader-text'),s=document.querySelector('#reader-scroll').getBoundingClientRect();
      return {button:{left:b.left,right:b.right,height:b.height},libraryLabel:button.textContent.trim(),title:{left:t.left,right:t.right},tools:{left:r.left,right:r.right},readingWidth:s.width,weight:getComputedStyle(text).fontWeight,overflow:document.documentElement.scrollWidth>innerWidth};
    });
    assert.ok(geometry.button.height>=44&&geometry.button.left>=0);
    assert.ok(geometry.title.right<=geometry.tools.left&&geometry.tools.right<=geometry.button.left);
    assert.ok(geometry.button.right<=width);assert.equal(geometry.overflow,false);
    assert.equal(geometry.libraryLabel,'');
    if(width>=700){assert.equal(geometry.weight,'400');assert.ok(geometry.readingWidth<=864);}
    await page.screenshot({path:`${output}/${label}-reader.png`});
    await page.click('#reader-library');
    await page.waitForSelector(selector('Choose where to read'));
    await page.click(selector('Fathers'));
    const author=selector('Find a Library author');
    await page.waitForSelector(author);
    await pause();await page.screenshot({path:`${output}/${label}-fathers.png`});
    await page.waitForSelector('#dialog-accessibility [aria-label$="works · scroll to browse"]');
    const firstWork=await page.$$eval('#dialog-accessibility button',els=>els.map(e=>({label:e.getAttribute('aria-label'),y:e.getBoundingClientRect().top})).find(e=>e.label?.includes(' · ')&&!e.label.startsWith('Last place')));
    const fieldY=await page.$eval(author,e=>e.getBoundingClientRect().top);
    const first=await page.$(selector(firstWork.label)),box=await first.boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel({deltaY:140});
    await new Promise(resolve=>setTimeout(resolve,700));
    const moved=await page.$(selector(firstWork.label));
    assert.ok(!moved||await moved.evaluate(e=>e.getBoundingClientRect().top)<firstWork.y-30,'Fathers works must scroll inside the bordered list');
    assert.ok(Math.abs(await page.$eval(author,e=>e.getBoundingClientRect().top)-fieldY)<1,'Scrolling works must leave author controls in place');
    await page.mouse.wheel({deltaY:-10000});await new Promise(resolve=>setTimeout(resolve,700));
    // Keyboard selection commits a canonical author after filtering.
    await page.type(author,'cLeM');
    await page.waitForSelector(selector('Clement of Alexandria'));
    await page.waitForSelector(selector('Clement of Rome'));
    assert.equal(await page.$(selector('Augustine of Hippo')),null,'Author suggestions must filter as you type');
    await pause();await page.screenshot({path:`${output}/${label}-autocomplete.png`});
    await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
    await page.waitForFunction(sel=>document.querySelector(sel)?.value==='Clement of Rome',{},author);
    await page.waitForFunction(()=>[...document.querySelectorAll('#dialog-accessibility button')].some(e=>e.getAttribute('aria-label')?.includes('The First Epistle of Clement')));
    assert.equal(await page.$(selector('Clement of Alexandria')),null,'Choosing an author closes suggestions');
    await pause();await page.screenshot({path:`${output}/${label}-author-selected.png`});
    await page.click(author);await page.waitForSelector(selector('All authors'));await page.click(selector('All authors'));
    await page.waitForFunction(sel=>document.querySelector(sel)?.value==='',{},author);
    await page.type(author,'augustine');await page.waitForSelector(selector('Augustine of Hippo'));await page.click(selector('Augustine of Hippo'));
    await page.waitForFunction(sel=>document.querySelector(sel)?.value==='Augustine of Hippo',{},author);
    await page.click(selector('Close'));
    await page.waitForFunction(()=>!document.querySelector('#reader').hidden);
    // Keyword mode exercises the real local commentary corpus without paid embedding requests.
    await page.click('#reader-tools');await page.click('#tools-menu [aria-label="Search"]');
    await page.waitForSelector(selector('Search Keywords'));await page.click(selector('Search Keywords'));
    await page.click(selector('CLASSICS'));
    const query=selector('Search by theme or words');
    await page.type(query,'mercy');
    await page.waitForSelector(selector('Search Classics'));await page.click(selector('Search Classics'));
    await page.waitForFunction(()=>[...document.querySelectorAll('#dialog-accessibility span')].some(e=>e.textContent.length>180),{timeout:30000});
    // Move beyond the form; use real wheel routing over canvas and semantic controls.
    await page.mouse.move(width/2,height*0.75);await page.mouse.wheel({deltaY:900});
    await new Promise(resolve=>setTimeout(resolve,700));
    const visible=()=>page.$$eval('#dialog-accessibility span',els=>els.filter(e=>e.textContent.length>100).map(e=>({label:e.textContent,y:e.getBoundingClientRect().top})).filter(e=>e.y>=90&&e.y<innerHeight-40));
    await page.mouse.move(width-45,40);await pause();
    const clip={x:40,y:120,width:width-100,height:Math.min(400,height-160)};
    const pixels=await page.screenshot({clip});
    const before=await visible();assert.ok(before.length,'Results must remain visible after scrolling');
    await page.screenshot({path:`${output}/${label}-search-scrolled.png`});
    await page.click(selector('Close'));await page.waitForFunction(()=>!document.querySelector('#reader').hidden);
    await page.click('#reader-tools');await page.click('#tools-menu [aria-label="Search"]');
    await page.waitForSelector(selector('Find passages'));
    await page.mouse.move(width-45,40);await pause();
    const restoredPixels=await page.screenshot({clip});
    assert.ok(Buffer.from(pixels).equals(Buffer.from(restoredPixels)),`${label}: reopened results must preserve the exact visible text position`);
    const after=await visible();
    const anchor=after.find(e=>e.label===before[0].label);
    assert.ok(anchor,`${label}: reopening lost the visible result`);
    assert.ok(Math.abs(anchor.y-before[0].y)<2,`${label}: reopening moved results ${before[0].y} -> ${anchor.y}`);
    // Read the retained query after intentionally scrolling the form back into view.
    await page.mouse.move(width/2,height*0.7);await page.mouse.wheel({deltaY:-10000});
    await new Promise(resolve=>setTimeout(resolve,700));
    assert.equal(await page.$eval(query,e=>e.value),'mercy');
    assert.equal(await page.$eval(selector('CLASSICS'),e=>e.getAttribute('aria-pressed')),'true');
    assert.deepEqual(errors,[]);
    results.push({viewport:label,...geometry,restoredResultY:anchor.y,queryRetained:true,authorKeyboardSelection:true,authorPointerSelection:true,worksScroll:true});
    await context.close();page=null;
  }
} catch(error) {
  if(page){await page.screenshot({path:`${output}/failure.png`}).catch(()=>{});console.error(await page.$$eval('#dialog-accessibility>*',els=>els.map(e=>({label:e.getAttribute('aria-label'),value:e.value,top:e.getBoundingClientRect().top}))));}
  throw error;
} finally {
  await browser.close();await fs.writeFile('.tmp/browser-library.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}
