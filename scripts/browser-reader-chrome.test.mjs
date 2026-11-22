// Exercise page chrome with notch insets and real repeated passage taps.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import puppeteer from 'puppeteer';

const origin=process.env.BROWSER_TEST_URL??'http://127.0.0.1:3117';
const output='docs/screenshots/reader-chrome';
await fs.mkdir(output,{recursive:true});
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--use-gl=angle']});
const failures=[],results=[];
const check=(condition,message)=>{if(!condition)failures.push(message);};
try {
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  if(process.env.BROWSER_TEST_SOURCE_ADAPTER==='1') {
    const fonts=await fs.readdir('public/browser/fonts');
    await page.setRequestInterception(true);
    page.on('request',async request=>{
      const path=new URL(request.url()).pathname;
      const file=/\/platform[.].*[.]js$/.test(path)?'web/platform.js':/\/reader[.].*[.]css$/.test(path)?'web/reader.css':null;
      if(!file)return request.continue();
      let body=await fs.readFile(file,'utf8');
      body=body.replace(/\/browser\/fonts\/([^/]+)\.ttf/g,(_,name)=>`/browser/fonts/${fonts.find(f=>f.startsWith(name+'.')&&f.endsWith('.ttf'))}`);
      await request.respond({status:200,contentType:file.endsWith('.js')?'text/javascript':'text/css',body});
    });
  }
  await page.setViewport({width:393,height:852,isMobile:true,hasTouch:true});
  const client=await page.createCDPSession();
  await client.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:59,bottom:34,left:0,right:0}});
  await page.goto(`${origin}/reader/0c558fd2c95099cf1909774d`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.crossCanonReader&&document.querySelector('.passage')&&!document.querySelector('#reader').hidden&&!document.querySelector('#loading'),{timeout:30000});
  const ready=()=>page.waitForFunction(()=>window.crossCanonReader&&window.crossCanonPlatform&&document.querySelector('.passage')&&!document.querySelector('#reader').hidden&&!document.querySelector('#loading'),{timeout:30000});
  const paint=()=>page.evaluate(()=>({
    body:getComputedStyle(document.body).backgroundColor,
    root:getComputedStyle(document.documentElement).backgroundColor,
    reader:getComputedStyle(document.querySelector('#reader')).backgroundColor,
    bodyHeight:document.body.getBoundingClientRect().height,
    rootHeight:document.documentElement.getBoundingClientRect().height,
    viewport:innerHeight,
    insets:window.crossCanonPlatform.safeInsets(),
    headerTop:document.querySelector('#reader header').getBoundingClientRect().top,
    themeColor:document.querySelector('meta[name=theme-color]').content,
    statusBar:document.querySelector('meta[name=apple-mobile-web-app-status-bar-style]')?.content,
    buttonGaps:[
      document.querySelector('#reader-audio').getBoundingClientRect().left-document.querySelector('#reader-tools').getBoundingClientRect().right,
      document.querySelector('#reader-library').getBoundingClientRect().left-document.querySelector('#reader-audio').getBoundingClientRect().right,
    ],
  }));
  const paper=await paint();results.push({theme:'paper',...paper});
  check(paper.body===paper.reader&&paper.bodyHeight>=paper.viewport&&paper.rootHeight>=paper.viewport,'Paper page background must cover the full viewport, including Safari chrome sampling');
  check(paper.insets[0]===59&&paper.insets[2]===34,'Canvas dialogs must receive the real notch and home-indicator insets');
  check(paper.headerTop>=59,'Reader controls must clear the notch');
  check(paper.buttonGaps[0]===paper.buttonGaps[1],'Tools, Play and Library must have equal gaps');
  check(paper.statusBar==='default','Paper theme must use a readable light status bar');
  const id=await page.$eval('.chapter:nth-of-type(2) .passage',p=>p.dataset.passageId);
  const passage=`[data-passage-id="${id}"]`;
  await page.tap(passage);await page.waitForSelector('.passage.selected');
  await page.tap(passage);await new Promise(resolve=>setTimeout(resolve,150));
  check(await page.$('.passage.selected')===null,'Tapping the same passage twice must clear selection');
  check(await page.$eval('#passage-actions',e=>e.hidden),'Second tap must hide passage actions');
  await page.click('#reader-tools');await page.click('#tools-menu [aria-label="Reader settings"]');
  await page.click('#reader-settings [data-setting="theme2"]');
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  await page.click('#settings-done');
  const dark=await paint();results.push({theme:'dark',...dark});
  check(dark.body===dark.reader&&dark.root===dark.reader,'Dark page background must match the reader behind the iPhone status bar');
  check(dark.themeColor==='#171717'&&dark.statusBar==='black-translucent','Dark theme must update browser chrome and the older iOS standalone fallback together');
  // Exercise the real Rust checkpoint, not just a hand-written storage fixture.
  await page.evaluateOnNewDocument(()=>{
    const observer=new MutationObserver(()=>{
      if(!document.querySelector('#loading'))return;
      window.launchPaint={background:getComputedStyle(document.documentElement).backgroundColor,readerStarted:!!window.crossCanonReader};
      observer.disconnect();
    });
    observer.observe(document,{childList:true,subtree:true});
  });
  await page.reload({waitUntil:'domcontentloaded'});await ready();
  const launch=await page.evaluate(()=>window.launchPaint);
  check(launch?.background===dark.root&&!launch.readerStarted,'A real saved dark reader must paint dark before WASM on reload');
  await page.screenshot({path:`${output}/mobile-dark.png`});
  await page.click('#reader-library');
  await page.waitForSelector('#library-navigation[open] [aria-label="Close"]');
  const closeTop=await page.$eval('#library-navigation [aria-label="Close"]',e=>e.getBoundingClientRect().top);
  check(closeTop>=59,'Library controls must clear the notch');
  await page.screenshot({path:`${output}/mobile-dark-library.png`});
  await page.click('#library-navigation [aria-label="Close"]');
  // A mouse click and keyboard activation have the same toggle behavior.
  await page.setViewport({width:1440,height:1000,isMobile:false,hasTouch:false});
  await client.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,bottom:0,left:0,right:0}});
  await ready();
  const desktop=await paint();
  check(desktop.buttonGaps[0]===desktop.buttonGaps[1],'Desktop header controls must also have equal gaps');
  await page.screenshot({path:`${output}/desktop-dark.png`});
  const desktopId=await page.$$eval('.passage',els=>(els.find(e=>{const r=e.getBoundingClientRect();return r.top>=100&&r.top<innerHeight-150;})??els[0]).dataset.passageId);
  const desktopPassage=`[data-passage-id="${desktopId}"]`;
  await page.click(desktopPassage);await page.waitForSelector('.passage.selected');
  await page.click(desktopPassage);await new Promise(resolve=>setTimeout(resolve,150));
  check(await page.$('.passage.selected')===null,'Clicking the same desktop passage twice must clear selection');
  await page.focus(desktopPassage);await page.keyboard.press('Enter');await page.waitForSelector('.passage.selected');
  await page.keyboard.press('Enter');await new Promise(resolve=>setTimeout(resolve,150));
  check(await page.$('.passage.selected')===null,'Keyboard activation must also toggle the passage');
  // Side insets rotate with a landscape iPhone rather than remaining at zero.
  await page.setViewport({width:852,height:393,isMobile:true,hasTouch:true});
  await client.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,bottom:21,left:59,right:59}});
  await ready();
  const landscape=await paint();results.push({theme:'dark-landscape',...landscape});
  check(JSON.stringify(landscape.insets)==='[0,59,21,59]','Landscape safe areas must reach canvas dialogs');
  check(errors.length===0,JSON.stringify(errors));
  console.log(JSON.stringify({results,failures},null,2));
  assert.deepEqual(failures,[]);
} finally {await browser.close();}
