import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const base = 'http://127.0.0.1:13005';
const manifest = JSON.parse(await readFile('scripture-cache/manifest.json', 'utf8'));
const cache = JSON.parse(await readFile(`scripture-cache/${manifest.version}.json`, 'utf8'));
const source = cache.passages.find(p => /^Proverbs 16:1(?:-|$)/.test(p.reference));
assert(source);
const folder = 'docs/screenshots/classics-correlation-search';
await mkdir(folder, { recursive: true });
const browser = await puppeteer.launch({headless:'shell',args:['--no-sandbox']});
try {
  for (const [device,width,height] of [['desktop',1440,1000],['mobile',390,844]]) {
    const page = await browser.newPage();
    await page.setViewport({width,height});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request',request=>/https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(request.url()) ? request.abort() : request.continue());
    await page.goto(base, {waitUntil:'networkidle2'});
    await page.waitForSelector('.reader-tools-trigger');
    await page.click('.reader-tools-trigger');
    await page.click('button[aria-label="Search"]');
    await page.waitForSelector('.search-modal form.search-form');
    await page.click('.search-modal input[value="christian-classics"]');
    await page.$eval('.search-modal form.search-form',(form,sourceId)=>{
      form.querySelector('[name="intent"]').value='similar-classics';
      for (const [name,value] of [['sourcePassageId',sourceId],['earlyChristianAuthors','Matthew Henry and continuators']]) {
        const input=document.createElement('input');input.type='hidden';input.name=name;input.value=value;form.append(input);
      }
      const textarea=form.querySelector('textarea');textarea.required=false;
      form.requestSubmit();
    },source.id);
    await page.waitForFunction(()=>document.querySelectorAll('.ec-results .scripture-result').length===10,{timeout:30000});
    const cards=await page.$$eval('.ec-results .scripture-result',nodes=>nodes.map(node=>({header:node.querySelector('.result-meta').innerText,text:node.querySelector('.scripture-result-text').innerText,hasInternalNumber:!!node.querySelector('.result-range-label')})));
    assert(cards.some(card=>card.header.toLowerCase().includes('proverbs 16:1')));
    assert(cards.every(card=>!card.hasInternalNumber));
    await page.$eval('.ec-results',(results)=>{
      const body=results.closest('.search-modal-body');body.scrollTop=results.offsetTop-body.offsetTop;
    });
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:`${folder}/search-${device}.png`});
    assert.deepEqual(errors,[]);
    console.log(device,JSON.stringify(cards[0]),'No internal sentence-number prefixes or browser errors.');
    await page.close();
  }
} finally {await browser.close();}
