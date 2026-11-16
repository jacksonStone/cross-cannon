// Exercise the production adapter with genuine HTMLAudioElement metadata,
// seeking, range requests and playback promises; no remote recordings needed.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {once} from 'node:events';
import test from 'node:test';
import puppeteer from 'puppeteer';

test('real browser starts at chapter 2, advances a continuous track, and seeks its fallback', {timeout:60000}, async()=>{
  const adapter=await readFile(new URL('../web/media.js',import.meta.url));
  const manifest=JSON.parse(await readFile(new URL('../public/continuous-audio.json',import.meta.url),'utf8')).chapters;
  // An in-memory silent WAV keeps the real Genesis timestamps and uses no disk,
  // external service, codec executable, or production recording download.
  const samples=8000*700;
  const wav=Buffer.alloc(44+samples,128);
  wav.write('RIFF',0);wav.writeUInt32LE(36+samples,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(8000,28);wav.writeUInt16LE(1,32);wav.writeUInt16LE(8,34);wav.write('data',36);wav.writeUInt32LE(samples,40);
  const ranges=[];
  const server=createServer((request,response)=>{
    if(request.url==='/media.js'){response.writeHead(200,{'Content-Type':'text/javascript'});response.end(adapter);return;}
    if(request.url==='/unavailable.wav'){response.writeHead(404);response.end();return;}
    if(request.url==='/fixture.wav'){
      const range=request.headers.range;ranges.push(range??'full');
      const match=range?.match(/^bytes=(\d+)-(\d*)$/);const start=match?Number(match[1]):0;const end=match&&match[2]?Math.min(Number(match[2]),wav.length-1):wav.length-1;
      response.writeHead(match?206:200,{'Content-Type':'audio/wav','Accept-Ranges':'bytes','Content-Length':end-start+1,...(match?{'Content-Range':`bytes ${start}-${end}/${wav.length}`}:{})});response.end(wav.subarray(start,end+1));return;
    }
    response.writeHead(200,{'Content-Type':'text/html'});response.end('<script type="module">import * as adapter from "/media.js"; window.events=[]; adapter.connectMedia(json=>events.push(JSON.parse(json))); window.adapter=adapter;</script>');
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  let browser;
  try {
    browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
    const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.evaluateOnNewDocument(()=>{window.players=[];const NativeAudio=window.Audio;window.Audio=function(...args){const audio=new NativeAudio(...args);players.push(audio);return audio;};});
    const origin=`http://127.0.0.1:${server.address().port}`;
    await page.goto(origin);await page.waitForFunction(()=>window.adapter);
    const chapters=[1,2,3].map(n=>({id:`Genesis:${n}`,title:`Genesis ${n}`,audio:{...manifest[`/audio/WEBD_AT/01_Genesis_0${n}.mp3`],url:`${origin}/fixture.wav`},fallback:{url:`${origin}/fixture.wav`,startSeconds:12.25,endSeconds:null}}));
    const play=async(index,items=chapters)=>page.evaluate(command=>adapter.audioCommand(JSON.stringify(command)),{action:'play',plan:{chapters:items,index}});
    await play(1);
    await page.waitForFunction(()=>events.some(e=>e.id==='chapter'&&e.book==='Genesis:2')&&!players.at(-1).seeking);
    let state=await page.evaluate(()=>({time:players.at(-1).currentTime,playing:!players.at(-1).paused,count:players.length}));
    assert.ok(state.time>=267.5&&state.time<269,`Genesis 2 started at ${state.time}`);assert.equal(state.playing,true);assert.ok(ranges.some(range=>range.startsWith('bytes=')));
    await page.evaluate(end=>players.at(-1).currentTime=end+0.05,chapters[1].audio.endSeconds);
    await page.waitForFunction(()=>events.some(e=>e.id==='chapter'&&e.book==='Genesis:3'));
    assert.equal(await page.evaluate(()=>players.length),state.count,'continuous chapter transition must retain the loaded recording');
    const fallback=structuredClone(chapters);fallback[1].audio.url=`${origin}/unavailable.wav`;
    await page.evaluate(()=>events.length=0);await play(1,fallback);
    await page.waitForFunction(()=>events.some(e=>e.id==='chapter'&&e.book==='Genesis:2')&&!players.at(-1).seeking);
    state=await page.evaluate(()=>({time:players.at(-1).currentTime,source:players.at(-1).src}));
    assert.ok(state.time>=12.2&&state.time<14,`fallback started at ${state.time}`);assert.equal(state.source,`${origin}/fixture.wav`);
    await page.evaluate(()=>events.length=0);await play(0);await play(2);
    await page.waitForFunction(()=>events.some(e=>e.id==='chapter'&&e.book==='Genesis:3')&&!players.at(-1).seeking);
    const final=await page.evaluate(()=>({time:players.at(-1).currentTime,chapters:events.filter(e=>e.id==='chapter').map(e=>e.book),errors:events.filter(e=>e.id==='error')}));
    assert.ok(final.time>=460&&final.time<462,`rapid chapter change started at ${final.time}`);assert.deepEqual(final.chapters,['Genesis:3']);assert.deepEqual(final.errors,[]);
    await page.evaluate(()=>adapter.audioCommand(JSON.stringify({action:'stop'})));
    assert.equal(await page.evaluate(()=>players.at(-1).paused),true);assert.deepEqual(errors,[]);
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
