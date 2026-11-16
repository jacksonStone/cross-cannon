// A real fresh mobile reader must open its saved/deep-linked Chapter without
// downloading the complete corpus or briefly presenting the wrong Chapter.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import puppeteer from 'puppeteer';
const origin=process.env.BROWSER_TEST_URL??'http://127.0.0.1:3117';
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--use-gl=angle']});
const results=[];
try{
  for(const mode of ['deep-link','saved-chapter']){
    const context=await browser.createBrowserContext();const page=await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setViewport({width:393,height:852,deviceScaleFactor:2,isMobile:true,hasTouch:true});
    if(mode==='saved-chapter'){
      await page.goto(origin+'/api/account');
      await page.evaluate(()=>localStorage.setItem('cross-cannon:reader-position:v1','Psalms:60'));
    }
    await page.evaluateOnNewDocument(()=>{
      window.visibleChapters=[];
      new MutationObserver(()=>{
        const reader=document.querySelector('#reader'),loading=document.querySelector('#loading');
        if(reader&&!reader.hidden&&!loading){const title=document.querySelector('#reader-jump')?.textContent;if(title&&window.visibleChapters.at(-1)!==title)window.visibleChapters.push(title);}
      }).observe(document,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
    });
    const session=await page.createCDPSession();
    await session.send('Network.enable');await session.send('Network.setCacheDisabled',{cacheDisabled:true});
    await session.send('Network.emulateNetworkConditions',{offline:false,latency:80,downloadThroughput:1250000,uploadThroughput:625000});
    const started=Date.now();
    await page.goto(origin+(mode==='deep-link'?'/reader/0c558fd2c95099cf1909774d':'/'),{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>performance.getEntriesByName('cross-canon-readable').length,{timeout:12000});
    const state=await page.evaluate(()=>{
      const ready=performance.getEntriesByName('cross-canon-readable')[0].startTime;
      const resources=performance.getEntriesByType('resource').filter(r=>r.startTime<ready);
      return {readableMs:Math.round(ready),visibleChapters:window.visibleChapters,title:document.querySelector('#reader-jump').textContent,loading:!!document.querySelector('#loading'),criticalTransferBytes:resources.reduce((n,r)=>n+r.transferSize,0),resources:resources.map(r=>({path:new URL(r.name).pathname,bytes:r.transferSize,decoded:r.decodedBodySize}))};
    });
    results.push({mode,...state,wallMs:Date.now()-started,errors});
    const expected=mode==='deep-link'?'John 3':'Psalms 60';
    assert.equal(state.title,expected);assert.deepEqual(state.visibleChapters,[expected]);assert.equal(state.loading,false);assert.deepEqual(errors,[]);
    assert.ok(state.readableMs<8000,`Slow mobile opening: ${state.readableMs}ms`);
    assert.ok(state.criticalTransferBytes<8*1024*1024,`Too much startup data: ${state.criticalTransferBytes}`);
    assert.ok(state.resources.every(r=>r.decoded<15*1024*1024),'A complete text corpus must never be a startup dependency');
    await fs.mkdir('docs/screenshots/rust-browser',{recursive:true});
    await page.screenshot({path:`docs/screenshots/rust-browser/mobile-fast-${mode}.png`});
    await context.close();
  }
}finally{await browser.close();await fs.mkdir('.tmp',{recursive:true});await fs.writeFile('.tmp/browser-startup-regression.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));}
