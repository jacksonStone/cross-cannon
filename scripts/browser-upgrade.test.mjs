// An installed old worker must not combine its cached modules with new HTML.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import {spawn} from 'node:child_process';
import puppeteer from 'puppeteer';

let backend=process.env.BROWSER_TEST_URL,server,browser,proxy;
const output=process.env.BROWSER_TEST_OUTPUT??'docs/screenshots/browser-upgrade';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function listen(server){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return server.address().port;}
const ready=page=>page.waitForFunction(()=>window.crossCanonReader&&!document.querySelector('#loading')&&document.querySelector('.passage'),{timeout:30000});
try{
  if(!backend){
    const probe=http.createServer();const port=await listen(probe);await new Promise(resolve=>probe.close(resolve));
    backend=`http://127.0.0.1:${port}`;
    server=spawn('target/release/r-cross-cannon',[],{env:{...process.env,R_CROSS_CANNON_BIND:`127.0.0.1:${port}`,R_CROSS_CANNON_COMPAT_BIND:'',CROSS_CANNON_UPDATE_DB:'0'},stdio:'ignore'});
    let opened=false;
    for(let i=0;i<120;i++){
      try{if((await fetch(backend+'/r/api/health')).ok){opened=true;break;}}catch{}
      if(server.exitCode!==null)throw Error('Local reader server exited');
      await pause(250);
    }
    assert.ok(opened,'Local reader server did not start');
  }
  const oldWorker=await fs.readFile(new URL('fixtures/legacy-reader-worker.js',import.meta.url));
  proxy=http.createServer((request,response)=>{
    if(request.url==='/__legacy-reader-worker.js'){
      response.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});response.end(oldWorker);return;
    }
    if(request.url==='/__seed'){
      response.writeHead(200,{'Content-Type':'text/html'});response.end('<!doctype html><p>Existing reader installation</p>');return;
    }
    const target=new URL(request.url,backend);
    const upstream=(target.protocol==='https:'?https:http).request(target,{method:request.method,headers:{...request.headers,host:target.host}},incoming=>{
      response.writeHead(incoming.statusCode,incoming.headers);incoming.pipe(response);
    });
    upstream.on('error',error=>{response.writeHead(502);response.end(error.message);});request.pipe(upstream);
  });
  const origin=`http://127.0.0.1:${await listen(proxy)}`;
  const manifest=await fetch(backend+'/browser/manifest.json').then(response=>response.json());
  browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--use-gl=angle']});
  const context=await browser.createBrowserContext(),page=await context.newPage();
  await page.setViewport({width:393,height:852,deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/__seed');
  await page.evaluate(async()=>{
    localStorage.setItem('upgrade-preserved','existing reader state');
    await navigator.serviceWorker.register('/__legacy-reader-worker.js',{scope:'/'});
    await navigator.serviceWorker.ready;
    if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
  });
  await page.goto(origin+'/reader/0c558fd2c95099cf1909774d',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>globalThis.legacyStartupConsumed||globalThis.crossCanonReader,{timeout:30000});
  assert.equal(await page.evaluate(()=>!!globalThis.legacyStartupConsumed),false,`New HTML loaded the incumbent worker's old startup: ${errors.join('; ')}`);
  await ready(page);
  assert.equal(await page.evaluate(()=>crossCanonReader.version),manifest.version,'The shell must select its own manifest, not the old worker cache alias');
  assert.equal(await page.evaluate(()=>localStorage.getItem('upgrade-preserved')),'existing reader state');
  await fs.mkdir(output,{recursive:true});await page.screenshot({path:`${output}/mobile-online.png`});
  const offline=process.env.BROWSER_UPGRADE_ONLINE_ONLY!=='1';
  if(offline){
    await page.waitForSelector('#reader-update',{timeout:180000});
    await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.click('#reader-update')]);await ready(page);
    await page.setOfflineMode(true);await page.reload({waitUntil:'domcontentloaded'});await ready(page);
    assert.equal(await page.evaluate(()=>crossCanonReader.version),manifest.version);
    assert.equal(await page.$eval('#reader-jump',element=>element.textContent),'John 3');
    assert.equal(await page.evaluate(()=>localStorage.getItem('upgrade-preserved')),'existing reader state');
    await page.screenshot({path:`${output}/mobile-offline.png`});
  }
  assert.deepEqual(errors,[]);await context.close();
  const fresh=await browser.createBrowserContext(),desktop=await fresh.newPage();
  await desktop.setViewport({width:1440,height:1000});await desktop.goto(origin+'/reader/0c558fd2c95099cf1909774d',{waitUntil:'domcontentloaded'});await ready(desktop);
  await desktop.screenshot({path:`${output}/desktop.png`});await fresh.close();
  console.log(JSON.stringify({version:manifest.version,oldWorkerUpgrade:true,pinnedManifest:true,offlineReload:offline,preservedLocalState:true,freshDesktop:true,errors},null,2));
}finally{
  if(browser)await browser.close();
  if(proxy)await new Promise(resolve=>proxy.close(resolve));
  if(server){server.kill('SIGTERM');await new Promise(resolve=>server.once('exit',resolve));}
}
