import assert from 'node:assert/strict';
import {test} from 'node:test';
import {persistImmutable,requirePacketDiff,failureArtifact} from '../git-artifacts.mjs';
import {gitBlobOid} from '../interpretation.mjs';
const base={sha:'a'.repeat(40),tree:{sha:'b'.repeat(40)}};
const branch=`learning/receipt-${'c'.repeat(64)}`,files={'receipt.json':'{}\n'};
function fake(){
 const commits=new Map(),trees=new Map(),refs=new Map(),writes=[];let count=1;
 const oid=()=>String(count++).padStart(40,'0');
 const api={
  async optional(route){return refs.get(route)||null;},
  async get(route){
   if(route.startsWith('/git/commits/'))return commits.get(route.split('/').at(-1));
   if(route.startsWith('/git/trees/'))return trees.get(route.split('/').at(-1).split('?')[0]);
   if(route.startsWith('/compare/'))return {merge_base_commit:{sha:base.sha},files:Object.keys(files).map(p=>({filename:`learning-output/${p}`,status:'added'}))};
   throw Error('unexpected test read');
  },
  async post(route,body){
   writes.push({route,body});
   if(route==='/git/blobs')return {sha:gitBlobOid(body.content)};
   if(route==='/git/trees'){const sha=oid();trees.set(sha,{sha,truncated:false,tree:body.tree});return {sha};}
   if(route==='/git/commits'){const sha=oid();commits.set(sha,{sha,tree:{sha:body.tree},parents:body.parents.map(sha=>({sha}))});return {sha};}
   if(route==='/git/refs'){
    const key=`/git/ref/${body.ref.slice(5)}`;if(refs.has(key)){const e=Error('exists');e.status=422;throw e;}
    const ref={ref:body.ref,object:{sha:body.sha}};refs.set(key,ref);return ref;
   }
   throw Error('unexpected test write');
  }
 };
 return {api,commits,trees,refs,writes};
}
test('unchanged retries reuse immutable receipt; interrupted create resumes without force or update',async()=>{
 const f=fake(),options={base,branch,files};
 const first=await persistImmutable(f.api,options),writes=f.writes.length;
 const retry=await persistImmutable(f.api,options);assert.equal(retry.commit,first.commit);assert.equal(retry.reused,true);assert.equal(f.writes.length,writes);
 assert(!f.writes.some(w=>w.body.force));
 const interrupted=fake(),post=interrupted.api.post;let once=true;
 interrupted.api.post=async(route,body)=>{if(route==='/git/refs'&&once){once=false;throw Error('interrupted');}return post(route,body);};
 await assert.rejects(persistImmutable(interrupted.api,options),/interrupted/);
 assert.equal(interrupted.refs.size,0);await persistImmutable(interrupted.api,options);assert.equal(interrupted.refs.size,1);
});
test('ref creation race accepts only exactly the same immutable bytes',async()=>{
 const f=fake(),original=f.api.optional;let reads=0;
 await persistImmutable(f.api,{base,branch,files});
 f.api.optional=async route=>reads++===0?null:original(route);
 const result=await persistImmutable(f.api,{base,branch,files});assert.equal(result.reused,true);
 await assert.rejects(persistImmutable(f.api,{base,branch,files:{'receipt.json':'{"changed":true}\n'}}),/immutable_artifact_mismatch/);
});
test('stale source before ref creation publishes no current receipt',async()=>{
 const f=fake();let checks=0;
 await assert.rejects(persistImmutable(f.api,{base,branch,files,assertCurrent:async()=>{if(++checks===2)throw Error('stale_input');}}),/stale_input/);
 assert.equal(f.refs.size,0);
});
test('AI branches may change only the permitted new packet, never code or caches',()=>{
 const packet=`learning-inbox/${base.sha}/${'c'.repeat(64)}.json`;
 const good={merge_base_commit:{sha:base.sha},status:'ahead',files:[{filename:packet,status:'added'}]};
 requirePacketDiff(good,base.sha,packet);
 for(const name of ['learning/reconcile.mjs','package-lock.json','.github/workflows/learning-finalize.yml','node_modules/ajv/index.js'])assert.throws(()=>requirePacketDiff({...good,files:[...good.files,{filename:name,status:'modified'}]},base.sha,packet),/unauthorized/);
 assert.throws(()=>requirePacketDiff({...good,merge_base_commit:{sha:'d'.repeat(40)}},base.sha,packet),/unauthorized/);
});
test('durable failures contain only closed error codes and provenance, no exception text',()=>{
 const state=failureArtifact({packetCommit:'a'.repeat(40),sourceRevision:'b'.repeat(40),engineFingerprint:'c'.repeat(64),code:'PRIVATE_SENTINEL_OPINION'});
 assert(!JSON.stringify(state).includes('PRIVATE_SENTINEL'));assert.equal(JSON.parse(state.files['state.json']).code,'transport_failure');
});
