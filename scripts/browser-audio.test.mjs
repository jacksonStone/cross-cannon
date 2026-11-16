import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {existsSync} from 'node:fs';
import vm from 'node:vm';

const source = await readFile(new URL(existsSync(new URL('../web/media.js', import.meta.url))?'../web/media.js':'../public/browser/media.js', import.meta.url), 'utf8');
const continuous = JSON.parse(await readFile(new URL('../public/continuous-audio.json', import.meta.url), 'utf8')).chapters;
function harness({rejectEarlySeek=false}={}) {
  const players = [], events = [], actions = {};
  class Audio extends EventTarget {
    constructor() { super(); this.time=0; this.readyState=0; this.paused=true; this.seeking=false; this.plays=[]; players.push(this); }
    set src(value) { this.url=value; this.time=0; this.readyState=0; }
    get src() { return this.url; }
    set currentTime(value) { if(rejectEarlySeek&&this.readyState===0)throw Error('Metadata not loaded'); if (Number.isFinite(value)) this.time=value; }
    get currentTime() { return this.time; }
    play() { this.paused=false; return new Promise((resolve,reject)=>this.plays.push({resolve,reject})); }
    pause() { this.paused=true; this.dispatchEvent(new Event('pause')); }
    removeAttribute(name) { if (name==='src') this.src=''; }
    metadata() { this.readyState=1; this.time=0; this.dispatchEvent(new Event('loadedmetadata')); }
    async playing() { this.readyState=4; this.dispatchEvent(new Event('playing')); for (const pending of this.plays.splice(0)) pending.resolve(); await new Promise(setImmediate); }
    event(name) { this.dispatchEvent(new Event(name)); }
  }
  const context={Audio, navigator:{mediaSession:{setActionHandler:(name,fn)=>actions[name]=fn}}, MediaMetadata:class {constructor(data){Object.assign(this,data);}}, URL, JSON, Number, console};
  vm.runInNewContext(source.replace(/^export /gm,'')+'\nglobalThis.adapter={audioCommand,connectMedia};',context);
  context.adapter.connectMedia(json=>events.push(JSON.parse(json)));
  return {players,events,actions,command:command=>context.adapter.audioCommand(JSON.stringify(command))};
}
function plan(index=1) {
  // The actual native/core serialization is camelCase, including fractional offsets.
  const chapters=[1,2,3].map(n=>({id:`Genesis:${n}`,title:`Genesis ${n}`,audio:{...continuous[`/audio/WEBD_AT/01_Genesis_0${n}.mp3`]},fallback:{url:`/audio/chapter-${n}.mp3`,startSeconds:0,endSeconds:null}}));
  return {action:'play',plan:{chapters,index}};
}
const chapterEvents=h=>h.events.filter(e=>e.id==='chapter').map(e=>e.book);

test('playing Genesis 2 uses its real serialized chapter offset, including after metadata loads',async()=>{
  const h=harness(); const command=plan(); h.command(command);
  const player=h.players.at(-1), offset=command.plan.chapters[1].audio.startSeconds;
  assert.equal(player.currentTime,offset,'Play must begin at chapter 2, not the start of the book');
  player.metadata(); assert.equal(player.currentTime,offset,'metadata must not reset the chapter seek');
  await player.playing(); assert.deepEqual(chapterEvents(h),['Genesis:2']);
});

test('crossing a continuous recording chapter boundary advances exactly once without reloading',async()=>{
  const h=harness(); const command=plan(); h.command(command); const player=h.players.at(-1);
  player.metadata(); await player.playing(); player.currentTime=command.plan.chapters[1].audio.endSeconds+0.05; player.event('timeupdate'); player.event('timeupdate');
  assert.deepEqual(chapterEvents(h),['Genesis:2','Genesis:3']); assert.equal(h.players.at(-1),player);
});

test('fallback uses its own offset and advances when its chapter file ends',async()=>{
  const h=harness(); const command=plan(); command.plan.chapters[1].fallback.startSeconds=12.25;
  h.command(command); const primary=h.players.at(-1); primary.event('error');
  const fallback=h.players.at(-1); assert.equal(fallback.src,'/audio/chapter-2.mp3'); assert.equal(fallback.currentTime,12.25);
  fallback.metadata(); assert.equal(fallback.currentTime,12.25); await fallback.playing();
  fallback.event('ended'); const next=h.players.at(-1);
  assert.equal(next.src,command.plan.chapters[2].audio.url); assert.equal(next.currentTime,command.plan.chapters[2].audio.startSeconds);
});

test('late completion from an old play command cannot change the current chapter',async()=>{
  const h=harness(); h.command(plan(0)); const old=h.players.at(-1); h.command(plan(2)); const active=h.players.at(-1);
  active.metadata(); await active.playing(); old.metadata(); await old.playing(); old.event('error'); old.event('ended');
  assert.deepEqual(chapterEvents(h),['Genesis:3']); assert.equal(h.players.at(-1),active); assert.equal(active.currentTime,plan(2).plan.chapters[2].audio.startSeconds);
});

test('stop cancels pending metadata, playback completions, and fallback',async()=>{
  const h=harness(); h.command(plan()); const old=h.players.at(-1); h.command({action:'stop'}); const before=h.events.length;
  old.metadata(); await old.playing(); old.event('error'); old.event('ended');
  assert.equal(h.events.length,before); assert.deepEqual(chapterEvents(h),[]);
});

test('a noncontiguous chapter in the same file seeks forward to its aligned start',async()=>{
  const h=harness(); const command=plan(); command.plan.chapters[2].audio.startSeconds+=10;
  h.command(command); let player=h.players.at(-1); player.metadata(); await player.playing(); player.currentTime=command.plan.chapters[1].audio.endSeconds; player.event('timeupdate');
  player=h.players.at(-1); assert.equal(player.currentTime,command.plan.chapters[2].audio.startSeconds);
});

test('Media Session previous and next honor chapter offsets; toggle pauses/resumes',async()=>{
  const h=harness(); h.command(plan()); h.actions.nexttrack(); let player=h.players.at(-1); player.metadata(); await player.playing();
  assert.equal(player.currentTime,plan(2).plan.chapters[2].audio.startSeconds);
  h.actions.previoustrack(); player=h.players.at(-1); player.metadata(); await player.playing(); assert.equal(player.currentTime,plan().plan.chapters[1].audio.startSeconds);
  h.command({action:'toggle'}); assert.equal(player.paused,true); h.command({action:'toggle'}); assert.equal(player.paused,false);
});

test('engines that reject a pre-metadata seek still start at the aligned chapter',async()=>{
  const h=harness({rejectEarlySeek:true}); h.command(plan()); const player=h.players.at(-1);
  assert.equal(player.currentTime,0); player.metadata(); assert.equal(player.currentTime,267.52); await player.playing(); assert.deepEqual(chapterEvents(h),['Genesis:2']);
});

test('failed fallback does not loop and a late rejected resume cannot report after stop',async()=>{
  const h=harness(); h.command(plan()); h.players.at(-1).event('error'); const fallback=h.players.at(-1); fallback.event('error');
  assert.equal(h.players.length,2); assert.equal(h.events.filter(e=>e.id==='error').length,1);
  fallback.metadata(); await fallback.playing(); h.command({action:'toggle'}); h.command({action:'toggle'});
  h.command({action:'stop'}); const before=h.events.length; for(const pending of fallback.plays.splice(0)) pending.reject(Error('Aborted'));
  await new Promise(setImmediate); assert.equal(h.events.length,before);
});
