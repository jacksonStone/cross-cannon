import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import {PNG} from 'pngjs';

const dir=path.resolve('docs/screenshots/cross-platform-2026-11-03');
const report=path.resolve('docs/test-reports/cross-platform-2026-11-03');
const css=`*{box-sizing:border-box}body{margin:0;padding:24px;background:#e8e3db;color:#24211d;font:15px system-ui,sans-serif}h1{font-size:24px;margin:0 0 8px}h2{font-size:20px;margin:24px 0 12px}p{line-height:1.55;margin:8px 0 16px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start}.mobile{max-width:820px}figure{margin:0;border:1px solid #cfc7ba;border-radius:8px;overflow:hidden;background:#fbfaf7}figcaption{padding:12px;background:#fff;font-weight:650;min-height:66px}small{display:block;color:#655e55;font-weight:400;font-size:12px;margin-top:5px}img{display:block;width:100%;height:auto}a{color:#8f3526}.note{padding:12px 16px;background:#fff3d4;border-radius:6px}nav{display:flex;gap:18px;flex-wrap:wrap}@media(max-width:600px){body{padding:10px}.grid{gap:8px}figcaption{padding:8px;font-size:12px}}`;
const shell=(title,content)=>`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${css}</style><h1>${title}</h1>${content}</html>`;
const card=(name,file,note)=>`<figure><figcaption>${name}<small>${note}</small></figcaption><a href="${file}"><img alt="${name}" src="${file}"></a></figure>`;
const row=(kind,state,title,nativeState=state)=>`<section id="${kind}-${state}"><h2>${title}</h2><div class="grid ${kind==='mobile'?'mobile':''}">${card(kind==='mobile'?'Production web · mobile':'Production web · desktop',`web-${kind}-${state}.png`,kind==='mobile'?'Chromium · 390 × 844 CSS px':'Chromium · 1000 × 900 CSS px')}${card(kind==='mobile'?'Native iOS · Simulator':'Native Rust · desktop',kind==='mobile'?`ios-${nativeState}.png`:`native-desktop-${nativeState}.png`,kind==='mobile'?'Rebuilt iPhone 16e · Metal app framebuffer':'Rebuilt macOS app framebuffer')}</div></section>`;
const intro='<p>3 November 2026 · Current native builds beside production web. Actual screenshots, preserved proportions. Bible search: “More money More Problems”, Protestant, 10 matches. Reader: Luke 16:10–14. Fathers: Clement, chapter 1.</p><p class="note">iOS captures come from the rebuilt Simulator app, not a physical phone. Web mobile is responsive Chromium, not Safari. Preview presets can scroll directly to results; the form views show the normal initial result position.</p>';
let content=intro+'<nav><a href="#desktop-search">Desktop search</a><a href="#mobile-search-form">Mobile search</a><a href="#mobile-reader">Readers</a><a href="#mobile-jump">Jump</a><a href="#mobile-fathers-reader">Fathers</a><a href="../../test-reports/cross-platform-2026-11-03.md">Full audit</a></nav>';
content+=row('desktop','search','Search: initial desktop state','search-form');
content+=row('mobile','search-form','Search: initial mobile state');
content+=row('mobile','search-results','Search: body scrolled to results');
for(const kind of ['desktop','mobile']) {
 content+=row(kind,'reader','Luke 16 reader');
 content+=row(kind,'jump','Bible chapter and verse picker');
 content+=row(kind,'settings','Reader settings');
 content+=row(kind,'fathers-reader','Clement reader');
 content+=row(kind,'fathers-jump','Early Christian work picker');
 content+=row(kind,'fathers-search','Fathers search: same query, full passages');
}
await fs.writeFile(path.join(dir,'comparison.html'),shell('Cross Canon · desktop, iOS and web comparison',content));
await fs.writeFile(path.join(dir,'desktop-board.html'),shell('Desktop search · web and native',intro+row('desktop','search','Same query and scope · initial result position','search-form')));
await fs.writeFile(path.join(dir,'mobile-board.html'),shell('Mobile search · web and native iOS',intro+row('mobile','search-form','Initial result position')+row('mobile','search-results','Full passages after scrolling')));
const sources=['rust/desktop/src/lib.rs','rust/desktop/src/dialogs.rs','rust/desktop/src/search.rs','rust/desktop/src/reader.rs','rust/desktop/src/touch_scroll.rs','app/features/search/SearchForm.tsx','app/features/search/SearchResults.tsx','app/features/search/useSearchFilters.ts','app/features/early-christian-reader/ChapterJump.tsx','app/styles.css'];
const hashes={};for(const source of sources)hashes[source]=crypto.createHash('sha256').update(await fs.readFile(source)).digest('hex');
const images=[];for(const name of (await fs.readdir(dir)).filter(n=>n.endsWith('.png'))){const bytes=await fs.readFile(path.join(dir,name));const png=PNG.sync.read(bytes);images.push({name,width:png.width,height:png.height,bytes:bytes.length});}
await fs.writeFile(path.join(report,'baseline.json'),JSON.stringify({date:new Date().toISOString(),gitHead:'54ee9899c0c73f8043b9a6230675b13f3b29a0d3',node:process.version,web:'https://www.crosscanon.com',native:'current working tree; pre-existing changes preserved',ios:'iPhone 16e / iOS 26.3 Simulator / Debug build; installed and launched freshly',limitations:['Mac locked: hands-on native desktop and simulator interaction unavailable','No physical-device keyboard, touch feel, VoiceOver, background-audio, or Safari certification'],hashes,images},null,2));
console.log('Gallery, boards, source hashes and PNG validation saved.');
