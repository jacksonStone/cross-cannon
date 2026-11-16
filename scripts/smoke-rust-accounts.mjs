// Production-safe anonymous checks: no login, database writes, or paid requests.
import assert from 'node:assert/strict';
const origin=(process.argv[2]??'http://127.0.0.1:3005').replace(/\/$/,'');
for(const path of ['/account','/account/native']){
  const response=await fetch(origin+path);
  assert.equal(response.status,200,path);
  assert.equal(response.headers.get("X-Cross-Canon-Runtime"),"rust",path);
  assert.match(response.headers.get('Content-Type'),/text\/html/);
  assert.match(response.headers.get('Cache-Control'),/no-store/);
}
const response=await fetch(origin+'/api/account');
assert.equal(response.status,200);
assert.equal(response.headers.get("X-Cross-Canon-Runtime"),"rust");
assert.match(response.headers.get('Cache-Control'),/no-store/);
const account=await response.json();
assert.equal(typeof account.configured,'boolean');
assert.equal(account.user,null);
console.log('Rust account documents and anonymous account protocol verified.');
