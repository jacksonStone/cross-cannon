// Run beside the production services. Uses existing files; never rebuilds data.
import assert from 'node:assert/strict';
import { Agent, request } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import path from 'node:path';

const output = process.env.RESOURCE_BENCHMARK_OUTPUT ?? '.scratch/rust-resource-routes/runtime-production';
const count = Number(process.env.RESOURCE_BENCHMARK_SAMPLES ?? 21);
assert(Number.isInteger(count) && count >= 5 && count <= 50);
const manifest = JSON.parse(await readFile('scripture-cache/manifest.json','utf8'));
const audio = JSON.parse(await readFile('public/continuous-audio.json','utf8'));
const continuous = audio.chapters['/audio/WEBD_AT/01_Genesis_01.mp3'].url;
const backends = {
  legacy: { base: process.env.RESOURCE_LEGACY_ORIGIN ?? 'http://127.0.0.1:13005', agent: new Agent({keepAlive:true,maxSockets:1}) },
  web: { base: 'http://127.0.0.1:3005', agent: new Agent({keepAlive:true,maxSockets:1}) },
  direct: { base: 'http://127.0.0.1:3006/r/api/resources', agent: new Agent({keepAlive:true,maxSockets:1}) }
};
const cases = [
  { name:'Scripture cache, JSON', path:`/scripture-cache/${manifest.version}.json` },
  { name:'Scripture cache, gzip', path:`/scripture-cache/${manifest.version}.json`, headers:{'Accept-Encoding':'gzip'} },
  { name:'Early Christian book catalog', path:'/church-fathers-preview/books.json' },
  { name:'Early Christian chapter', path:'/church-fathers-preview/chapters/anf09_xii.iv.i.json' },
  { name:'Audio alignment metadata', path:'/church-fathers-preview/first-clement-audio-alignment.json' },
  { name:'Original MP3, 64 KiB range', path:'/audio/WEBD_AT/01_Genesis_01.mp3', headers:{Range:'bytes=0-65535'} },
  { name:'Continuous audio, 64 KiB range', path:continuous, headers:{Range:'bytes=0-65535'} },
  { name:'Continuous audio, 1 MiB range', path:continuous, headers:{Range:'bytes=0-1048575'} },
  { name:'Continuous audio, HEAD', path:continuous, method:'HEAD' }
];
async function measure(backend, test) {
  const start = performance.now();
  return new Promise((resolve,reject)=>{
    const req=request(new URL(backend.base+test.path), {agent:backend.agent,method:test.method??'GET',headers:{'Accept-Encoding':'identity',...test.headers}}, res=>{
      const firstByteMs=performance.now()-start;
      const chunks=[];
      res.on('data',data=>chunks.push(data));res.on('error',reject);
      res.on('end',()=>{
        const totalMs=performance.now()-start;
        const body=Buffer.concat(chunks);
        resolve({totalMs,firstByteMs,status:res.statusCode,bytes:body.length,sha256:createHash('sha256').update(body).digest('hex'),headers:res.headers});
      });
    });
    req.on('error',reject);req.setTimeout(30000,()=>req.destroy(new Error('Benchmark timeout')));req.end();
  });
}
const stats = values => {
  const sorted=[...values].sort((a,b)=>a-b);
  return {medianMs:sorted[Math.ceil(sorted.length*.5)-1],p95Ms:sorted[Math.ceil(sorted.length*.95)-1],minMs:sorted[0],samples:values};
};
const rows=[];
try {
  for (const test of cases) {
    const measurements={legacy:[],web:[],direct:[]};
    const keys=Object.keys(backends);
    let reference;
    for(let i=-3;i<count;i++) {
      const rotation=(i+3)%keys.length;
      for(const name of [...keys.slice(rotation),...keys.slice(0,rotation)]) {
        const result=await measure(backends[name],test);
        assert.equal(result.status,test.headers?.Range?206:200,`${test.name}: ${name}`);
        if(name!=='legacy') assert.equal(result.headers['x-cross-canon-resource'],'rust');
        else assert.equal(result.headers['x-cross-canon-resource'],undefined,'Legacy must not forward to Rust');
        reference ??= result;
        assert.equal(result.sha256,reference.sha256,`${test.name}: identical body bytes required`);
        assert.equal(result.headers['content-encoding'],reference.headers['content-encoding']);
        if(i>=0) measurements[name].push(result);
      }
    }
    const row={name:test.name,path:test.path,method:test.method??'GET',bytes:reference.bytes,sha256:reference.sha256};
    for(const name of keys) row[name]={total:stats(measurements[name].map(r=>r.totalMs)),firstByte:stats(measurements[name].map(r=>r.firstByteMs)),headers:measurements[name].at(-1).headers};
    row.webSpeedup=row.legacy.total.medianMs/row.web.total.medianMs;
    rows.push(row);
    console.log(`${row.name}: legacy ${row.legacy.total.medianMs.toFixed(2)} ms; Rust via web ${row.web.total.medianMs.toFixed(2)} ms; Rust direct ${row.direct.total.medianMs.toFixed(2)} ms; ${(100*(row.web.total.medianMs/row.legacy.total.medianMs-1)).toFixed(1)}% web time change`);
  }
  const report={date:new Date().toISOString(),cpu:os.cpus()[0].model,platform:`${os.platform()} ${os.arch()}`,node:process.version,samplesPerCase:count,cacheVersion:manifest.version,
    method:'Same production host, sequential requests, keep-alive, three warmups excluded, backend order rotated each round. Legacy is the previous deployed bundle with its original Remix server on an isolated loopback port; web is the deployed Rust-backed path including Node forwarding; direct is Rust without Node forwarding. Times include complete raw body transfer to this Node client, excluding concatenation/hash calculation. Every response body matches by SHA-256; ranges and gzip stay byte-identical. No provider, browser rendering, WAN/TLS, cold disk, or concurrent-load measurement. Normal production traffic may add noise. p95 uses nearest rank.',rows};
  await mkdir(path.dirname(output),{recursive:true});
  await writeFile(output+'.json',JSON.stringify(report,null,2)+'\n');
  await writeFile(output+'.md',`# Resource runtime comparison\n\n${report.date} · ${report.cpu} · ${report.node}\n\n${report.method}\n\n| Resource | Legacy median / p95 | Rust via web median / p95 | Rust direct median / p95 | Web time change |\n|---|---:|---:|---:|---:|\n`+rows.map(r=>`| ${r.name} | ${r.legacy.total.medianMs.toFixed(2)} / ${r.legacy.total.p95Ms.toFixed(2)} ms | ${r.web.total.medianMs.toFixed(2)} / ${r.web.total.p95Ms.toFixed(2)} ms | ${r.direct.total.medianMs.toFixed(2)} / ${r.direct.total.p95Ms.toFixed(2)} ms | ${(100*(r.web.total.medianMs/r.legacy.total.medianMs-1)).toFixed(1)}% |`).join('\n')+'\n\nPositive web time change means slower. Direct Rust results isolate handler/transport costs but are not the current public web path. Raw samples, byte counts, hashes, headers and first-byte timings are in [runtime JSON](runtime-production.json).\n');
} finally {for(const backend of Object.values(backends)) backend.agent.destroy();}
