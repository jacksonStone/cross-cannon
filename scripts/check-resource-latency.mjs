// Manual timing regression check; keep separate from load-independent unit tests.
import assert from 'node:assert/strict';
import { Agent, request } from 'node:http';
import { performance } from 'node:perf_hooks';
const base=process.env.RESOURCE_ORIGIN??'http://127.0.0.1:3005';
const agent=new Agent({keepAlive:true,maxSockets:1});
const times=[];
try {
  for(let i=-2;i<11;i++) await new Promise((resolve,reject)=>{
    const start=performance.now();
    request(base+'/church-fathers-preview/chapters/anf09_xii.iv.i.json',{agent,headers:{'Accept-Encoding':'identity'}},response=>{
      assert.equal(response.statusCode,200);assert.equal(response.headers['x-cross-canon-resource'],'rust');
      response.resume();response.on('error',reject);response.on('end',()=>{if(i>=0)times.push(performance.now()-start);resolve();});
    }).on('error',reject).end();
  });
  const median=[...times].sort((a,b)=>a-b)[5];
  console.log(JSON.stringify({medianMs:median,samples:times}));
  assert(median<Number(process.env.MAX_RESOURCE_MEDIAN_MS??20),'Repeated small JSON responses must not stall for a delayed-ACK interval');
}finally{agent.destroy();}
