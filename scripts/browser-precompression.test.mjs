import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {brotliDecompressSync} from 'node:zlib';
import {test} from 'node:test';
import {precompress} from './precompress-browser.mjs';

test('build-time encodings round-trip binary and nested text artifacts deterministically',()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'cross-canon-encoding-'));
  try{
    mkdirSync(path.join(directory,'chunks'));
    const text=Buffer.from(JSON.stringify({text:'A complete Chapter with canonical Passage identities. '.repeat(200)}));
    const binary=Buffer.concat([Buffer.from([0,97,115,109,1,0,0,0]),text]);
    const inputs=[['reader.wasm',binary],['chunks/text.bin',binary],['chunks/msb.json',text]];
    for(const [name,bytes] of inputs)writeFileSync(path.join(directory,name),bytes);
    writeFileSync(path.join(directory,'reader.wasm.gz'),'existing gzip');
    precompress(directory);
    const first=inputs.map(([name,bytes])=>{
      const encoded=readFileSync(path.join(directory,name+'.br'));
      assert.deepEqual(brotliDecompressSync(encoded),bytes);
      assert.ok(encoded.length<bytes.length);
      return encoded;
    });
    precompress(directory);
    inputs.forEach(([name],i)=>assert.deepEqual(readFileSync(path.join(directory,name+'.br')),first[i]));
    assert.equal(readFileSync(path.join(directory,'reader.wasm.gz'),'utf8'),'existing gzip');
    assert.equal(existsSync(path.join(directory,'reader.wasm.gz.br')),false);
  }finally{rmSync(directory,{recursive:true,force:true});}
});
