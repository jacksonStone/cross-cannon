// A real browser and native HTTP client share one Rust backend. All credentials,
// users, revisions and SQLite writes belong to this temporary fixture only.
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {DatabaseSync} from 'node:sqlite';
import puppeteer from 'puppeteer';

const directory=await fs.mkdtemp(path.join(tmpdir(),'crosscanon-account-journey-'));
const databasePath=path.join(directory,'accounts.db');
const binary=path.resolve('target/release/r-cross-cannon');
const output='docs/screenshots/node-free-accounts';
const report=[];
let server,browser;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function freePort(){
  const listener=net.createServer();
  await new Promise((resolve,reject)=>listener.listen(0,'127.0.0.1',resolve).once('error',reject));
  const port=listener.address().port;
  await new Promise(resolve=>listener.close(resolve));return port;
}
try{
  const port=await freePort();const origin=`http://127.0.0.1:${port}`;
  const env={...process.env,CROSS_CANON_DATA_DIR:process.cwd(),ACCOUNTS_DATABASE_PATH:databasePath,
    CROSS_CANON_ACCOUNT_ORIGIN:origin,BETTER_AUTH_URL:origin,
    GOOGLE_CLIENT_ID:'fixture-only.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'fixture-only-google-secret',
    R_CROSS_CANNON_BIND:`127.0.0.1:${port}`,R_CROSS_CANNON_COMPAT_BIND:''};
  const denied=spawnSync(binary,['--init-accounts',databasePath],{env:{...env,CROSS_CANNON_UPDATE_DB:'0'},encoding:'utf8'});
  assert.notEqual(denied.status,0,'Ordinary startup must not permit database maintenance');
  const initialized=spawnSync(binary,['--init-accounts',databasePath],{env:{...env,CROSS_CANNON_UPDATE_DB:'1'},encoding:'utf8'});
  assert.equal(initialized.status,0,initialized.stderr);
  const second=spawnSync(binary,['--init-accounts',databasePath],{env:{...env,CROSS_CANNON_UPDATE_DB:'1'},encoding:'utf8'});
  assert.equal(second.status,0,second.stderr);
  const token='ccs_'+randomBytes(32).toString('hex');
  const date=new Date().toISOString();const expires=new Date(Date.now()+30*86400000).toISOString();
  const database=new DatabaseSync(databasePath);
  database.prepare('INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,1,?,?)').run('fixture-reader','Test Reader','reader@example.test',date,date);
  database.prepare('INSERT INTO account (id,accountId,providerId,userId,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').run('fixture-google','stable-fixture-google-id','google','fixture-reader',date,date);
  database.prepare('INSERT INTO session (id,token,userId,expiresAt,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').run('fixture-session',createHash('sha256').update(token).digest('hex'),'fixture-reader',expires,date,date);
  database.close();
  let log='';
  server=spawn(binary,[],{env:{...env,CROSS_CANNON_UPDATE_DB:'0'},stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',chunk=>log+=chunk);server.stderr.on('data',chunk=>log+=chunk);
  let ready=false;
  for(let attempt=0;attempt<120;attempt++){
    try{if((await fetch(origin+'/r/api/health')).ok){ready=true;break;}}catch{}
    if(server.exitCode!==null)throw Error(`Rust fixture exited: ${log}`);
    await pause(250);
  }
  assert.equal(ready,true,log);
  browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--use-gl=angle']});
  const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewport({width:393,height:852,deviceScaleFactor:2,isMobile:true,hasTouch:true});
  await page.setCookie({name:'crosscanon.session',value:token,url:origin,httpOnly:true,sameSite:'Lax'});
  await fs.mkdir(output,{recursive:true});
  const account=await page.goto(origin+'/account',{waitUntil:'networkidle0'});
  assert.equal(account.status(),200);assert.match(account.headers()['cache-control'],/private, no-store/);
  assert.equal(await page.$eval('#account-action',element=>element.textContent),'Sign out');
  assert.match(await page.$eval('.account-card',element=>element.textContent),/Test Reader/);
  assert.equal(await page.evaluate(()=>Boolean(window.crossCanonReader)),false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:output+'/mobile-account.png'});

  const api=async(endpoint,body,authorization)=>{
    const response=await fetch(origin+endpoint,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(authorization?{Authorization:'Bearer '+authorization}:{})},body:body?JSON.stringify(body):undefined});
    assert.match(response.headers.get('cache-control'),/private, no-store/);
    assert.equal(response.headers.get('access-control-allow-origin'),null);
    return {status:response.status,body:await response.json().catch(()=>null)};
  };
  const start=await api('/api/native-login',{operation:'start',platform:'ios'});
  assert.equal(start.status,200);const login=start.body;
  assert.match(login.id,/^[a-f0-9]{64}$/);assert.match(login.secret,/^[a-f0-9]{64}$/);
  const consent=await page.goto(login.url,{waitUntil:'networkidle0'});
  assert.equal(consent.status(),200);assert.equal(consent.headers()['referrer-policy'],'no-referrer');
  assert.match(await page.$eval('#account-action',element=>element.textContent),/Continue as Test Reader/);
  await page.screenshot({path:output+'/mobile-native-consent.png'});
  await page.click('#account-action');
  await page.waitForFunction(()=>!document.getElementById('native-return').hidden);
  const returnUrl=await page.$eval('#native-return-link',element=>element.href);
  const returned=new URL(returnUrl);assert.equal(returned.protocol,'crosscanon:');
  assert.equal(returned.searchParams.get('request'),login.id);
  const ticket=returned.searchParams.get('ticket');assert.match(ticket,/^[a-f0-9]{64}$/);
  await page.screenshot({path:output+'/mobile-native-approved.png'});
  const proofOnly=await api('/api/native-login',{operation:'poll',id:login.id,secret:login.secret});
  assert.equal(proofOnly.body.status,'pending','Browser consent alone cannot mint a native session');
  const complete=await api('/api/native-login',{operation:'poll',id:login.id,secret:login.secret,ticket});
  assert.equal(complete.body.status,'complete');const nativeToken=complete.body.token;
  const replay=await api('/api/native-login',{operation:'poll',id:login.id,secret:login.secret,ticket});
  assert.equal(replay.body.status,'expired');
  const identity=await api('/api/account',null,nativeToken);assert.equal(identity.body.user.id,'fixture-reader');
  const location={version:2,corpus:'scripture',chapterKey:'John\t3',passageKey:'0c558fd2c95099cf1909774d'};
  assert.equal((await api('/api/account',{location,revision:0},nativeToken)).status,200);
  assert.equal((await api('/api/account',{location,revision:0},nativeToken)).status,409);
  const item={id:'fixture-note',kind:'note',location,reference:'John 3',quote:'Preserved reader identity',title:'',body:'A real Rust sync request — αβ.',color:'yellow',notebookId:null,deleted:false,createdAt:1710000000000};
  assert.equal((await api('/api/study',{userId:'fixture-reader',item,revision:0},nativeToken)).status,200);
  assert.equal((await api('/api/study',null,nativeToken)).body.records[0].item.body,item.body);
  const browserProgress=await page.evaluate(async()=>fetch('/api/account').then(response=>response.json()));
  assert.equal(browserProgress.progress.scripture.revision,1);
  report.push({singleRustBackend:true,browserConsent:true,proofAndTicketRequired:true,oneUseRedemption:true,stableAccountIdentity:true,progressCas:true,studySync:true});

  // Use a fresh desktop tab: Chromium can stop delivering CDP mouse events to
  // the mobile tab after its external-protocol app-return attempt.
  const desktop=await browser.newPage();desktop.on('pageerror',error=>errors.push(error.message));
  await desktop.setViewport({width:1440,height:1000,deviceScaleFactor:1});
  await desktop.goto(origin+'/account',{waitUntil:'networkidle0'});
  await desktop.bringToFront();
  await desktop.screenshot({path:output+'/desktop-account.png'});
  const signOutResponse=desktop.waitForResponse(response=>response.url()===origin+'/api/auth/sign-out'&&response.request().method()==='POST');
  await desktop.click('#account-action');
  assert.equal((await signOutResponse).status(),200);
  await desktop.waitForFunction(()=>document.getElementById('account-action')?.textContent==='Continue with Google');
  assert.equal(await desktop.$eval('#account-action',element=>element.textContent),'Continue with Google');
  assert.equal(await desktop.evaluate(async()=>fetch('/api/account').then(r=>r.json()).then(r=>r.user)),null);
  assert.equal((await api('/api/account',null,nativeToken)).body.user.id,'fixture-reader','Browser sign-out must not revoke another device');
  assert.equal((await api('/api/native-login',{operation:'revoke'},nativeToken)).status,200);
  assert.equal((await api('/api/account',null,nativeToken)).status,401);
  assert.deepEqual(errors,[]);
  report.push({browserSignOut:true,nativeRevocationIndependent:true,noBrowserErrors:true,explicitSchemaGuard:true});
  console.log(JSON.stringify(report,null,2));
}finally{
  await browser?.close();
  if(server&&server.exitCode===null){
    server.kill('SIGTERM');
    await Promise.race([new Promise(resolve=>server.once('exit',resolve)),pause(5000)]);
    if(server.exitCode===null)server.kill('SIGKILL');
  }
  await fs.mkdir(output,{recursive:true});
  await fs.writeFile(output+'/verification.json',JSON.stringify(report,null,2));
  await fs.rm(directory,{recursive:true,force:true});
}
