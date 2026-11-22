// Exercise the actual Rust/WASM app through its DOM and accessibility adapters.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import puppeteer from 'puppeteer';
import {spawn} from 'node:child_process';
const manage=process.env.E2E_MANAGE_SERVER==='1'&&!process.env.BROWSER_TEST_URL;
const port=process.env.BROWSER_TEST_PORT??'3117';
const origin=process.env.BROWSER_TEST_URL??(manage?`http://127.0.0.1:${port}`:'http://127.0.0.1:3005');
let server;
if(manage){
  server=spawn('target/release/r-cross-cannon',[],{env:{...process.env,R_CROSS_CANNON_BIND:`127.0.0.1:${port}`,R_CROSS_CANNON_COMPAT_BIND:'',CROSS_CANNON_UPDATE_DB:'0'},stdio:'ignore'});
  let ready=false;
  for(let i=0;i<80;i++){
    try{const response=await fetch(origin);if(response.ok){ready=true;break;}}catch{}
    if(server.exitCode!=null)throw Error('Browser test server exited');
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  if(!ready){server.kill();throw Error('Browser test server did not start');}
}
const output=process.env.BROWSER_TEST_OUTPUT??'docs/screenshots/rust-browser';
const guestOnly=process.env.E2E_GUEST_READER==='1';
await fs.mkdir(output,{recursive:true});
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--enable-webgl','--use-gl=angle']});
const errors=[];const report=[];
const shot=async(page,name)=>{await new Promise(resolve=>setTimeout(resolve,250));await page.evaluate(()=>document.getAnimations().forEach((a)=>a.finish()));await page.screenshot({path:`${output}/${name}.png`});};
const ready=async(page)=>page.waitForFunction(()=>window.crossCanonReader&&document.querySelectorAll('.passage').length>0&&!document.querySelector('#reader').hidden,{timeout:120000});
const nodes=async(page)=>page.$$eval('#dialog-accessibility>*',els=>els.map(e=>({label:e.getAttribute('aria-label'),tag:e.localName,value:e.value})));
const click=async(page,label)=>{await page.waitForSelector(`#dialog-accessibility [aria-label="${label}"]`,{timeout:10000});await page.click(`#dialog-accessibility [aria-label="${label}"]`);};
const close=async(page)=>{await click(page,'Close');await page.waitForFunction(()=>!document.querySelector('#reader').hidden);};
try {
  const page=await browser.newPage();
  page.on('pageerror',error=>errors.push(error.stack));
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  await page.setViewport({width:393,height:852,deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const started=Date.now();
  await page.goto(`${origin}/reader/0c558fd2c95099cf1909774d`,{waitUntil:'domcontentloaded'});await ready(page);
  report.push({startupMs:Date.now()-started});
  await page.waitForFunction(()=>document.querySelector('#app-canvas').width===Math.round(innerWidth*devicePixelRatio));
  await shot(page,'mobile-reader');
  const geometry=await page.evaluate(()=>({viewport:innerWidth,canvas:document.querySelector('#app-canvas').width,overflow:document.documentElement.scrollWidth>innerWidth,chapterVisible:[...document.querySelectorAll('.chapter h2')].find(h=>h.textContent===document.querySelector('#reader-jump').textContent)?.getBoundingClientRect().top>=document.querySelector('#reader-scroll').getBoundingClientRect().top}));
  assert.equal(geometry.overflow,false);assert.equal(geometry.canvas,786);assert.equal(geometry.chapterVisible,true);report.push(geometry);
  await page.click('#reader-tools');await shot(page,'mobile-tools');
  await page.click('#tools-menu [aria-label="Reader settings"]');await shot(page,'mobile-settings');
  await page.click('#reader-settings [data-setting="theme2"]');await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');await shot(page,'mobile-settings-dark');
  await page.click('#reader-settings [data-setting="theme0"]');await page.click('#settings-done');
  await page.click('#reader-library');await page.waitForSelector('#library-navigation[open]');await shot(page,'mobile-library');
  await page.click('#library-navigation .library-close');
  await page.evaluate(()=>window.crossCanonReader.dispatch(JSON.stringify({action:'library'})));
  await page.waitForSelector('#dialog-accessibility input, #dialog-accessibility textarea');
  report.push({library:await nodes(page)});
  const genesis=await page.$('#dialog-accessibility [aria-label="Genesis"]');
  const before=await genesis.boundingBox();
  const scrollButton=await page.$('#dialog-accessibility [aria-label="Read book"]');
  const box=await scrollButton.boundingBox();
  const touch=await page.createCDPSession();
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2}]});
  for(let i=1;i<=12;i++){
    await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2-i*15}]});
    await new Promise(resolve=>setTimeout(resolve,16));
  }
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForFunction((y)=>{const e=document.querySelector('#dialog-accessibility [aria-label="Genesis"]');return !e||e.getBoundingClientRect().top<y-30;},{timeout:10000},before.y);
  report.push({touchScrollOverButton:true});await close(page);
  await page.click('#reader-jump');await page.waitForSelector('#library-navigation[open]');await shot(page,'mobile-jump');await page.click('#library-navigation .library-close');
  await page.click('#reader-tools');await page.click('#tools-menu [aria-label="Search"]');await page.waitForSelector('#dialog-accessibility input, #dialog-accessibility textarea');await shot(page,'mobile-search');
  await click(page,'Filters');await page.waitForSelector('#dialog-accessibility [aria-label="Done"]');await shot(page,'mobile-filters');await click(page,'Done');
  await click(page,'Search Keywords');
  const input=await page.$('#dialog-accessibility input, #dialog-accessibility textarea');await input.click();await input.type('Nicodemus',{delay:30});
  await page.waitForFunction(()=>document.querySelector('#dialog-accessibility [aria-label="Search Bible"]'),{timeout:10000});
  report.push({search:await nodes(page)});await click(page,'Search Bible');
  await page.waitForFunction(()=>document.querySelector('#dialog-accessibility [aria-label*="John 3"]'),{timeout:20000});await shot(page,'mobile-search-results');
  await close(page);
  await page.evaluate(()=>document.querySelector('.passage').scrollIntoView({block:'start'}));
  await page.click('.passage');await page.waitForFunction(()=>!document.querySelector('#passage-actions').hidden);await shot(page,'mobile-passage-actions');
  await page.click('#action-highlight');await page.waitForSelector('.passage.highlight');await shot(page,'mobile-highlight');
  await page.click('#action-note');await page.waitForSelector('#dialog-accessibility textarea');await shot(page,'mobile-note-empty');
  report.push({notes:await nodes(page)});
  const note=await page.$('#dialog-accessibility textarea');await note.click();await note.type('Browser adapter verification: shared Rust.',{delay:10});
  await page.evaluate(()=>{
    const note=document.querySelector('#dialog-accessibility textarea');
    const bold=document.querySelector('#dialog-accessibility [aria-label="Bold"]');
    const text='Browser adapter verification: shared Rust.';
    const start=text.indexOf('shared Rust');
    const send=(action,id,book)=>window.crossCanonReader.dispatch(JSON.stringify({action,id,book,value:0}));
    // All three events share one JS turn: formatting must wait for pending
    // text and its newer selection, even when no render frame has run yet.
    send('text',JSON.stringify({text,start:text.length,end:text.length}),note.dataset.id);
    send('selection',JSON.stringify({text,start,end:start+11}),note.dataset.id);
    send('accessibility',bold.dataset.id,'click');
  });
  await page.waitForFunction(()=>document.querySelector('#dialog-accessibility textarea')?.value.includes('**shared Rust**'),{timeout:10000});
  await shot(page,'mobile-notes');
  await close(page);
  await page.click('.passage');await page.waitForFunction(()=>!document.querySelector('#action-commentary').hidden);await page.click('#action-commentary');await page.waitForSelector('#dialog-accessibility [aria-label="Close"]');await shot(page,'mobile-commentaries');await close(page);
  let similarRequest;
  await page.setRequestInterception(true);
  const intercept=async request=>{
    if(request.url()===origin+'/r/api/search'){
      similarRequest=JSON.parse(request.postData());
      await request.respond({status:200,contentType:'application/json',body:JSON.stringify({results:[{id:'61a9b43eaccc335fe2739693',score:.8,highlightVerse:16}]})});
    }else await request.continue();
  };
  page.on('request',intercept);
  await page.click('#action-similar');
  await page.waitForFunction(()=>[...document.querySelectorAll('#dialog-accessibility>*')].some(e=>e.getAttribute('aria-label')?.includes('John 3:12')),{timeout:15000});
  assert.equal(similarRequest.corpus,'scripture');assert.equal(similarRequest.web,true);assert.ok(similarRequest.sourceId);
  report.push({wasmSearchTransport:true,sourceId:similarRequest.sourceId});await shot(page,'mobile-similar-results');
  await page.setRequestInterception(false);page.off('request',intercept);await close(page);
  await page.click('#reader-tools');await page.click('#tools-menu [aria-label="Account and sync"]');await page.waitForSelector('#dialog-accessibility [aria-label="Close"]');await shot(page,'mobile-account');await close(page);
  await page.click('#reader-tools');await page.click('#tools-menu [aria-label="Audio downloads"]');await page.waitForSelector('#dialog-accessibility [aria-label="Close"]');await shot(page,'mobile-downloads');await close(page);
  for(const [width,height,dpr,label] of [[320,740,3,'small-mobile'],[768,1024,2,'tablet'],[1440,1000,1,'desktop'],[1920,1080,1,'wide-desktop']]) {
    await page.setViewport({width,height,deviceScaleFactor:dpr,isMobile:width<600,hasTouch:width<900});
    await ready(page);
    await page.waitForFunction(()=>document.querySelector('#app-canvas').width===Math.round(innerWidth*devicePixelRatio));
    await shot(page,`${label}-reader`);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.click('#reader-library');await page.waitForSelector('#library-navigation[open]');await shot(page,`${label}-library`);await page.click('#library-navigation .library-close');
    await page.click('#reader-tools');await page.click('#tools-menu [aria-label="Search"]');await page.waitForSelector('#dialog-accessibility [aria-label="Close"]');await shot(page,`${label}-search`);await close(page);
  }
  // Server-only account documents must not restore retired storage writers or
  // register a competing offline worker when the native consent flow opens.
  if(!guestOnly){
  const accountPage=await browser.newPage();
  await accountPage.setViewport({width:393,height:852,deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const beforeAccount=await page.evaluate(()=>localStorage.getItem('cross-canon/browser-reader-v1'));
  for(const [path,name] of [['/account','mobile-account-page'],['/account/native?id=expired','mobile-native-consent']]){
    const response=await accountPage.goto(origin+path,{waitUntil:'networkidle0'});
    assert.equal(response.status(),200);
    assert.match(response.headers()['cache-control'],/no-store/);
    await shot(accountPage,name);
    assert.equal(await accountPage.evaluate(()=>Boolean(window.crossCanonReader)),false);
  }
  assert.equal(await page.evaluate(()=>localStorage.getItem('cross-canon/browser-reader-v1')),beforeAccount);
  await accountPage.close();report.push({standaloneAccountAndNativeConsent:true});
  }else report.push({guestReaderOnly:true,standaloneAccountAndNativeConsent:'not provided by this origin'});
  // Staged shell + full immutable library support real reloads without origin access.
  await page.evaluate(async()=>Promise.race([(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));})(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Offline reader worker did not activate')),30000))]));
  const saved=await page.evaluate(()=>localStorage.getItem('cross-canon/browser-reader-v1'));
  assert.ok(saved?.includes('Browser adapter verification'));
  await page.setOfflineMode(true);await page.reload({waitUntil:'domcontentloaded'});await ready(page);await shot(page,'desktop-offline');
  assert.ok(await page.$('.passage.highlight'));
  await page.setOfflineMode(false);
  report.push({offlineReload:true,errors});assert.deepEqual(errors,[]);
  const waiting=await browser.newPage();
  await waiting.goto(origin,{waitUntil:'domcontentloaded'});
  await waiting.waitForFunction(()=>document.querySelector('#loading p')?.textContent.includes('another tab'));
  assert.equal(await waiting.evaluate(()=>Boolean(window.crossCanonReader)),false);
  await page.close();await ready(waiting);await waiting.close();
  report.push({singleWriterSession:true,waitingTabResumes:true});
  const migrationContext=await browser.createBrowserContext();
  const migration=await migrationContext.newPage();
  await migration.setViewport({width:393,height:852,deviceScaleFactor:2,isMobile:true,hasTouch:true});
  await migration.goto(`${origin}/api/account`);
  await migration.evaluate(async()=>{
    localStorage.setItem('cross-cannon:reader-position:v1','Psalms:60');
    localStorage.setItem('cross-cannon:reader-settings:v1',JSON.stringify({fontScale:1.07,lineHeight:1.86,contentWidth:760,theme:'dark'}));
    localStorage.setItem('cross-cannon:filters:v1',JSON.stringify({canon:'orthodox'}));
    localStorage.setItem('cross-cannon:church-fathers-favorite-books:v1',JSON.stringify(['anf09:xii.iv']));
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('cross-canon-study-v1',1);request.onupgradeneeded=()=>request.result.createObjectStore('items');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('items','readwrite');
      for(const [owner,id,body] of [['guest','legacy_guest','Preserve this offline guest note.'],['user:bob','legacy_bob','Keep Bob’s private queue separate.']]) {
        tx.objectStore('items').put({item:{id,kind:'note',location:{version:2,corpus:'scripture',chapterKey:'John\t3',passageKey:'0c558fd2c95099cf1909774d'},reference:'John 3',quote:'Existing reading',title:'',body,color:'yellow',notebookId:null,deleted:false,createdAt:1710000000000},revision:0,dirty:true},`${owner}:${id}`);
      }
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
    });db.close();
  });
  await migration.goto(origin);await ready(migration);
  assert.equal(await migration.$eval('#reader-jump',e=>e.textContent),'Psalms 60');
  assert.equal(await migration.evaluate(()=>document.documentElement.dataset.theme),'dark');
  const checkpoint=await migration.evaluate(()=>localStorage.getItem('cross-canon/browser-reader-v1'));
  for(const text of ['Preserve this offline guest note.','Keep Bob’s private queue separate.','orthodox','anf09:xii.iv'])assert.ok(checkpoint.includes(text),text);
  await shot(migration,'mobile-migrated-reader');
  await migration.evaluate(()=>localStorage.setItem('cross-cannon:reader-settings:v1',JSON.stringify({theme:'paper'})));
  await migration.reload();await ready(migration);assert.equal(await migration.evaluate(()=>document.documentElement.dataset.theme),'dark');
  report.push({legacyMigration:true,originalRecordsRetained:true,oneTimeImport:true});
  await migrationContext.close();
  console.log(JSON.stringify(report,null,2));
} catch(error) {
  console.error(error);console.error('BROWSER ERRORS',errors);
  const page=(await browser.pages()).at(-1);if(page){console.error('NODES',await nodes(page).catch(()=>[]));await shot(page,'failure').catch(()=>{});}
  process.exitCode=1;
}finally{await browser.close();server?.kill();await fs.writeFile(`${output}/verification.json`,JSON.stringify(report,null,2));}
