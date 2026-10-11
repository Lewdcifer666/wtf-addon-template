import assert from 'node:assert/strict';
import {test} from 'node:test';
import {inventoryFeedback} from '../inventory.mjs';
import {resolveFeedback} from '../resolve-feedback.mjs';
import {gitBlobOid,stableJson} from '../interpretation.mjs';

export const event=(id,extra={})=>({schema_version:3,feedback_id:id,supersedes:null,imdb_id:'tt999999991',source_id:'tt999999991',status:'seen',rated_at:'2026-10-01T10:00:00Z',rating:4,premise_interest:null,liked:[],disliked:[],profile_context:null,feedback:null,...extra});
export function source(events,other={}){
 const blobs=new Map(),entries=[];
 for(const [path,value] of [...events.map(e=>[`data/feedback/${e.rated_at.slice(0,10)}/${e.feedback_id}.json`,e]),...Object.entries(other)]){
  const bytes=Buffer.from(stableJson(value)),sha=gitBlobOid(bytes);blobs.set(sha,bytes);entries.push({path,sha,type:'blob',mode:'100644',size:bytes.length});
 }
 return {commit:{sha:'a'.repeat(40),tree:{sha:'b'.repeat(40)}},tree:{sha:'b'.repeat(40),truncated:false,tree:entries},blobs};
}
test('full graph precedes identity and retraction filtering across schemas',()=>{
 const old=event('old',{schema_version:1,imdb_id:null,source_id:'foreign:123',liked:['biology']}),next=event('next',{supersedes:'old',schema_version:2}),tomb=event('tomb',{supersedes:'next',status:'retracted',rating:null});
 assert.deepEqual(resolveFeedback([tomb,old,next]).map(e=>e.feedback_id),['tomb']);
 const current=event('current',{supersedes:'tomb'});
 assert.deepEqual(resolveFeedback([tomb,current,old,next]).map(e=>e.feedback_id),['current']);
});
test('independent equal-time tips use existing ID tie break and no parent resurrection',()=>{
 assert.deepEqual(resolveFeedback([event('b'),event('a')]).map(e=>e.feedback_id),['b']);
 const a=event('a'),b=event('b',{imdb_id:'tt999999992',supersedes:'a'});
 assert.deepEqual(resolveFeedback([a,b]).map(e=>e.feedback_id),['b']);
});
test('bad topology, duplicate IDs, unknown schema and impossible timestamp block whole rebuild',()=>{
 for(const events of [[event('a',{supersedes:'missing'})],[event('a'),event('a')],[event('a',{supersedes:'b'}),event('b',{supersedes:'a'})],[event('a',{schema_version:4})],[event('a',{rated_at:'2026-02-30T10:00:00Z'})]])assert.throws(()=>resolveFeedback(events));
});
test('complete inventory permits separate interpretation references, binds every raw byte',()=>{
 const inputs=source([event('one')],{'learning-inbox/request/batch.json':{schema_version:1,interpretations:[{feedback_id:'one',raw_blob_oid:'c'.repeat(40)}]}});
 const result=inventoryFeedback(inputs);assert.equal(result.event_count,1);assert.equal(result.tips[0].feedback_id,'one');
 const changed=structuredClone(inputs);changed.blobs.set(inputs.tree.tree[0].sha,Buffer.from('{}'));assert.throws(()=>inventoryFeedback(changed),/blob/);
});
test('truncated, omitted, misplaced, symlinked and misnamed raw sources fail closed',()=>{
 const cases=[i=>i.tree.truncated=true,i=>i.tree.sha='f'.repeat(40),i=>i.blobs.clear(),i=>i.tree.tree[0].mode='120000',i=>i.tree.tree[0].path='data/feedback/2026-10-01/not-one.json'];
 for(const change of cases){const i=source([event('one')]);change(i);assert.throws(()=>inventoryFeedback(i));}
 assert.throws(()=>inventoryFeedback(source([],{ 'elsewhere.json':{events:[event('outside')]}})),/outside/);
});
