// Real pointer/keyboard selection must keep desktop actions beside their passage.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import puppeteer from 'puppeteer';

const origin=process.env.BROWSER_TEST_URL??'http://127.0.0.1:3117';
const output='docs/screenshots/passage-actions';
await fs.mkdir(output,{recursive:true});
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--use-gl=angle']});
const results=[];
let page;
try {
  page=await browser.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  // Adapter-only iteration can reuse a built WASM reader while other source
  // work is in flight. Normal verification always tests the packaged assets.
  if(process.env.BROWSER_TEST_SOURCE_ADAPTER==='1') {
    const fonts=await fs.readdir('public/browser/fonts');
    await page.setRequestInterception(true);
    page.on('request',async request=>{
      const path=new URL(request.url()).pathname;
      const file=/\/platform[.].*[.]js$/.test(path)?'web/platform.js':/\/reader[.].*[.]css$/.test(path)?'web/reader.css':null;
      if(file){
        let body=await fs.readFile(file,'utf8');
        body=body.replace(/\/browser\/fonts\/([^/]+)\.ttf/g,(_,name)=>`/browser/fonts/${fonts.find(f=>f.startsWith(name+'.')&&f.endsWith('.ttf'))}`);
        await request.respond({status:200,contentType:file.endsWith('.js')?'text/javascript':'text/css',body});
      }
      else await request.continue();
    });
  }
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  await page.setViewport({width:1440,height:1000});
  await page.goto(`${origin}/reader/0c558fd2c95099cf1909774d`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.crossCanonReader&&document.querySelector('.passage')&&!document.querySelector('#reader').hidden&&!document.querySelector('#loading'),{timeout:30000});
  await page.evaluate(()=>document.fonts.ready);
  const geometry=()=>page.evaluate(()=>{
    const rect=element=>{const r=element.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height};};
    const p=document.querySelector('.passage.selected');
    const actions=document.querySelector('#passage-actions');
    return {passage:rect(p),actions:rect(actions),scroll:rect(document.querySelector('#reader-scroll')),inline:p.nextElementSibling?.contains(actions),footer:document.querySelector('#reader-footer').contains(actions),overflow:document.documentElement.scrollWidth>innerWidth};
  });
  const desktop=async(label)=>{
    await page.waitForFunction(()=>{
      const p=document.querySelector('.passage.selected');
      const actions=document.querySelector('#passage-actions');
      return p?.nextElementSibling?.contains(actions)&&actions.getBoundingClientRect().bottom<=document.querySelector('#reader-scroll').getBoundingClientRect().bottom+1;
    },{timeout:5000});
    const g=await geometry();
    assert.ok(g.inline,`${label}: actions must follow the selected passage`);
    assert.ok(g.actions.top>=g.passage.bottom&&g.actions.top-g.passage.bottom<65,`${label}: action row is too far from passage`);
    assert.ok(g.actions.left>=g.passage.left-1&&g.actions.right<=g.passage.right+1,`${label}: actions exceed passage width`);
    assert.ok(g.actions.top>=g.scroll.top&&g.actions.bottom<=g.scroll.bottom+1,`${label}: actions clipped by viewport`);
    assert.equal(g.overflow,false);
    results.push({label,...g});
    await page.screenshot({path:`${output}/${label}.png`});
  };
  await page.click('.chapter:nth-of-type(2) .passage');
  await page.waitForFunction(()=>document.querySelector('.passage.selected'));
  // This assertion also fails clearly against the former footer-only design.
  assert.ok((await geometry()).inline,'desktop actions are stranded in the footer');
  await desktop('desktop');
  const selected=await page.$eval('.passage.selected',p=>p.dataset.passageId);
  await page.click('#action-highlight');await page.waitForSelector('.passage.selected.highlight');
  await desktop('desktop-highlight');
  for(const [width,height,label] of [[700,740,'compact-desktop'],[768,1024,'tablet'],[1440,720,'desktop-bottom-edge'],[1920,1080,'wide-desktop']]) {
    await page.setViewport({width,height});
    await page.click('#action-clear');
    await page.waitForFunction(()=>!document.querySelector('.passage.selected'));
    await page.evaluate(id=>{
      const s=document.querySelector('#reader-scroll'),p=document.querySelector(`[data-passage-id="${id}"]`);
      s.scrollTop+=p.getBoundingClientRect().top-s.getBoundingClientRect().top-s.clientHeight+65;
    },selected);
    // Clear then click text near the lower edge to exercise automatic reveal.
    const passage=await page.$(`[data-passage-id="${selected}"]`);
    const box=await passage.boundingBox();
    await page.mouse.click(box.x+20,Math.min(box.y+20,height-20));
    await desktop(label);
  }
  await page.evaluate(()=>{
    const s=document.querySelector('#reader-scroll'),p=document.querySelector('.passage.selected');
    s.scrollTop+=p.getBoundingClientRect().top-s.getBoundingClientRect().top-4;
  });
  await desktop('desktop-top-edge');
  await page.evaluate(()=>document.querySelector('#reader-scroll').scrollTop+=200);
  await new Promise(resolve=>setTimeout(resolve,150));
  const scrolled=await page.$eval('#reader-scroll',s=>s.scrollTop);
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.ok(Math.abs(await page.$eval('#reader-scroll',s=>s.scrollTop)-scrolled)<2,'passive scrolling must not snap back to selection');
  // A focused passage remains selected as desktop/mobile layout changes.
  for(const width of [393,320]) {
    await page.setViewport({width,height:852});
    await page.waitForFunction(()=>document.querySelector('#app-canvas').width===Math.round(innerWidth*devicePixelRatio));
    await page.waitForFunction(()=>document.querySelector('#reader-footer').contains(document.querySelector('#passage-actions'))&&!document.querySelector('#passage-actions').hidden);
    const g=await geometry();assert.ok(g.footer);assert.equal(g.overflow,false);
    assert.ok(g.actions.bottom<=852&&g.actions.top>700,'phone actions stay in the bottom bar');
    await page.screenshot({path:`${output}/mobile-${width}.png`});results.push({label:`mobile-${width}`,...g});
  }
  await page.setViewport({width:1440,height:1000,isMobile:false,hasTouch:false});
  await page.waitForFunction(()=>document.querySelector('#app-canvas').width===Math.round(innerWidth*devicePixelRatio));
  await page.waitForFunction(()=>document.querySelector('.passage.selected')?.nextElementSibling?.contains(document.querySelector('#passage-actions')));
  await page.click('#action-clear');
  await page.waitForFunction(()=>!document.querySelector('.passage.selected')&&document.querySelector('#passage-actions').hidden);
  await page.focus(`[data-passage-id="${selected}"]`);await page.keyboard.press('Enter');
  await desktop('desktop-keyboard');
  await page.click('#action-note');await page.waitForSelector('#dialog-accessibility textarea');
  await page.screenshot({path:`${output}/desktop-notes.png`});
  await page.locator('#dialog-accessibility [aria-label="Close"]').click();
  await page.waitForFunction(()=>!document.querySelector('#reader').hidden);
  await desktop('desktop-after-dialog');
  await page.click('#action-commentary');await page.waitForSelector('#dialog-accessibility [aria-label="Close"]');
  await page.locator('#dialog-accessibility [aria-label="Close"]').click();
  await page.waitForFunction(()=>!document.querySelector('#reader').hidden);
  assert.deepEqual(errors,[]);
} catch(error) {
  await page?.screenshot({path:`${output}/failure.png`});
  console.error(await page?.evaluate(()=>({viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>({id:e.id,tag:e.tagName,right:e.getBoundingClientRect().right,style:e.getAttribute('style')})),readerHidden:document.querySelector('#reader').hidden,nodes:[...document.querySelector('#dialog-accessibility').children].map(e=>({label:e.getAttribute('aria-label'),tag:e.tagName}))})));
  throw error;
} finally {await browser.close();await fs.writeFile('.tmp/browser-passage-actions.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));}
