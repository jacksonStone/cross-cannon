import puppeteer from 'puppeteer';
import {writeFile} from 'node:fs/promises';
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox']});
const results=[];
try{for(const width of [1003,390])for(const corpus of ['bible','fathers']){
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewport({width,height:width<600?844:886});
 const response=await page.goto('https://www.crosscanon.com'+(corpus==='fathers'?'/church-fathers':''),{waitUntil:'networkidle0'});
 await page.waitForSelector('.reader-passage-text');await page.evaluate(()=>document.fonts.ready);
 const detail=await page.evaluate(()=>({title:document.querySelector('#reader-title')?.textContent,passage:document.querySelector('.reader-passage-text')?.textContent,css:[...document.querySelectorAll('link[rel="stylesheet"]')].map(l=>l.getAttribute('href')),overflow:document.documentElement.scrollWidth>innerWidth,cacheVersion:document.querySelector('[data-scripture-cache-key]')?.getAttribute('value')}));
 await page.screenshot({path:`docs/screenshots/cross-platform-e2e/production-${width<600?'mobile':'desktop'}-${corpus}.png`});
 results.push({width,corpus,status:response.status(),errors,...detail});await page.close();
}}finally{await browser.close();}
await writeFile('.scratch/cross-platform-e2e/production-reference.json',JSON.stringify(results,null,2));console.log(results.map(({passage,...r})=>r));
