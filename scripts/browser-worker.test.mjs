import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {test} from 'node:test';

test('a worker stages and opens its own version even if mutable aliases advance',async()=>{
  const version='a'.repeat(20),origin='https://reader.test';
  const manifest=`/browser/manifest.${version}.json`,document=`/browser/index.${version}.html`;
  const script='/browser/start.'+'b'.repeat(20)+'.js';
  const network=new Map([
    [manifest,JSON.stringify({version,files:{'index.html':'old-alias',[document.slice(9)]:'own-page',[script.slice(9)]:'own-script'}})],
    [document,'This release A'],[script,'This script A'],
    ['/browser/manifest.json',JSON.stringify({version:'future B'})],['/browser/index.html','Future page B'],
  ]);
  const handlers=new Map(),stores=new Map(),requests=[];
  let offline=false;
  const key=input=>new URL(typeof input==='string'?input:input.url,origin).href;
  const fetch=async input=>{
    const path=new URL(key(input)).pathname;requests.push(path);
    if(offline||!network.has(path))throw Error(`Unavailable ${path}`);
    return new Response(network.get(path));
  };
  const caches={
    async open(name){
      if(!stores.has(name))stores.set(name,new Map());const store=stores.get(name);
      return {async put(request,response){store.set(key(request),response.clone());},async match(request){return store.get(key(request))?.clone();},async add(request){store.set(key(request),await fetch(request));}};
    },
    async keys(){return [...stores.keys()];},async delete(name){return stores.delete(name);},
  };
  const source=(await fs.readFile(new URL('../web/service-worker.js',import.meta.url),'utf8')).replaceAll('__READER_VERSION__',version);
  vm.runInNewContext(source,{self:{addEventListener:(type,handler)=>handlers.set(type,handler),clients:{claim:async()=>{}},skipWaiting(){}},location:{origin},URL,Request:class extends Request{constructor(url,options){super(new URL(url,origin),options);}},Response,caches,fetch});
  let installed;handlers.get('install')({waitUntil:promise=>{installed=promise;}});await installed;
  assert.ok(requests.includes(manifest));assert.ok(requests.includes(document));
  assert.ok(!requests.includes('/browser/manifest.json'));assert.ok(!requests.includes('/browser/index.html'));
  offline=true;
  let result;handlers.get('fetch')({request:{url:origin+'/reader/example',method:'GET',mode:'navigate'},respondWith:promise=>{result=promise;}});
  assert.equal(await (await result).text(),'This release A');
  handlers.get('fetch')({request:{url:origin+manifest,method:'GET'},respondWith:promise=>{result=promise;}});
  assert.equal((await (await result).json()).version,version);
});
