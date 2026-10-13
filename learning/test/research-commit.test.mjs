import assert from 'node:assert/strict';
import {test} from 'node:test';
import {receiptInputs} from './fixtures/receipt-inputs.mjs';
import {verifiedReceipt} from './fixtures/verified-receipt.mjs';
import {buildReceipt} from '../receipt.mjs';
import {prepareResearchUse} from '../research-use.mjs';
import {authenticateResearchCommit} from '../research-commit.mjs';
import {gitBlobOid,stableJson,interpretationRequest} from '../interpretation.mjs';

async function fixture({dna={mystery:8},candidates=null}={}){
 const inputs=receiptInputs();inputs.activation.research_learning_enabled=true;
 const artifact=await verifiedReceipt(inputs,buildReceipt(inputs)),researchDate='2026-10-12',genre='scifi';
 const issued=prepareResearchUse({inputs,artifact,genre,researchDate});
 const packet={schema_version:1,genre,research_date:researchDate,candidates:candidates??[{imdb_id:'tt11111111',type:'movie',dna,dna_confidence:1}],research_rejections:[]};
 const revision='5'.repeat(40),base=issued.source_heads.public.scifi,bytes=Buffer.from(stableJson(packet)),oid=gitBlobOid(bytes);
 const branch=`research/${researchDate}-${genre}`,packetPath=`research-inbox/${researchDate}.json`;
 const metadata={full_name:'Lewdcifer666/wtf-scifi-stremio',private:false,default_branch:'main'};
 const ref={ref:'refs/heads/'+branch,object:{sha:revision}},commit={sha:revision,parents:[{sha:base}],tree:{sha:'6'.repeat(40)}};
 const tree={sha:commit.tree.sha,truncated:false,tree:[{path:packetPath,type:'blob',mode:'100644',sha:oid,size:bytes.length}]};
 const comparison={status:'ahead',merge_base_commit:{sha:base},total_commits:1,files:[{filename:packetPath,status:'added'}]};
 const blob={encoding:'base64',size:bytes.length,content:bytes.toString('base64')};
 const api={repository:metadata.full_name,pinMain:async()=>({sha:base}),get:async route=>{
  if(route==='/')return metadata;if(route===`/git/ref/heads/${branch}`)return ref;
  if(route===`/git/commits/${revision}`)return commit;if(route===`/git/trees/${commit.tree.sha}?recursive=1`)return tree;
  if(route===`/compare/${base}...${revision}`)return comparison;if(route===`/git/blobs/${oid}`)return blob;
  throw Error('Unexpected synthetic read');
 },post:async()=>{throw Error('Read-only research verification attempted a write');}};
 return {inputs,artifact,issued,researchDate,commit:revision,api,validatePacket:()=>[],assertCurrent:async()=>{},metadata,ref,gitCommit:commit,tree,comparison,blob,packet};
}
test('research diagnostics bind actual packet bytes and Git ancestry while preserving baseline scoring',async()=>{
 const args=await fixture(),before=stableJson(args.inputs),trace=await authenticateResearchCommit(args);
 assert.deepEqual(trace,await authenticateResearchCommit(args));assert.equal(stableJson(args.inputs),before);
 assert.equal(trace.candidates[0].baseline_score,80);assert(trace.candidates[0].content_adjustment>0);
 assert.equal(trace.effect_status,'candidate_diagnostics_only');assert.equal(trace.publication_scores_unchanged,true);
 for(const forbidden of ['PRIVATE_SENTINEL','PRIVATE_SYNTHETIC_ID','feedback_id','generated_at'])assert(!stableJson(trace).includes(forbidden));
});
test('untrusted repositories, changed code, forged graph data and packet blobs fail closed',async()=>{
 for(const mutate of [a=>{a.metadata.private=true;},a=>{a.api.repository='Lewdcifer666/wtf-action-stremio';},a=>{a.ref.object.sha='7'.repeat(40);},a=>{a.gitCommit.parents=[];},a=>{a.tree.truncated=true;},a=>{a.tree.sha='8'.repeat(40);},a=>{a.tree.tree[0].mode='120000';},a=>{a.blob.content=Buffer.from('{}').toString('base64');},a=>{a.comparison.files.push({filename:'scripts/evil.mjs',status:'added'});},a=>{a.comparison.total_commits=2;}]){
  const args=await fixture();mutate(args);await assert.rejects(authenticateResearchCommit(args));
 }
});
test('trusted profile packet validation is mandatory and rejects invalid candidate research',async()=>{
 for(const validatePacket of [undefined,()=>true,()=>['synthetic profile-specific validation error'],()=>{throw Error('synthetic validator rejection');}]){
  const args=await fixture();args.validatePacket=validatePacket;await assert.rejects(authenticateResearchCommit(args));
 }
});
test('stale feedback, changed public base and races cannot authenticate a research use',async()=>{
 const feedback=await fixture();feedback.inputs.source.inventory_hash='9'.repeat(64);await assert.rejects(authenticateResearchCommit(feedback));
 const main=await fixture();main.api.pinMain=async()=>({sha:'9'.repeat(40)});await assert.rejects(authenticateResearchCommit(main),/stale_input/);
 const race=await fixture();let calls=0;race.assertCurrent=async()=>{if(++calls>1)throw Error('stale_input');};await assert.rejects(authenticateResearchCommit(race),/stale_input/);
 const missing=await fixture();missing.assertCurrent=undefined;await assert.rejects(authenticateResearchCommit(missing));
});
test('permitted unknown DNA and empty packets remain unknown or empty in diagnostics',async()=>{
 const unknown=await fixture({dna:{mystery:null}}),trace=await authenticateResearchCommit(unknown);
 assert.equal(unknown.packet.candidates[0].dna.mystery,null);assert.equal(trace.candidates[0].baseline_score,null);
 assert.equal(trace.candidates[0].content_adjustment,null);
 const zero=await authenticateResearchCommit(await fixture({candidates:[]}));assert.deepEqual(zero.candidates,[]);
 assert(!Object.hasOwn(zero,'accepted'));assert(!Object.hasOwn(zero,'publication_timestamp'));
});
test('retraction invalidates old use; recomputed diagnostics remove the learned term and retain baseline',async()=>{
 const args=await fixture(),old=await authenticateResearchCommit(args);
 args.inputs.source.tips=[];args.inputs.source.source_revision='9'.repeat(40);args.inputs.source.inventory_hash='9'.repeat(64);
 args.inputs.packet={schema_version:1,source_revision:args.inputs.source.source_revision,request_id:interpretationRequest(args.inputs.source).request_id,interpretations:[]};
 await assert.rejects(authenticateResearchCommit(args));
 args.artifact=await verifiedReceipt(args.inputs,buildReceipt(args.inputs));
 args.issued=prepareResearchUse({inputs:args.inputs,artifact:args.artifact,genre:'scifi',researchDate:args.researchDate});
 const fresh=await authenticateResearchCommit(args);assert.notEqual(fresh.trace_id,old.trace_id);
 assert.equal(fresh.candidates[0].baseline_score,old.candidates[0].baseline_score);
 assert.equal(fresh.candidates[0].content_adjustment,null);
});
test('repeated IMDb identities and normalized title aliases retain canonical duplicate diagnostics',async()=>{
 const first={imdb_id:'tt11111111',type:'movie',title:'Caf\u00e9 & Puzzle\u00b2',year:2020,dna:{mystery:8},dna_confidence:1};
 const repeated={...first,dna:{mystery:4}};
 const alias={...first,imdb_id:'tt22222222',title:'Cafe and Puzzle2'};
 const packet=[first,repeated,alias];
 const a=await authenticateResearchCommit(await fixture({candidates:packet}));
 const b=await authenticateResearchCommit(await fixture({candidates:[...packet].reverse()}));
 assert.deepEqual(a.candidates,b.candidates);assert.equal(a.candidates.length,3);
 assert.equal(a.candidates.filter(c=>c.diagnostic_status==='evaluated').length,1);
 for(const [index,c] of a.candidates.entries())if(c.diagnostic_status==='duplicate_in_packet'){
  assert(c.duplicate_of<index);assert(!Object.hasOwn(c,'content_adjustment'));assert(!Object.hasOwn(c,'baseline_score'));
 }
});
