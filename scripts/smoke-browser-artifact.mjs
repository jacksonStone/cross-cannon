// Verify the externally served shell and worker belong to the tested artifact.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const origin=process.argv[2]??'http://127.0.0.1:3005';
const manifest=JSON.parse(await fs.readFile('public/browser/manifest.json','utf8'));
const pinnedManifest=`/browser/manifest.${manifest.version}.json`;
for(const path of ['/','/reader/0c558fd2c95099cf1909774d','/church-fathers','/christian-classics','/christian-classics/read']){
  const response=await fetch(origin+path);assert.equal(response.status,200,path);
  const html=await response.text();
  assert.match(html,/id="app-canvas"/,path);
  assert.ok(html.includes(`src="${manifest.start}"`),`${path}: bootstrap belongs to the shell release`);
  assert.ok(html.includes(`href="${manifest.style}"`),`${path}: stylesheet belongs to the shell release`);
}
for(const workerPath of ['/cross-canon-rust-sw.js','/cross-canon-sw.js?release=retired-reader']){
const response=await fetch(origin+workerPath);
assert.equal(response.status,200);
assert.match(response.headers.get('Cache-Control'),/no-cache/);
assert.equal(createHash('sha256').update(await response.text()).digest('hex'),manifest.worker,'A copied worker must not shadow the current reader build');
}
assert.equal((await fetch(origin+'/browser/manifest.json').then(r=>r.json())).version,manifest.version);
const pinned=await fetch(origin+pinnedManifest);assert.equal(pinned.status,200);
assert.match(pinned.headers.get('Cache-Control'),/immutable/);
assert.deepEqual(await pinned.json(),manifest);
const start=await fetch(origin+manifest.start);assert.equal(start.status,200);
assert.match(start.headers.get('Cache-Control'),/immutable/);
assert.ok((await start.text()).includes(pinnedManifest),'Startup must not select a mutable manifest alias');
assert.equal((await fetch(origin+manifest.shell)).status,200,'Versioned offline shell is available');
const wasm=await fetch(origin+manifest.wasm,{method:'HEAD'});
assert.equal(wasm.status,200);assert.match(wasm.headers.get('Content-Type'),/application\/wasm/);
console.log(`Shared Rust browser shell, content-addressed WASM, and worker verified (${manifest.version}).`);
