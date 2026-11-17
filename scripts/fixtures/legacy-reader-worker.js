// Reproduce the incumbent worker's network-first HTML and cache-first mutable
// modules. Its old connect() expects the removed separate Library button.
const SHELL='cross-canon-rust-shell-upgrade-fixture';
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(SHELL);
  for(const [path,body] of [
    ['/browser/start.js',"import {connect} from './platform.js';globalThis.legacyStartupConsumed=true;connect(()=>{},{library:'old icon'});"],
    ['/browser/platform.js',"export function connect(send,icons){document.getElementById('reader-library').innerHTML=icons.library;}"],
    ['/browser/manifest.json',JSON.stringify({version:'legacy-fixture',module:'/browser/retired-reader.js'})],
    ['/browser/index.html','<!doctype html><p>Previous offline shell</p>'],
  ])await cache.put(path,new Response(body,{headers:{'Content-Type':path.endsWith('.js')?'text/javascript':'text/html'}}));
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET')return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request).catch(()=>caches.open(SHELL).then(cache=>cache.match('/browser/index.html'))));return;
  }
  if(url.pathname.startsWith('/browser/'))event.respondWith(caches.open(SHELL).then(async cache=>await cache.match(request)||fetch(request)));
});
