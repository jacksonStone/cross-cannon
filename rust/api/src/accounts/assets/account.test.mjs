import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
const script = await fs.readFile(new URL('./account.js', import.meta.url), 'utf8');
function setup({action='sign-in',native=false,configured=true,disabled=false,reply={url:'https://accounts.google.com/o/oauth2/v2/auth?state=test'},ok=true,assignThrows=false}={}) {
  const request = 'a'.repeat(64);
  const nodes = Object.fromEntries(['account-action','account-status','account-error','native-return','native-return-link','account-prompt','account-heading','card'].map(id=>[id,{textContent:'',hidden:false,disabled:false,setAttribute(key,value){this[key]=value;}}]));
  const button = nodes['account-action'];
  button.dataset={action}; button.disabled=disabled;button.textContent='Continue';
  const page={dataset:{page:native?'native':'account',configured:String(configured),requestId:request}};
  let click;
  button.addEventListener=(_event,listener)=>{click=listener;};
  const calls=[],locations=[];
  let reloads=0;
  vm.runInNewContext(script,{
    document:{querySelector:selector=>selector.startsWith('main')?page:nodes.card,getElementById:id=>nodes[id]},
    window:{location:{origin:'https://www.crosscanon.com',assign:href=>{locations.push(href);if(assignThrows)throw Error('App unavailable');},reload:()=>{reloads++;}}},
    fetch:async(path,options)=>{calls.push({path,options,body:JSON.parse(options.body)});return{ok,json:async()=>reply};},URL,
  });
  return {nodes,calls,locations,click,request,reloads:()=>reloads};
}

test('guest sign-in sends same-origin credentials and account callbacks without session polling',async()=>{
  const page=setup();assert.equal(page.calls.length,0);
  await page.click();
  assert.equal(page.calls.length,1);
  assert.equal(page.calls[0].path,'/api/auth/sign-in/social');
  assert.equal(page.calls[0].options.credentials,'same-origin');
  assert.equal(page.calls[0].options.cache,'no-store');
  assert.deepEqual(page.calls[0].body,{provider:'google',callbackURL:'/account',errorCallbackURL:'/account?signin=failed'});
  assert.match(page.locations[0],/^https:\/\/accounts\.google\.com\//);
});
test('native sign-in returns to the same pending app consent',async()=>{
  const page=setup({native:true});await page.click();
  assert.deepEqual(page.calls[0].body,{provider:'google',callbackURL:`/account/native?id=${page.request}`,errorCallbackURL:`/account/native?id=${page.request}&signin=failed`});
});
test('unconfigured and disabled sign-in makes no request',async()=>{
  const page=setup({configured:false,disabled:true});await page.click();
  assert.equal(page.calls.length,0);
});
test('sign-out refreshes server-rendered identity after successful logout',async()=>{
  const page=setup({action:'sign-out',reply:{success:true}});await page.click();
  assert.equal(page.calls[0].path,'/api/auth/sign-out');
  assert.deepEqual(page.calls[0].body,{});
  assert.equal(page.reloads(),1);
});
test('native approval retains the exact return link when automatic app launch fails',async()=>{
  const ticket='b'.repeat(64);
  const page=setup({action:'approve',native:true,reply:{ticket},assignThrows:true});await page.click();
  assert.equal(page.calls[0].path,'/api/native-login');
  assert.deepEqual(page.calls[0].body,{operation:'approve',id:page.request});
  const callback=`crosscanon://login-complete?request=${page.request}&ticket=${ticket}`;
  assert.equal(page.nodes['native-return-link'].href,callback);
  assert.equal(page.nodes['native-return'].hidden,false);
  assert.equal(page.nodes['account-prompt'].hidden,true);
  assert.equal(page.nodes['account-heading'].textContent,'You’re ready to read.');
  assert.equal(page.nodes['account-error'].hidden,true);
});
test('expired or invalid approval is visible and never opens a callback',async()=>{
  for(const options of [{reply:{ticket:'javascript:alert(1)'}},{ok:false,reply:{error:'expired'}}]) {
    const page=setup({action:'approve',native:true,...options});await page.click();
    assert.equal(page.locations.length,0);
    assert.equal(page.nodes['account-error'].hidden,false);
    assert.match(page.nodes['account-error'].textContent,/expired or could not be approved/);
    assert.equal(page.nodes['account-action'].disabled,false);
    assert.equal(page.nodes.card['aria-busy'],'false');
  }
});
test('invalid provider navigation targets become recoverable errors',async()=>{
  const page=setup({reply:{url:'javascript:alert(1)'}});await page.click();
  assert.equal(page.locations.length,0);
  assert.equal(page.nodes['account-error'].hidden,false);
  assert.equal(page.nodes['account-action'].disabled,false);
});
