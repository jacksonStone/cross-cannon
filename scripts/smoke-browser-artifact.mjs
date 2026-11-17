// Verify the externally served shell and worker belong to the tested artifact.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const origin=process.argv[2]??'http://127.0.0.1:3005';
const manifest=JSON.parse(await fs.readFile('public/browser/manifest.json','utf8'));
for(const path of ['/','/reader/0c558fd2c95099cf1909774d','/church-fathers','/christian-classics','/christian-classics/read']){
  const response=await fetch(origin+path);assert.equal(response.status,200,path);
  assert.match(await response.text(),/id="app-canvas"/,path);
}
for(const workerPath of ['/cross-canon-rust-sw.js','/cross-canon-sw.js?release=retired-reader']){
const response=await fetch(origin+workerPath);
assert.equal(response.status,200);
assert.match(response.headers.get('Cache-Control'),/no-cache/);
assert.equal(createHash('sha256').update(await response.text()).digest('hex'),manifest.worker,'A copied worker must not shadow the current reader build');
}
assert.equal((await fetch(origin+'/browser/manifest.json').then(r=>r.json())).version,manifest.version);
const wasm=await fetch(origin+manifest.wasm,{method:'HEAD'});
assert.equal(wasm.status,200);assert.match(wasm.headers.get('Content-Type'),/application\/wasm/);
console.log(`Shared Rust browser shell, content-addressed WASM, and worker verified (${manifest.version}).`);
