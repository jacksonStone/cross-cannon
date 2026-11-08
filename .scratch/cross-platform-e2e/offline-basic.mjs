import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const origin='http://127.0.0.1:13616',out='docs/screenshots/cross-platform-e2e';
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage(),results=[],errors=[],requests=[];
page.setDefaultTimeout(30000);await page.setViewport({width:390,height:844});page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>requests.push({url:r.url(),error:r.failure()?.errorText}));
async function step(name,fn){try{const detail=await fn();results.push({name,status:'pass',detail});console.log('PASS',name);}catch(e){results.push({name,status:'fail',error:e.message});console.error('FAIL',name,e.message);await page.screenshot({path:`${out}/offline-failure-${results.length}.png`});}await writeFile('.scratch/cross-platform-e2e/offline-basic-results.json',JSON.stringify({results,errors,requests},null,2));}
try{
await step('Download a complete Fathers work using the real UI',async()=>{
 if(process.env.PREWARM_BIBLE==='1'){await page.goto(origin+'/',{waitUntil:'networkidle0'});await page.waitForSelector('.reader-passage-text');}
 await page.goto(origin+'/church-fathers',{waitUntil:'networkidle0'});await page.waitForSelector('.reader-passage-text');
 await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload({waitUntil:'networkidle0'});
 await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 await page.click('[aria-label="Open reader tools"]');await page.click('[aria-label="Download work"]');
 await page.waitForSelector('[aria-label="Remove download"]');
 await page.screenshot({path:out+'/web-fathers-downloaded.png'});
 return {title:await page.$eval('#reader-title',e=>e.textContent),cacheKeys:await page.evaluate(()=>caches.keys())};
});
await step('Offline cold reload of downloaded Fathers text',async()=>{
 await page.setOfflineMode(true);await page.reload({waitUntil:'networkidle0'});
 await page.waitForSelector('.reader-passage-text');await page.waitForSelector('.offline-indicator');
 assert((await page.$eval('.reader-passage-text',e=>e.textContent)).length>50);
 await page.screenshot({path:out+'/web-fathers-offline.png'});return await page.$eval('#reader-title',e=>e.textContent);
});
await step('Offline cold navigation to Bible',async()=>{
 await page.goto(origin+'/',{waitUntil:'networkidle0'});await page.waitForSelector('.reader-passage-text');
 const text=await page.$eval('.reader-passage-text',e=>e.textContent);assert(text.includes('beginning'));
 await page.screenshot({path:out+'/web-bible-offline-before-jump.png'});
});
await step('Offline Bible verse jump',async()=>{
 if(await page.$('[aria-label="Open reader tools"]'))await page.click('[aria-label="Open reader tools"]');
 await page.evaluate(()=>[...document.querySelectorAll('.reader-header-actions button')].find(b=>b.textContent.trim()==='Jump').click());
 await page.waitForSelector('.passage-jump-verse');await page.select('.passage-jump-book select','John');
 await page.click('.passage-jump-verse');await page.waitForSelector('#reader-title');await page.waitForSelector('.reader-passage-text');
 await page.screenshot({path:out+'/web-bible-offline.png'});return await page.$eval('#reader-title',e=>e.textContent);
});
await step('Offline cached reader opens in a new tab',async()=>{
 const cold=await browser.newPage();await cold.setViewport({width:390,height:844});await cold.setOfflineMode(true);
 await cold.goto(origin+'/church-fathers',{waitUntil:'networkidle0'});await cold.waitForSelector('.reader-passage-text');
 assert((await cold.$eval('.reader-passage-text',e=>e.textContent)).length>50);await cold.screenshot({path:out+'/web-fathers-offline-new-tab.png'});await cold.close();
});
}finally{await browser.close();}
process.exitCode=results.some(r=>r.status==='fail')?1:0;
