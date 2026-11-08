import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer';

const dir=path.resolve('docs/screenshots/cross-platform-e2e');
const report=path.resolve('docs/test-reports/cross-platform-2026-11-01');
await mkdir(report,{recursive:true});
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const card=(name,file,note='')=>`<figure><figcaption><b>${name}</b><small>${note}</small></figcaption><a href="${file}"><img src="${file}" alt="${esc(name)}" /></a></figure>`;
const css=`*{box-sizing:border-box}body{margin:0;padding:28px;background:#eae7e0;color:#282620;font:16px system-ui,sans-serif}h1{font-size:28px;margin:0 0 8px}h2{font-size:23px;margin:24px 0 12px}p{line-height:1.5;margin:8px 0 18px}nav{display:flex;gap:16px;flex-wrap:wrap}a{color:#783b2d}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;align-items:start}.four{grid-template-columns:2.57fr 2.57fr 1fr 1fr}figure{margin:0;background:#fbfaf7;border:1px solid #d1cbc0;border-radius:9px;overflow:hidden}figcaption{padding:12px 16px;min-height:65px;background:white;font-size:17px}small{display:block;color:#625e56;font-size:13px;margin-top:4px}img{display:block;width:100%;height:auto}.phones{max-width:920px;margin:auto}.detail{max-width:1300px}.note{background:#fff5d9;padding:12px;border-radius:8px}@media(max-width:900px){.four{grid-template-columns:1fr 1fr}body{padding:14px}}`;
const shell=(title,content)=>`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${css}</style><body><h1>${title}</h1>${content}</body></html>`;
const readerCards=(corpus)=>[
 card('Web · desktop',`production-desktop-${corpus}.png`,'Live production · 1003 × 886 CSS pixels'),
 card('Cross Canon Desktop',`desktop-${corpus}.png`,'Rust / egui · 1003 × 914 points, title bar included'),
 card('Web · mobile',`production-mobile-${corpus}.png`,'Live production · Chromium 390 × 844 CSS pixels'),
 card('Cross Canon · iOS',`ios-${corpus}.png`,'iPhone 16e Simulator · 390 × 844 points, safe areas included')
];
let gallery='<p>Captured 1 November 2026. Actual application screenshots, scaled proportionally. Bible: Genesis 1. Fathers: First Epistle of Clement, chapter 1. Paper theme and default reading settings.</p><nav><a href="#bible">Bible</a><a href="#fathers">Fathers</a><a href="#search">Search</a><a href="#settings">Settings</a><a href="#failures">Findings</a><a href="../../test-reports/cross-platform-2026-11-01.md">Full test report</a></nav>';
for(const corpus of ['bible','fathers'])gallery+=`<section id="${corpus}"><h2>${corpus==='bible'?'Bible':'Church Fathers'}</h2><div class="grid four">${readerCards(corpus).join('')}</div></section>`;
gallery+='<section id="search"><h2>Native semantic search</h2><p>Same query: “More money More Problems”, Bible, 10 results. Both begin with Luke 16:10–14. Live contract tests also matched eight web/native searches.</p><div class="grid detail">'+card('Desktop · online semantic search','desktop-search.png')+card('iOS · online semantic search','ios-search.png')+'</div><h2>Local Fathers keyword search with API unavailable</h2><p>“Rome” works locally. The iOS capture additionally applies the Clement of Rome author filter; these result counts intentionally differ.</p><div class="grid detail">'+card('Desktop · Fathers keywords','desktop-local-fathers-search.png','10 results, no author filter')+card('iOS · Fathers keywords','ios-local-fathers-search-window.png','Clement of Rome author filter: 1 result')+'</div></section>';
gallery+='<section id="settings"><h2>Settings controls</h2><p>These show control layout, not a matched theme: web captures use Dark; native captures use Paper.</p><div class="grid four">'+card('Web desktop','web-desktop-bible-settings.png')+card('Rust desktop','desktop-settings.png')+card('Web mobile','web-mobile-bible-settings.png')+card('iOS native','ios-settings-window.png')+'</div></section>';
gallery+='<section id="failures"><h2>Reproduced findings</h2><div class="grid detail">'+card('Desktop · long Fathers title overlaps tools','desktop-fathers-header-overlap.png')+card('Web · offline Bible verse jump fails','offline-failure-4.png')+card('Web · downloaded Fathers still reads offline','offline-failure-2.png','Offline status indicator is missing')+card('Web · Fathers Jump ignores Escape','failure-7.png')+'</div><p class="note">iOS swipe scrolling is unverified: the automation drag also failed to scroll Safari. Simulator results do not certify physical-device gestures, accessibility, background audio, or sound quality.</p></section>';
await writeFile(path.join(dir,'comparison.html'),shell('Cross Canon · cross-platform comparison',gallery));
for(const kind of ['desktop','mobile']){
 let content='<p>1 November 2026 · Actual screenshots, Paper theme, default text settings. Images preserve their original proportions.</p>';
 for(const corpus of ['bible','fathers']){
  const cards=readerCards(corpus);
  content+=`<section><h2>${corpus==='bible'?'Genesis 1':'First Epistle of Clement · chapter 1'}</h2><div class="grid ${kind==='mobile'?'phones':''}">${kind==='desktop'?cards.slice(0,2).join(''):cards.slice(2).join('')}</div></section>`;
 }
 await writeFile(path.join(dir,`${kind}-comparison.html`),shell(`Cross Canon · ${kind==='desktop'?'Web and Rust desktop':'Mobile web and iOS native'}`,content));
}
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox']});
for(const kind of ['desktop','mobile']){
 const page=await browser.newPage();await page.setViewport({width:kind==='desktop'?2100:960,height:1000,deviceScaleFactor:1});
 await page.goto(`file://${dir}/${kind}-comparison.html`,{waitUntil:'networkidle0'});
 await page.screenshot({path:path.join(dir,`${kind}-comparison.png`),fullPage:true});await page.close();
}
await browser.close();
for(const f of ['baseline.json','bundled-fathers.json','reader-results.json','web-results.json','offline-basic-results.json','production-reference.json','fathers-audio.json','fathers-restore.json'])await copyFile(`.scratch/cross-platform-e2e/${f}`,path.join(report,f));
for(const f of ['web-audit.mjs','reader-continue.ts','fathers-hydrated.ts','offline-basic.mjs','offline-continue.ts','fathers-audio.mjs','production-reference.mjs','build-gallery.mjs'])await copyFile(`.scratch/cross-platform-e2e/${f}`,path.join(report,f));
for(const name of ['verify','rust-tests','live-parity','reader','reader-continue','fathers-hydrated','responsive','audio-start','audio-real','fathers-audio','web-audit','offline','offline-deep','offline-basic-warm','ios-rebuild']){
 try{await copyFile(`.tmp/cross-platform-${name}.log`,path.join(report,`${name}.log`));}catch(e){console.warn(name,e.message);}
}
console.log('Saved comparison gallery, two boards, and audit evidence.');
