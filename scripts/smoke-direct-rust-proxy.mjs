import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const base=(process.argv[2]??'https://www.crosscanon.com').replace(/\/$/,'');
const manifest=JSON.parse(await readFile('scripture-cache/manifest.json','utf8'));
async function check(path,options={},status=200,rust=true){
 const response=await fetch(base+path,{redirect:'manual',signal:AbortSignal.timeout(30000),...options});
 assert.equal(response.status,status,path);
 assert.equal(response.headers.get('x-cross-canon-upstream'),rust?'rust':null,path);
 return response;
}
const health=await check('/r/api/health');assert.equal((await health.json()).service,'R Cross Cannon');
const books=await check('/r/api/books');assert(Array.isArray((await books.json()).books));
for(const path of [`/scripture-cache/${manifest.version}.json`,'/church-fathers-preview/books.json','/church-fathers-preview/chapters/anf%30%39_xii.iv.i.json?v=direct%20proxy','/audio/WEBD_AT/01_Genesis_01.mp3']) {
 const response=await check(path,{method:'HEAD'});assert.equal(response.headers.get('x-cross-canon-resource'),'rust');
}
for(const path of ['/r/api/robots.txt','/r/api/____reserved/_ping','/r/api/____reserved/stripe/webhook']) {
 const response=await check(path,{},404);assert.equal((await response.json()).error,'Route not found');
}
await check('/cross-canon-sw-release-test.js',{},404);
for(const path of ['/','/church-fathers','/?_data=routes%2F_index']) {const response=await check(path,{method:'HEAD'},200,false);await response.body?.cancel();}
console.log('Direct Rust edge routes verified; React pages stay on Node, including data requests and reserved API errors.');
