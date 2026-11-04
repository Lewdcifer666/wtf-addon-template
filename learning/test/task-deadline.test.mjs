import assert from 'node:assert/strict';
import {test} from 'node:test';
import {assertPrivateTaskDeadline,linkPrivateTaskDeadline,privateTaskDelay,withPrivateTaskDeadline} from '../task-deadline.mjs';
import {createBrokerGitHub} from '../broker-github.mjs';
import {createResearchWorkerDispatch} from '../research-worker-dispatch.mjs';
import {resolveFeedback} from '../resolve-feedback.mjs';

test('private deadline bounds queue wait and stops linked IO without renewing the request',async()=>{
 let controller,finished=false;let release;
 const work=withPrivateTaskDeadline(async()=>{
  controller=new AbortController();const unlink=linkPrivateTaskDeadline(controller);
  try{await new Promise(r=>{release=r;});assertPrivateTaskDeadline();finished=true;}finally{unlink();}
 },{timeoutMs:15});
 await assert.rejects(work,{code:'private_task_pending'});assert(controller.signal.aborted);release();
 await new Promise(r=>setImmediate(r));assert.equal(finished,false);
});
test('nested and interpretation requests retain the original deadline and closed error family',async()=>{
 await assert.rejects(withPrivateTaskDeadline(()=>withPrivateTaskDeadline(()=>privateTaskDelay(100)),{timeoutMs:15,code:'private_interpretation_pending'}),{code:'private_interpretation_pending'});
 assert.throws(()=>withPrivateTaskDeadline(()=>{}, {timeoutMs:30000}),{code:'invalid_task_call'});
 assert.equal(await withPrivateTaskDeadline(async()=>42),42);
});
test('an expired caller cannot send a late GitHub read or workflow dispatch after token acquisition',async()=>{
 for(const dispatch of [false,true]){
  let release,calls=0;
  const getToken=()=>new Promise(r=>{release=()=>r('synthetic-token-for-deadline');});
  const fetcher=async()=>{calls++;return new Response(null,{status:204});};
  const operation=dispatch?createResearchWorkerDispatch({getToken,fetcher}):createBrokerGitHub({repository:'Lewdcifer666/wtf-scifi-feedback',getToken,fetcher});
  const call={schema_version:1,operation:'open',request:{schema_version:1,genre:'scifi',research_date:'2026-11-04',private_revision:'a'.repeat(40),public_revision:'b'.repeat(40)}};
  await assert.rejects(withPrivateTaskDeadline(()=>dispatch?operation(call):operation.get('/'),{timeoutMs:15}),{code:'private_task_pending'});
  release();await new Promise(r=>setImmediate(r));assert.equal(calls,0);
 }
});
test('schema3 supports all six contexts while unknown attribution still fails closed',()=>{
 const row={schema_version:3,feedback_id:'synthetic-contract',imdb_id:'tt1234567',source_id:null,status:'seen',rated_at:'2026-11-04T00:00:00Z',rating:4,supersedes:null};
 for(const profile_context of ['action','anime','fantasy','mystery','scifi','thriller',null])assert.equal(resolveFeedback([{...row,profile_context}]).length,1);
 assert.throws(()=>resolveFeedback([{...row,profile_context:'unknown'}]));
});
