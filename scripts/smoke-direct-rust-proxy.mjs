// The existing edge uses two ports; every response comes from one Rust process.
// This smoke performs only reads and method discovery, never account mutations.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const base=(process.argv[2]??'https://www.crosscanon.com').replace(/\/$/,'');
const manifest=JSON.parse(await readFile('scripture-cache/manifest.json','utf8'));
async function check(path,options={},status=200,edgeAPI=true){
  const response=await fetch(base+path,{redirect:'manual',signal:AbortSignal.timeout(30000),...options});
  assert.equal(response.status,status,path);
  assert.equal(response.headers.get('x-cross-canon-runtime'),'rust',`${path}: unified runtime`);
  // This header identifies the Go edge's existing API/resource backend choice,
  // not the implementation language of the default application upstream.
  assert.equal(response.headers.get('x-cross-canon-upstream'),edgeAPI?'rust':null,`${path}: edge route`);
  return response;
}
function privateResponse(response,path){
  assert.match(response.headers.get('cache-control'),/\bprivate\b/,path);
  assert.match(response.headers.get('cache-control'),/\bno-store\b/,path);
  assert.match(response.headers.get('vary'),/\bcookie\b/i,path);
  assert.equal(response.headers.get('access-control-allow-origin'),null,path);
  assert.equal(response.headers.get('access-control-allow-credentials'),null,path);
}
const health=await check('/r/api/health');
const runtime=await health.json();
assert.equal(runtime.service,'R Cross Cannon');
assert.equal(runtime.runtime,'rust');
assert.equal(runtime.accountBackend,true);
const books=await check('/r/api/books');
assert(Array.isArray((await books.json()).books));
for(const path of [`/scripture-cache/${manifest.version}.json`,'/church-fathers-preview/books.json','/church-fathers-preview/chapters/anf%30%39_xii.iv.i.json?v=direct%20proxy','/audio/WEBD_AT/01_Genesis_01.mp3']){
  const response=await check(path,{method:'HEAD'});
  assert.equal(response.headers.get('x-cross-canon-resource'),'rust',path);
}
// Classics already reaches the primary Rust listener through the unchanged edge.
const classics=await check('/christian-classics-text/books.json',{method:'HEAD'},200,false);
assert.equal(classics.headers.get('x-cross-canon-resource'),'rust');
for(const path of ['/r/api/robots.txt','/r/api/____reserved/_ping','/r/api/____reserved/stripe/webhook']){
  const response=await check(path,{},404);
  assert.equal((await response.json()).error,'Route not found');
}
await check('/cross-canon-sw-release-test.js',{},404);
for(const path of ['/','/church-fathers','/christian-classics','/christian-classics/read','/reader/0c558fd2c95099cf1909774d','/?_data=routes%2F_index']){
  await check(path,{method:'HEAD'},200,false);
}
for(const path of ['/browser/manifest.json','/cross-canon-rust-sw.js','/cross-canon-sw.js']){
  const response=await check(path,{method:'HEAD'},200,false);
  assert.match(response.headers.get('cache-control'),/no-cache/,path);
}
for(const path of ['/account','/account/native']){
  privateResponse(await check(path,{method:'HEAD',headers:{Origin:'https://untrusted.example'}},200,false),path);
}
const accountResponse=await check('/api/account',{headers:{Origin:'https://untrusted.example'}},200,false);
privateResponse(accountResponse,'/api/account');
const account=await accountResponse.json();
assert.equal(typeof account.configured,'boolean');
assert.equal(account.user,null);
for(const [path,status] of [
  ['/api/auth/get-session',account.configured?200:503],
  ['/api/study',account.configured?401:503],
  ['/api/native-login',405],
  ['/api/auth/unknown-route',404],
]){
  privateResponse(await check(path,{headers:{Origin:'https://untrusted.example'}},status,false),path);
}
// Discover the retained form methods without running more searches or changing
// rate-limit state. smoke-rust-web.ts separately verifies the real POST results.
for(const path of ['/','/church-fathers','/christian-classics/read']){
  const response=await check(path,{method:'OPTIONS'},405,false);
  assert.match(response.headers.get('allow'),/\bPOST\b/,path);
}
const commentary=await check('/api/classic-commentary',{},400,false);
assert.equal(typeof (await commentary.json()).error,'string');
console.log('Unified Rust runtime verified through both existing edge routes; account privacy/CORS, reader assets, auth and compatibility methods pass.');
