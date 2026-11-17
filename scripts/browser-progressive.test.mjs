import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import fs from 'node:fs/promises';
const origin=process.env.BROWSER_TEST_URL??'http://127.0.0.1:3117';
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--use-gl=angle']});
const report=[];
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewport({width:393,height:852,deviceScaleFactor:2,isMobile:true,hasTouch:true});
 await page.goto(origin+'/reader/0c558fd2c95099cf1909774d');
 await page.waitForFunction(()=>performance.getEntriesByName('cross-canon-readable').length);
 const manifest=await fetch(origin+'/browser/manifest.json').then(r=>r.json());
 const archive=await fetch(origin+manifest.archive).then(r=>r.json());
 const catalog=await fetch(origin+manifest.catalog).then(r=>r.json());
 const clement=Object.keys(archive).find(id=>id.startsWith('anf09:xii.iv.'));
 const classic=Object.keys(catalog.chapters).find(id=>catalog.chapters[id].scriptureReference?.book==='Genesis'&&catalog.chapters[id].scriptureReference.chapter===50);
 assert.ok(clement);assert.ok(classic);
 const link=async url=>page.evaluate(url=>window.crossCanonReader.dispatch(JSON.stringify({action:'link',id:url})),url);
 const classicURL='https://www.crosscanon.com/christian-classics/read?chapter='+encodeURIComponent(classic);
 const clementURL='https://www.crosscanon.com/church-fathers?chapter='+encodeURIComponent(clement);
 // Hold an uncached destination. The existing reader must remain usable while
 // it loads, and a subsequent action must win even if the old request finishes.
 await page.setRequestInterception(true);let held;let release;
 const heldPromise=new Promise(resolve=>release=resolve);
 const intercept=async request=>{if(request.url()===origin+archive[classic].text&&!held){held=request;release();}else await request.continue();};
 page.on('request',intercept);await link(classicURL);await heldPromise;
 assert.equal(await page.$eval('#reader-jump',e=>e.textContent),'John 3');assert.equal(await page.$('#loading'),null);
 await link('https://www.crosscanon.com/reader/0c558fd2c95099cf1909774d');await held.continue();
 await new Promise(r=>setTimeout(r,1000));assert.equal(await page.$eval('#reader-jump',e=>e.textContent),'John 3');
 page.off('request',intercept);await page.setRequestInterception(false);report.push({deferredNavigationKeepsTextAndLaterActionWins:true});
 await link(clementURL);await page.waitForFunction(()=>document.querySelector('#reader-jump').textContent.includes('Clement'));
 assert.ok(await page.$eval('#reader-text',e=>e.textContent.length)>500);await page.screenshot({path:'docs/screenshots/rust-browser/mobile-progressive-clement.png'});
 await link(classicURL);await page.waitForFunction(()=>document.querySelector('#reader-jump').textContent.includes('50'));
 assert.ok(await page.$eval('#reader-text',e=>e.textContent.length)>500);await page.screenshot({path:'docs/screenshots/rust-browser/mobile-progressive-classic.png'});
 report.push({lazyFathersAndClassics:true,clement,classic});
 await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));});
 await page.setOfflineMode(true);
 // Both target works can be reopened without network after complete staging.
 await link(clementURL);await page.waitForFunction(()=>document.querySelector('#reader-jump').textContent.includes('Clement'));
 await link('https://www.crosscanon.com/reader/0c558fd2c95099cf1909774d');await page.waitForFunction(()=>document.querySelector('#reader-jump').textContent==='John 3');
 await page.click('#reader-tools');await page.click('#tools-menu [aria-label="Reader settings"]');
 const translation=await page.$$eval('#reader-settings [data-setting]',els=>els.map(e=>({key:e.dataset.setting,text:e.textContent})));
 report.push({settings:translation});
 const msb=await page.$('#reader-settings [data-setting="translation1"]');assert.ok(msb);await msb.click();await page.click('#settings-done');
 await page.waitForFunction(()=>document.querySelector('#reader-text').textContent.includes('MSB'));
 await page.click('#reader-tools');await page.click('#tools-menu [aria-label="Search"]');
 await page.waitForSelector('#dialog-accessibility [aria-label="Search Keywords"]');await page.click('#dialog-accessibility [aria-label="Search Keywords"]');
 const input=await page.$('#dialog-accessibility textarea, #dialog-accessibility input');await input.type('Nicodemus');
 await page.waitForSelector('#dialog-accessibility [aria-label="Search Bible"]');await page.click('#dialog-accessibility [aria-label="Search Bible"]');
 await page.waitForFunction(()=>document.querySelector('#dialog-accessibility [aria-label*="John 3"]'),{timeout:60000});
 report.push({offlineKeywordAndMsb:true,errors});assert.deepEqual(errors,[]);
}finally{await browser.close();await fs.writeFile('.tmp/browser-progressive-regression.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
