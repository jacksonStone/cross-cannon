import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const origin='https://www.crosscanon.com';
const out=new URL('./search-matrix.json',import.meta.url);
const records=process.env.MATRIX_RESUME ? JSON.parse(await fs.readFile(out,'utf8')).records : [];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function request(path,body,form=false){
  for(let attempt=0;attempt<4;attempt++){
    const start=performance.now();
    const response=await fetch(origin+path,{method:'POST',headers:{'content-type':form?'application/x-www-form-urlencoded':'application/json'},body:form?new URLSearchParams(body):JSON.stringify(body),signal:AbortSignal.timeout(65000)});
    const payload=await response.json();
    if(response.status===429&&attempt<3){
      const seconds=Number(payload.retryAfterSeconds||60)+1;
      console.log(`Cooldown ${seconds}s for ${path}`);
      for(let s=0;s<seconds;s++)await pause(1000);
      continue;
    }
    return {status:response.status,ms:Math.round(performance.now()-start),upstream:response.headers.get('X-Cross-Canon-Search'),payload};
  }
}
async function test(name,fn){
  if(records.some(r=>r.name===name&&r.status==='pass'))return;
  const prior=records.findIndex(r=>r.name===name);
  if(prior>=0)records.splice(prior,1);
  const record={name};
  try{record.evidence=await fn();record.status='pass';console.log('PASS',name)}
  catch(e){record.status='fail';record.error=e.message;console.error('FAIL',name,e.message)}
  records.push(record);await fs.writeFile(out,JSON.stringify({origin,at:new Date().toISOString(),records},null,2));
}
const health=await (await fetch(origin+'/r/api/health')).json();
const catalog=(await (await fetch(origin+'/r/api/books')).json()).books;
const authors=[...new Set(catalog.map(b=>b.author).filter(Boolean))];
const cacheManifest=JSON.parse(await fs.readFile('scripture-cache/manifest.json','utf8'));
const cache=JSON.parse(await fs.readFile(`scripture-cache/${cacheManifest.version}.json`,'utf8'));
const scripture=cache.passages??cache;
const source=scripture[0].id;
const multiAuthors=['Clement of Rome','Augustine of Hippo','Tertullian'];
assert(multiAuthors.every(a=>authors.includes(a)));
const cases=[
  {name:'Theme anxiety / John and Romans / 5',query:'anxiety',books:['John','Romans'],limit:5},
  {name:'Theme hope after death / Orthodox / 40',query:'Hope after death',canon:'orthodox',limit:40},
  {name:'Theme punctuation and apostrophe / Catholic / 5',query:"God’s mercy, forgiveness & hope?",canon:'catholic',limit:5},
  {name:'Similar Scripture / John and Romans / 40',sourceId:source,books:['John','Romans'],limit:40},
  {name:'Scripture to Fathers / three authors / 40',sourceId:source,corpus:'early-christian',authors:multiAuthors,limit:40},
  {name:'Fathers theme / three authors / 5',query:'forgiving enemies',corpus:'early-christian',authors:multiAuthors,limit:5}
];
for(const c of cases)await test(c.name,async()=>{
  const {name,...fields}=c;
  const req={mode:'semantic',corpus:'scripture',canon:'protestant',web:true,...fields};
  const api=await request('/r/api/search',req);assert.equal(api.status,200,JSON.stringify(api.payload));
  const fathers=req.corpus==='early-christian';
  const form=[['intent',req.sourceId?(fathers?'similar-early-christian':'similar-passage'):(fathers?'theme-early-christian':'theme')],['question',req.query??''],['matchCount',String(req.limit)],['canon',req.canon]];
  if(req.sourceId)form.push(['sourcePassageId',req.sourceId]);
  for(const book of req.books??[])form.push(['books',book]);
  for(const author of req.authors??[])form.push(['earlyChristianAuthors',author]);
  const web=await request('/?_data=routes%2F_index',form,true);assert.equal(web.status,200,JSON.stringify(web.payload));
  assert.equal(web.upstream,'rust');
  const a=api.payload.results,b=web.payload[fathers?'earlyChristianResults':'results'];
  assert.equal(a.length,req.limit);assert.equal(b.length,a.length);
  const id=h=>fathers?h.highlightPassage.id:h.id;
  assert.deepEqual(a.map(id),b.map(id));assert.equal(new Set(a.map(id)).size,a.length);
  // The native adapter derives calibrated strength from score; the raw API
  // intentionally omits this presentation field. Remix adds it to its response.
  const strength=score=>score>=.72?4:score>=.64?3:score>=.56?2:1;
  a.forEach((hit,i)=>{assert(Math.abs(hit.score-b[i].score)<0.0001);assert.equal(hit.highlightVerse,b[i].highlightVerse);assert.equal(strength(hit.score),b[i].matchStrength);if(req.books?.length)assert(req.books.includes(hit.reference.match(/^(.+) \d+:/)?.[1]));if(fathers&&req.authors?.length)assert(req.authors.includes(hit.author));});
  return {request:req,count:a.length,apiMs:api.ms,webMs:web.ms,first:a[0],rankedIds:a.map(id)};
});
for(const [name,body] of [
  ['blank query',{query:'   '}],['query over 2000',{query:'a'.repeat(2001)}],
  ['zero limit',{query:'love',limit:0}],['unknown book',{query:'love',books:['unknown']}],
  ['unknown author',{query:'love',authors:['unknown']}],['four authors',{query:'love',authors:[...multiAuthors,'Justin Martyr']}],
  ['unknown source',{sourceId:'not-a-passage',corpus:'scripture',web:true}],
  ['query plus source',{query:'love',sourceId:source}],
  ['web keyword contract',{query:'love',web:true,corpus:'scripture'}]
])await test('API validation: '+name,async()=>{const r=await request('/r/api/search',body);assert.equal(r.status,400,JSON.stringify(r.payload));assert(r.payload.error);return r;});
await test('Keyword: no matches',async()=>{const r=await request('/r/api/search',{query:'zxqvnonexistentword',mode:'keyword',corpus:'scripture'});assert.equal(r.status,200);assert.equal(r.payload.results.length,0);return r;});
await test('Keyword: case and whitespace normalization',async()=>{const a=await request('/r/api/search',{query:'  BEGINNING  ',mode:'keyword',corpus:'scripture',books:['Genesis'],limit:5});const b=await request('/r/api/search',{query:'beginning',mode:'keyword',corpus:'scripture',books:['Genesis'],limit:5});assert.equal(a.status,200);assert.equal(b.status,200);assert(a.payload.results.length);assert.deepEqual(a.payload.results,b.payload.results);return {count:a.payload.results.length,results:a.payload.results};});
await fs.writeFile(out,JSON.stringify({origin,at:new Date().toISOString(),health,records},null,2));
console.log(JSON.stringify({passed:records.filter(r=>r.status==='pass').length,failed:records.filter(r=>r.status==='fail').length}));
process.exitCode=records.some(r=>r.status==='fail')?1:0;
