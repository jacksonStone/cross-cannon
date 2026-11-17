// This worker stages an entire tested Rust reader release before activation.
const VERSION='__READER_VERSION__';
const SHELL='cross-canon-rust-shell-'+VERSION;
const AUDIO='cross-canon-browser-audio-v1';
self.addEventListener('message',(event)=>{if(event.data?.type==='ACTIVATE_READER_UPDATE')self.skipWaiting();});
self.addEventListener('install',(event)=>event.waitUntil((async()=>{
  const response=await fetch('/browser/manifest.json',{cache:'no-store'});
  if(!response.ok)throw Error('Reader manifest unavailable');
  const manifest=await response.clone().json();
  if(manifest.version!==VERSION)throw Error('Reader changed while staging');
  const cache=await caches.open(SHELL);
  try{
    const files=Object.keys(manifest.files).filter(p=>p!=='service-worker.js'&&!p.endsWith('.gz')&&!p.endsWith('.br'));
    // Bound background work instead of issuing over a thousand requests at once.
    let next=0;
    await Promise.all(Array.from({length:4},async()=>{
      while(next<files.length){const path='/browser/'+files[next++];await cache.add(new Request(path,{priority:'low'}));}
    }));
    await cache.put('/browser/manifest.json',response);
  }
  catch(error){await caches.delete(SHELL);throw error;}
  // A waiting update activates only after the user reloads/closes old tabs.
  // First install has no incumbent and can claim immediately on activation.
})()));
self.addEventListener('activate',(event)=>event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith('cross-canon-rust-shell-')&&key!==SHELL)await caches.delete(key);
  await self.clients.claim();
})()));
const readingPath=(path)=>path==='/'||path.startsWith('/reader/')||['/church-fathers','/christian-classics','/christian-classics/read'].includes(path);
self.addEventListener('fetch',(event)=>{
  const request=event.request,url=new URL(request.url);
  // OAuth/consent documents and private APIs never touch a content cache.
  if(url.origin===location.origin&&(url.pathname==='/account'||url.pathname.startsWith('/account/')||url.pathname.startsWith('/api/'))){
    event.respondWith(fetch(new Request(request,{cache:'no-store'})).catch(()=>new Response('Accounts are unavailable offline.',{status:503,headers:{'Cache-Control':'private, no-store'}})));return;
  }
  if(request.method!=='GET')return;
  if(url.origin===location.origin&&url.pathname.startsWith('/r/api/'))return;
  if(request.mode==='navigate'&&url.origin===location.origin&&readingPath(url.pathname)){
    event.respondWith((async()=>{try{return await fetch(request);}catch(error){const cached=await caches.open(SHELL).then((c)=>c.match('/browser/index.html'));if(cached)return cached;throw error;}})());return;
  }
  if(url.origin===location.origin&&url.pathname.startsWith('/browser/')){
    event.respondWith((async()=>{const cache=await caches.open(SHELL);return await cache.match(request)||fetch(request);})());return;
  }
  event.respondWith((async()=>{
    const cached=await caches.open(AUDIO).then((c)=>c.match(url.href));
    if(!cached)return fetch(request);
    const range=request.headers.get('Range');if(!range)return cached;
    const bytes=await cached.arrayBuffer();const match=/^bytes=(\d+)-(\d*)$/.exec(range);
    if(!match)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${bytes.byteLength}`}});
    const start=Number(match[1]),end=match[2]?Math.min(Number(match[2]),bytes.byteLength-1):bytes.byteLength-1;
    if(start>end||start>=bytes.byteLength)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${bytes.byteLength}`}});
    return new Response(bytes.slice(start,end+1),{status:206,headers:{'Content-Type':cached.headers.get('Content-Type')||'audio/mpeg','Content-Range':`bytes ${start}-${end}/${bytes.byteLength}`,'Content-Length':String(end-start+1),'Accept-Ranges':'bytes'}});
  })());
});
