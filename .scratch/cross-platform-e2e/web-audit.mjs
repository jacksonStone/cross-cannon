import puppeteer from 'puppeteer';
import {mkdir, writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const origin=process.env.E2E_BASE_URL??'http://127.0.0.1:13616';
const out='docs/screenshots/cross-platform-e2e';
await mkdir(out,{recursive:true});
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox']});
const results=[],errors=[],metrics=[];
let page,context,serial=0;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function test(name,fn){
  const start=performance.now();
  try {const detail=await fn();results.push({name,status:'pass',ms:Math.round(performance.now()-start),detail});console.log('PASS',name);}
  catch(e){results.push({name,status:'fail',error:e.message,ms:Math.round(performance.now()-start)});console.error('FAIL',name,e.message);await page?.screenshot({path:`${out}/failure-${results.length}.png`}).catch(()=>{});}
  await writeFile('.scratch/cross-platform-e2e/web-results.json',JSON.stringify({origin,results,errors,metrics},null,2));
}
async function fresh(corpus,width){
  await context?.close();context=await browser.createBrowserContext();page=await context.newPage();page.setDefaultTimeout(15000);
  await page.setViewport({width,height:width<600?844:886,deviceScaleFactor:1});
  page.on('pageerror',e=>errors.push(e.message));
  await page.setExtraHTTPHeaders({'x-forwarded-for':`127.0.43.${++serial}`});
  await page.goto(`${origin}${corpus==='fathers'?'/church-fathers':''}`,{waitUntil:'networkidle0'});
  await page.waitForSelector('.reader-passage-text');await page.evaluate(()=>document.fonts.ready);await pause(250);
}
async function tools(){if(await page.$('[aria-label="Open reader tools"]'))await page.click('[aria-label="Open reader tools"]');}
async function button(text,scope='body'){
  const ok=await page.evaluate(({text,scope})=>{
    const b=[...document.querySelectorAll(`${scope} button`)].find(b=>(b.textContent.trim()===text || (text==='Filters' && b.textContent.trim().startsWith('Filters'))));
    if(!b)return false;b.click();return true;
  },{text,scope});assert(ok,`Missing button ${text} in ${scope}`);
}
async function capture(name){await page.screenshot({path:`${out}/${name}.png`});}
async function search(){await tools();await page.click('[aria-label="Search"]');await page.waitForSelector('#question');}
async function runSearch(){
  const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().startsWith(origin)).catch(()=>null);
  await page.click('.search-button');const r=await response;const body=await r.json();assert(!body.error,body.error);
  await page.waitForFunction(()=>!document.querySelector('.search-modal [aria-busy="true"]'));
  await page.waitForSelector('.search-modal .scripture-result');return body;
}
try{
for(const width of [1003,390])for(const corpus of ['bible','fathers']){
const prefix=`${width<600?'mobile':'desktop'}-${corpus}`;
await test(`${prefix}: reader and default visual`,async()=>{
  await fresh(corpus,width);assert((await page.$eval('.reader-passage-text',e=>e.textContent)).length>30);
  const m=await page.$eval('.reader-passage-text',e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return {font:s.fontFamily,weight:s.fontWeight,size:s.fontSize,lineHeight:s.lineHeight,width:r.width,top:r.top,background:getComputedStyle(document.querySelector('.reader-page')).backgroundColor,horizontalOverflow:document.documentElement.scrollWidth>innerWidth};});
  assert(!m.horizontalOverflow);metrics.push({prefix,...m});await capture(`web-${prefix}`);return m;
});
await test(`${prefix}: all themes, presets, settings persistence and dismiss`,async()=>{
  await tools();await page.click('[aria-label="Reader text settings"]');
  for(const theme of ['Paper','Sepia','Dark','Contrast']){await page.click(`.reader-settings-panel [aria-label="${theme}"]`);await pause(30);assert((await page.$eval('.reader-page',e=>e.className)).includes(`reader-theme-${theme.toLowerCase()}`));}
  for(const preset of ['Compact','Open','Relaxed','Default'])await button(preset,'.reader-settings-panel');
  await page.$eval('.reader-settings-panel input[type="range"]',e=>{e.value='1.2';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.click('.reader-settings-panel [aria-label="Dark"]');await capture(`web-${prefix}-settings`);
  await page.keyboard.press('Escape');assert.equal(await page.$('.reader-settings-panel'),null);
  await page.reload({waitUntil:'networkidle0'});assert((await page.$eval('.reader-page',e=>e.className)).includes('reader-theme-dark'));
  await tools();await page.click('[aria-label="Reader text settings"]');await page.click('.reader-settings-panel [aria-label="Paper"]');await button('Default','.reader-settings-panel');
  await page.mouse.click(8,500);assert.equal(await page.$('.reader-settings-panel'),null);
});
await test(`${prefix}: jump, canon/author, and dismissal`,async()=>{
 await tools();await button('Jump','.reader-header-actions');await page.waitForSelector('.passage-jump-modal');
 if(corpus==='bible'){
  await page.select('.passage-jump-modal [aria-label="Canon"]','orthodox');
  const bookSelect='.passage-jump-book select';assert((await page.$$eval(`${bookSelect} option`,es=>es.map(e=>e.textContent))).includes('Tobit'));
  await page.select(bookSelect,'John');await button('3','[aria-label="Chapter"]');
  await page.waitForSelector('.passage-jump-verse');await capture(`web-${prefix}-jump`);
  await page.evaluate(()=>[...document.querySelectorAll('.passage-jump-verse')].find(e=>e.textContent.trim()==='16').click());
  await page.waitForFunction(()=>document.querySelector('#reader-title')?.textContent.includes('John 3'));assert(page.url().includes('/reader/'));
 }else{
  await page.type('.passage-jump-search','Clement');await pause(100);
  const titles=await page.$$eval('.ec-work-title',es=>es.map(e=>e.textContent));assert(titles.some(t=>t.includes('Clement')));
  await capture(`web-${prefix}-jump`);await page.keyboard.press('Escape');assert.equal(await page.$('.passage-jump-modal'),null);
 }
});
await test(`${prefix}: semantic search, filters, highlights, cross-corpus similarity`,async()=>{
 await fresh(corpus,width);await search();await page.type('#question','More money More Problems');
 await button('Filters','.search-modal');await page.waitForSelector('#filter-modal');
 await page.$eval('[aria-label="Matches"]',e=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(e,'5');e.dispatchEvent(new Event('input',{bubbles:true}));});
 if(corpus==='bible'){await page.select('#filter-modal [aria-label="Canon"]','orthodox');await page.evaluate(()=>[...document.querySelectorAll('#filter-modal label')].find(e=>e.textContent.trim()==='John').querySelector('input').click());}
 else{await page.type('#filter-modal input[type="search"]','Clement');await pause(100);await page.click('#filter-modal input[type="checkbox"]');}
 await capture(`web-${prefix}-filters`);await button('Done','#filter-modal');const body=await runSearch();
 const hits=await page.$$('.search-modal .scripture-result');assert(hits.length>0&&hits.length<=5,`Expected ≤5 results, got ${hits.length}`);
 if(corpus==='bible')assert((await page.$$eval('.search-modal .result-meta',es=>es.map(e=>e.textContent))).every(t=>t.includes('John')));
 await capture(`web-${prefix}-search`);await page.click('.search-modal .scripture-result-button');
 const cross=corpus==='bible'?'Similar in Fathers':'Similar Bible passages';
 const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().startsWith(origin)).catch(()=>null);
 await button(cross,'.search-modal .is-selected');const crossBody=await (await response).json();assert(!crossBody.error,crossBody.error);
 await page.waitForFunction(()=>!document.querySelector('.search-modal [aria-busy="true"]'));assert((await page.$$('.search-modal .scripture-result')).length>0);
 return {count:hits.length,mode:body.mode,crossMode:crossBody.mode};
});
}
await test('Fathers: author filtering, favorite persistence, original/modernized text',async()=>{
 await fresh('fathers',390);await tools();await button('Jump','.reader-header-actions');
 await page.type('.passage-jump-search','Clement');await pause(100);
 const favorite=await page.$('.ec-work-favorite');assert(favorite);await favorite.click();
 const stored=await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.includes('favorite'))));assert(Object.keys(stored).length);
 await page.select('.ec-jump-modal select','Clement of Rome');
 assert((await page.$$eval('.ec-work-meta',es=>es.map(e=>e.textContent))).every(t=>t.includes('Clement')));
 await page.keyboard.press('Escape');await page.reload({waitUntil:'networkidle0'});
 const after=await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.includes('favorite'))));assert.deepEqual(after,stored);
 const orig=await page.$('[title="Show original translation"]');assert(orig,'No original toggle in default work');
 const before=await page.$eval('.reader-passage-text',e=>e.textContent);await orig.click();const original=await page.$eval('.reader-passage-text',e=>e.textContent);assert.notEqual(before,original);
 await capture('web-mobile-fathers-original');await page.click('[title="Show modernized text"]');assert.equal(await page.$eval('.reader-passage-text',e=>e.textContent),before);
});
await test('Mobile: validation, outside-dismiss and landscape overflow',async()=>{
 await fresh('bible',390);await search();await page.type('#question','ab');assert.equal(await page.$eval('#question',e=>e.checkValidity()),false);
 assert.equal(await page.$eval('#question',e=>e.maxLength),500);await page.keyboard.press('Escape');assert.equal(await page.$('.search-modal'),null);
 await page.setViewport({width:844,height:390});await tools();await button('Jump','.reader-header-actions');await capture('web-landscape-jump');
 const over=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert(!over);await page.mouse.click(2,180);assert.equal(await page.$('.passage-jump-modal'),null);
});
await test('Fathers: saved selected paragraph diagnostic',async()=>{
 await fresh('fathers',390);
 await page.evaluate(()=>{localStorage.setItem('cross-cannon:church-fathers-position:v1',JSON.stringify({chapterKey:'anf09:xii.iv.i',corpus:'fathers',passageRange:'4-6',version:2}));localStorage.setItem('cross-cannon:last-reader:v1','fathers');});
 await page.reload({waitUntil:'networkidle0'});await pause(1500);
 const detail=await page.evaluate(()=>({title:document.querySelector('#reader-title')?.textContent,saved:localStorage.getItem('cross-cannon:church-fathers-position:v1'),chapters:[...document.querySelectorAll('.ec-reader-chapter')].map(e=>({id:e.dataset.chapterId,ranges:[...e.querySelectorAll('.reader-passage')].map(p=>({range:p.dataset.passageRange,selected:p.classList.contains('is-selected')}))}))}));
 await writeFile('.scratch/cross-platform-e2e/fathers-restore.json',JSON.stringify(detail,null,2));await capture('web-fathers-restoration');
 assert(detail.chapters.some(c=>c.id==='anf09:xii.iv.i'&&c.ranges.some(p=>p.range==='4-6'&&p.selected)),JSON.stringify(detail).slice(0,500));
});
}finally{await browser.close();}
console.log(JSON.stringify({passed:results.filter(r=>r.status==='pass').length,failed:results.filter(r=>r.status==='fail').length,errors},null,2));
process.exitCode=results.some(r=>r.status==='fail')?1:0;
