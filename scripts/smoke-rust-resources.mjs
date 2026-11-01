import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { readFile, open } from 'node:fs/promises';
import { Script } from 'node:vm';
const base = new URL(process.argv[2] ?? 'http://127.0.0.1:3005');
const manifest = JSON.parse(await readFile('scripture-cache/manifest.json','utf8'));
const audio = JSON.parse(await readFile('public/continuous-audio.json','utf8'));
const original = '/audio/WEBD_AT/01_Genesis_01.mp3';
const continuous = audio.chapters[original].url;
async function get(path, headers={}, method='GET') {
  return new Promise((resolve,reject)=>{
    const url=new URL(base.href.replace(/\/$/,'')+path);
    const req=(url.protocol==='https:'?httpsRequest:httpRequest)(url,{headers,method},res=>{
      const chunks=[];res.on('data',data=>chunks.push(data));res.on('error',reject);
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));
    });req.on('error',reject);req.setTimeout(30000,()=>req.destroy(new Error('Timeout')));req.end();
  });
}
for (const path of ['/church-fathers-preview/books.json','/church-fathers-preview/manifest.json','/church-fathers-preview/first-clement-audio-alignment.json','/church-fathers-preview/confessions-audio-alignment.json','/church-fathers-preview/city-of-god-audio-alignment.json','/church-fathers-preview/chapters/anf09_xii.iv.i.json']) {
  const r=await get(path);assert.equal(r.status,200,path);assert.equal(r.headers['x-cross-canon-resource'],'rust',path);
  assert.deepEqual(r.body,await readFile('public'+path));
}
for (const compressed of [false,true]) {
  const path=`/scripture-cache/${manifest.version}.json`;
  const r=await get(path,{'Accept-Encoding':compressed?'gzip':'identity'});
  assert.equal(r.status,200);assert.equal(r.headers['x-cross-canon-resource'],'rust');
  assert.equal(r.headers.etag,`"${manifest.version}"`);
  assert.equal(r.headers['content-encoding'],compressed?'gzip':undefined);
  const file=await readFile('scripture-cache/'+manifest.version+'.json'+(compressed?'.gz':''));
  assert.deepEqual(r.body,file,'raw compressed/uncompressed bytes');
  const head=await get(path,{'Accept-Encoding':compressed?'gzip':'identity'},'HEAD');
  assert.equal(head.status,200);assert.equal(head.body.length,0);assert.equal(Number(head.headers['content-length']),file.length);
}
for (const path of [original,continuous]) {
  const r=await get(path,{Range:'bytes=0-1023'});
  assert.equal(r.status,206,path);assert.equal(r.headers['x-cross-canon-resource'],'rust');assert.equal(r.body.length,1024);
  const handle=await open('storage'+path,'r');
  try { const buffer=Buffer.alloc(1024);await handle.read(buffer,0,1024,0);assert.deepEqual(r.body,buffer); } finally {await handle.close();}
  const head=await get(path,{Range:'bytes=0-1023'},'HEAD');assert.equal(head.status,206);assert.equal(head.body.length,0);assert.equal(head.headers['content-length'],'1024');
}
assert.equal((await get(continuous,{Range:'bytes=4-2'})).status,416);
assert.equal((await get('/church-fathers-preview/chapters/%2e%2e%2fbooks.json')).status,404);
assert.equal((await get('/cross-canon-sw-release-test.js',{Host:'www.crosscanon.com'})).status,404);
if (['localhost','127.0.0.1'].includes(base.hostname)) {
  const sw=await get('/cross-canon-sw-release-test.js?release=rust-resource-check&failStage=1');
  assert.equal(sw.status,200);new Script(sw.body.toString());assert(sw.body.includes('release=rust-resource-check&failStage=1'));
}
console.log('Rust resources verified: unchanged JSON/gzip bytes, metadata/alignment, chapter text, range audio, HEAD, invalid ranges, and local-only test worker.');
