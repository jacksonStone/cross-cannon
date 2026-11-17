// Browser playback adapter. AudioLocation uses the core's camelCase wire fields.
let send, player, plan, controller, activeSource;
export function connectMedia(dispatch) { send = dispatch; }
const emit = (id, book='') => send?.(JSON.stringify({action:'audio-event', id, book}));
function current() { return plan?.chapters[plan.index]; }
function stopPlayer() {
  const old=player;
  // Invalidate listeners before pause/load dispatches events from the old source.
  player=null; activeSource=null;
  if(old) { old.pause(); old.removeAttribute('src'); old.load?.(); }
}
function loadChapter(useFallback=false) {
  const chapter=current(); if(!chapter)return;
  const source=useFallback?chapter.fallback:chapter.audio;
  if(!source)return;
  stopPlayer();
  const audio=player=new Audio(); activeSource=source; audio.preload='metadata';
  const isCurrent=()=>player===audio&&!!plan;
  let awaitingMetadata=true;
  const seek=()=>{ audio.currentTime=Math.max(0,source.startSeconds??0); };
  emit('loading');
  audio.addEventListener('loadedmetadata',()=>{
    if(!isCurrent())return;
    // Some engines reset the pre-metadata seek while opening the recording.
    // Reapply the aligned Chapter start before the first playable frame.
    try { seek(); awaitingMetadata=false; }
    catch(error) { audio.pause(); emit('error',`Could not seek to this chapter: ${error.message}`); }
  });
  audio.addEventListener('playing',()=>{if(isCurrent())emit('playing');});
  audio.addEventListener('pause',()=>{if(isCurrent())emit('paused');});
  audio.addEventListener('timeupdate',()=>{
    if(!isCurrent()||awaitingMetadata||audio.seeking)return;
    // Aligned Chapters can share one continuous recording. Retain that source
    // only while the next Chapter begins at this one's exact end.
    while(activeSource?.endSeconds!=null&&audio.currentTime>=activeSource.endSeconds) {
      if(plan.index+1>=plan.chapters.length) { stopPlayer(); emit('stopped'); return; }
      const previous=activeSource; plan.index++; const next=current();
      if(next.audio.url!==previous.url||Math.abs(next.audio.startSeconds-previous.endSeconds)>0.1) { loadChapter(); return; }
      activeSource=next.audio; emit('chapter',next.id);
    }
  });
  audio.addEventListener('ended',()=>{
    if(!isCurrent())return;
    if(plan.index+1<plan.chapters.length) { plan.index++; loadChapter(); }
    else { stopPlayer(); emit('stopped'); }
  });
  audio.addEventListener('error',()=>{
    if(!isCurrent())return;
    if(current()?.fallback&&!useFallback)loadChapter(true);
    else emit('error','Audio unavailable. Check your connection or download it first.');
  });
  if('mediaSession' in navigator) navigator.mediaSession.metadata=new MediaMetadata({title:chapter.title,artist:'Cross Canon'});
  audio.src=source.url;
  // Set the default playback position now, in the user's Play gesture. Engines
  // that defer seeking until metadata arrives use the listener above.
  try { seek(); } catch {}
  audio.play().then(()=>{if(isCurrent())emit('chapter',current().id);}).catch(error=>{
    if(isCurrent())emit('error',`Could not play audio: ${error.message}`);
  });
}
function resume() {
  const audio=player;
  audio?.play().catch(()=>{if(player===audio)emit('error','Tap play to start audio');});
}
function changeChapter(delta) {
  if(plan&&plan.index+delta>=0&&plan.index+delta<plan.chapters.length) { plan.index+=delta; loadChapter(); }
}
export function audioCommand(json) {
  const command=JSON.parse(json);
  if('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play',resume);
    navigator.mediaSession.setActionHandler('pause',()=>player?.pause());
    navigator.mediaSession.setActionHandler('seekto',e=>{if(player&&e.seekTime!=null)player.currentTime=e.seekTime;});
    navigator.mediaSession.setActionHandler('nexttrack',()=>changeChapter(1));
    navigator.mediaSession.setActionHandler('previoustrack',()=>changeChapter(-1));
  }
  if(command.action==='play') { plan=command.plan; loadChapter(); }
  else if(command.action==='toggle') { if(player?.paused)resume(); else player?.pause(); }
  else if(command.action==='stop') { stopPlayer(); plan=null; emit('stopped'); }
}
const AUDIO_CACHE='cross-canon-browser-audio-v1';
const audioURL=(url)=>new URL(url,location.origin).href;
async function inspect(id,urls,active=false,message='') {
  const cache=await caches.open(AUDIO_CACHE);let done=0,bytes=0;
  for(const url of urls){const response=await cache.match(audioURL(url));if(response){done++;bytes+=Number(response.headers.get('Content-Length')??0);}}
  send?.(JSON.stringify({action:'download-event',id:JSON.stringify({id,done,bytes,active,message}),book:''}));
}
export async function downloadCommand(json) {
  const command=JSON.parse(json);
  try {
    if(command.action==='pause'){controller?.abort();return;}
    if(command.action==='inspect'){for(const work of command.works)await inspect(work.id,work.urls);return;}
    const cache=await caches.open(AUDIO_CACHE);
    if(command.action==='remove'){for(const url of command.urls)await cache.delete(audioURL(url));await inspect(command.id,command.urls,false,'Removed recordings from this browser.');return;}
    if(command.action==='start'){
      controller=new AbortController();
      try{for(const url of command.urls){if(!await cache.match(audioURL(url))){const response=await fetch(url,{signal:controller.signal});if(!response.ok)throw Error(`Download failed (${response.status})`);const type=response.headers.get('Content-Type')??'';if(type.includes('text')||type.includes('json'))throw Error('The server did not return audio');const blob=await response.blob();if(!blob.size)throw Error('Empty audio recording');if(controller.signal.aborted)throw new DOMException('Paused','AbortError');await cache.put(audioURL(url),new Response(blob,{headers:{'Content-Type':type,'Content-Length':String(blob.size)}}));}await inspect(command.id,command.urls,true);}
        await inspect(command.id,command.urls,false,'Ready to play offline.');
      }catch(error){await inspect(command.id,command.urls,false,error.name==='AbortError'?'Paused. Complete recordings remain available.':`Could not download: ${error.message}`);}
    }
  }catch(error){send?.(JSON.stringify({action:'download-event',id:JSON.stringify({id:command.id,message:`Browser storage unavailable: ${error.message}`,active:false})}));}
}
