// Same-host comparison of the actual TLS edge, Node forwarding and direct Rust.
import assert from 'node:assert/strict';
import {Agent as HttpAgent,request as httpRequest} from 'node:http';
import {Agent as HttpsAgent,request as httpsRequest} from 'node:https';
import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import os from 'node:os';
import path from 'node:path';
const output=process.env.DIRECT_PROXY_BENCHMARK_OUTPUT??'.scratch/direct-rust-proxy/runtime-after';
const direct=process.env.EXPECT_DIRECT_RUST!=='0';
const count=21;
const cache=JSON.parse(await readFile('scripture-cache/manifest.json','utf8'));
const audio=JSON.parse(await readFile('public/continuous-audio.json','utf8'));
const continuous=audio.chapters['/audio/WEBD_AT/01_Genesis_01.mp3'].url;
const lookup=(_host,options,callback)=>options.all?callback(null,[{address:'127.0.0.1',family:4}]):callback(null,'127.0.0.1',4);
const backends={
 node:{base:'http://127.0.0.1:3005',agent:new HttpAgent({keepAlive:true,maxSockets:1})},
 edge:{base:'https://www.crosscanon.com',agent:new HttpsAgent({keepAlive:true,maxSockets:1}),lookup},
 rust:{base:'http://127.0.0.1:3006/r/api/resources',agent:new HttpAgent({keepAlive:true,maxSockets:1})}
};
const cases=[
 {name:'Scripture JSON',path:`/scripture-cache/${cache.version}.json`},
 {name:'Scripture gzip',path:`/scripture-cache/${cache.version}.json`,headers:{'Accept-Encoding':'gzip'}},
 {name:'Book catalog',path:'/church-fathers-preview/books.json'},
 {name:'Chapter JSON',path:'/church-fathers-preview/chapters/anf09_xii.iv.i.json'},
 {name:'Alignment JSON',path:'/church-fathers-preview/first-clement-audio-alignment.json'},
 {name:'MP3 64 KiB',path:'/audio/WEBD_AT/01_Genesis_01.mp3',headers:{Range:'bytes=0-65535'}},
 {name:'Continuous 64 KiB',path:continuous,headers:{Range:'bytes=0-65535'}},
 {name:'Continuous 1 MiB',path:continuous,headers:{Range:'bytes=0-1048575'}},
 {name:'Audio HEAD',path:continuous,method:'HEAD'}
];
function measure(name,test){
 const backend=backends[name];const url=new URL(backend.base+test.path);const start=performance.now();
 return new Promise((resolve,reject)=>{
  const req=(url.protocol==='https:'?httpsRequest:httpRequest)(url,{agent:backend.agent,lookup:backend.lookup,method:test.method??'GET',headers:{'Accept-Encoding':'identity','User-Agent':'CrossCanon-Runtime-Benchmark/1.0',...test.headers}},response=>{
   const firstByteMs=performance.now()-start;const chunks=[];
   response.on('data',chunk=>chunks.push(chunk));response.on('error',reject);
   response.on('end',()=>{const totalMs=performance.now()-start;const body=Buffer.concat(chunks);resolve({totalMs,firstByteMs,headers:response.headers,status:response.statusCode,bytes:body.length,sha256:createHash('sha256').update(body).digest('hex')});});
  });req.on('error',reject);req.setTimeout(30000,()=>req.destroy(new Error('Benchmark timeout')));req.end();
 });
}
const stats=values=>{const sorted=[...values].sort((a,b)=>a-b);return{medianMs:sorted[Math.ceil(sorted.length*.5)-1],p95Ms:sorted[Math.ceil(sorted.length*.95)-1],samples:values};};
const rows=[];
try{
 for(const test of cases){
  const measurements={node:[],edge:[],rust:[]};const names=Object.keys(backends);let reference;
  for(let round=-3;round<count;round++){
   const offset=(round+3)%3;
   for(const name of [...names.slice(offset),...names.slice(0,offset)]){
    const result=await measure(name,test);
    assert.equal(result.status,test.headers?.Range?206:200,`${name}: ${test.name}`);
    assert.equal(result.headers['x-cross-canon-resource'],'rust');
    if(name==='edge')assert.equal(result.headers['x-cross-canon-upstream'],direct?'rust':undefined,'Edge route marker');
    reference??=result;assert.equal(result.sha256,reference.sha256,'Identical bytes across paths');assert.equal(result.headers['content-encoding'],reference.headers['content-encoding']);
    if(round>=0)measurements[name].push(result);
   }
  }
  const row={name:test.name,bytes:reference.bytes,sha256:reference.sha256};
  for(const name of names)row[name]={total:stats(measurements[name].map(r=>r.totalMs)),firstByte:stats(measurements[name].map(r=>r.firstByteMs)),headers:measurements[name].at(-1).headers};
  rows.push(row);console.log(`${test.name}: edge ${row.edge.total.medianMs.toFixed(2)} ms; Node ${row.node.total.medianMs.toFixed(2)} ms; Rust ${row.rust.total.medianMs.toFixed(2)} ms`);
 }
 const report={date:new Date().toISOString(),platform:`${os.platform()} ${os.arch()}`,cpu:os.cpus()[0].model,node:process.version,edgeDirectToRust:direct,samples:count,
  method:'Actual production TLS edge reached through loopback DNS with normal certificate validation and original Host/SNI. Other paths use loopback HTTP. Keep-alive; three warmups excluded; 21 sequential samples per backend/case with rotated order. Timings include complete body transfer and exclude hash calculation. Payload hashes/encoding match. Before/after edge runs use the same TLS protocol and URL; no WAN, browser rendering or cold-disk measurement. Normal traffic and visit logging may add noise.',rows};
 await mkdir(path.dirname(output),{recursive:true});await writeFile(output+'.json',JSON.stringify(report,null,2)+'\n');
 await writeFile(output+'.md',`# Direct proxy runtime: ${direct?'after':'before'}\n\n${report.date} · ${report.cpu}\n\n${report.method}\n\n| Resource | Edge TLS median / p95 | Node HTTP median / p95 | Rust HTTP median / p95 |\n|---|---:|---:|---:|\n`+rows.map(r=>`| ${r.name} | ${r.edge.total.medianMs.toFixed(2)} / ${r.edge.total.p95Ms.toFixed(2)} ms | ${r.node.total.medianMs.toFixed(2)} / ${r.node.total.p95Ms.toFixed(2)} ms | ${r.rust.total.medianMs.toFixed(2)} / ${r.rust.total.p95Ms.toFixed(2)} ms |`).join('\n')+'\n');
}finally{for(const backend of Object.values(backends))backend.agent.destroy();}
