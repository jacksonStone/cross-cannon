import {connect,updateSurface,signIn,signOut,openURL,isActive,activityGeneration,safeInsets} from './platform.js';
import {legacyCheckpoint} from './migrate.js';
import {connectMedia,audioCommand,downloadCommand} from './media.js';
// Build-time pin: an incumbent worker may still cache the mutable manifest alias.
const manifestURL='/browser/manifest.__READER_VERSION__.json';
const loading=document.getElementById('loading');
function libraryStatus(text){
  let status=document.getElementById('library-status');
  if(!text){status?.remove();return;}
  if(!status){status=document.createElement('p');status.id='library-status';status.setAttribute('role','status');document.body.append(status);}
  status.textContent=text;
}
async function resource(path,kind='bytes'){
  const response=await fetch(path);
  if(!response.ok)throw Error('Could not open this reading. Reconnect and try again');
  return kind==='text'?response.text():kind==='json'?response.json():new Uint8Array(await response.arrayBuffer());
}
async function registerOfflineReader(){
  if(!('serviceWorker' in navigator))return;
  const registration=await navigator.serviceWorker.register('/cross-canon-rust-sw.js',{scope:'/'});
  const offerUpdate=()=>{
    if(!registration.waiting||!navigator.serviceWorker.controller||document.getElementById('reader-update'))return;
    const button=document.createElement('button');button.id='reader-update';button.textContent='Reader update ready · Reload';
    button.onclick=()=>{navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload(),{once:true});registration.waiting.postMessage({type:'ACTIVATE_READER_UPDATE'});};
    document.body.append(button);
  };
  offerUpdate();registration.addEventListener('updatefound',()=>registration.installing?.addEventListener('statechange',offerUpdate));
}
// Wait for the actual reading surface to paint before background offline staging.
function readable(){return new Promise(resolve=>{
  const check=()=>document.querySelector('#reader:not([hidden]) .passage')?requestAnimationFrame(()=>requestAnimationFrame(resolve)):requestAnimationFrame(check);
  check();
});}
// Native checkpoints assume one live writer. Keep that invariant in the
// browser adapter instead of letting independent tabs overwrite offline notes.
async function acquireReaderSession(){
  if(!navigator.locks)throw Error('This browser does not support protected local reader storage');
  let acquired,failed,release;
  const ready=new Promise((resolve,reject)=>{acquired=resolve;failed=reject;});
  const lifetime=new Promise(resolve=>{release=resolve;});
  window.addEventListener('pagehide',()=>release(),{once:true});
  window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
  const hold=async()=>{acquired();await lifetime;};
  navigator.locks.request('cross-canon-reader-session-v1',{ifAvailable:true},async lock=>{
    if(lock){await hold();return;}
    loading.querySelector('p').textContent='Cross Canon is open in another tab. Close that reader to continue here.';
    loading.querySelector('progress').hidden=true;
    navigator.locks.request('cross-canon-reader-session-v1',hold).catch(failed);
  }).catch(failed);
  await ready;
  loading.querySelector('p').textContent='Opening your library…';
  loading.querySelector('progress').hidden=false;
}
try {
  await acquireReaderSession();
  const response=await fetch(manifestURL);
  if(!response.ok)throw Error('The reader build is unavailable');
  const manifest=await response.json();
  globalThis.crossCanonPlatform={updateSurface,signIn,signOut,openURL,audioCommand,downloadCommand,isActive,activityGeneration,safeInsets,libraryStatus};
  const progress=loading.querySelector('progress');progress.max=4;progress.value=0;
  // Start compiling WASM immediately alongside the compact identity/catalog.
  const engine=import(manifest.module).then(async wasm=>{await wasm.default({module_or_path:manifest.wasm});progress.value++;return wasm;});
  const [wasm,library,catalog,archive,legacy]=await Promise.all([
    engine,resource(manifest.library),resource(manifest.catalog,'text'),resource(manifest.archive,'json'),legacyCheckpoint()
  ]);
  progress.value=2;
  const chapters=JSON.parse(wasm.prepare(library,catalog,legacy,JSON.stringify(archive)));
  connect(wasm.dispatch,JSON.parse(wasm.icons_json()),JSON.parse(wasm.library_navigation_json()));
  connectMedia(wasm.dispatch);
  const sources=[...new Map(chapters.map(id=>[archive[id].text,archive[id]])).values()];
  const fragments=await Promise.all(sources.map(async source=>{
    const [bytes,reading]=await Promise.all([resource(source.text),source.reading?resource(source.reading,'text'):'']);
    return {bytes,reading};
  }));
  for(const fragment of fragments)wasm.stage_fragment(fragment.bytes,fragment.reading);
  progress.value=3;
  await wasm.start(document.getElementById('app-canvas'));
  globalThis.crossCanonReader={dispatch:wasm.dispatch,version:manifest.version};
  await readable();
  loading.remove();
  performance.mark('cross-canon-readable');
  // Complete offline reading is retained, but never competes with opening text.
  const stage=()=>registerOfflineReader().catch(error=>console.error('Offline reader staging failed',error));
  if('requestIdleCallback' in window)requestIdleCallback(stage,{timeout:3000});else setTimeout(stage,1000);

}catch(error){
  loading.querySelector('p').textContent=`${error.message}. Check your connection and try again.`;
  loading.querySelector('progress').hidden=true;
  const retry=document.createElement('button');retry.textContent='Try again';retry.onclick=()=>location.reload();loading.append(retry);
  console.error(error);
}
