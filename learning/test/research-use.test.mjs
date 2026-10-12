import assert from 'node:assert/strict';
import {test} from 'node:test';
import {receiptInputs} from './fixtures/receipt-inputs.mjs';
import {buildReceipt} from '../receipt.mjs';
import {prepareResearchUse,verifyResearchUse} from '../research-use.mjs';
import {interpretationRequest,gitBlobOid,stableJson} from '../interpretation.mjs';

function fixture(){
 const inputs=receiptInputs();inputs.activation.research_learning_enabled=true;
 const artifact={...buildReceipt(inputs),commit:'1'.repeat(40)};
 return {inputs,artifact,genre:'scifi',researchDate:'2026-10-12'};
}
test('active fresh handoff is deterministic, private, sanitized and immutable',()=>{
 const args=fixture(),before=stableJson(args),issued=prepareResearchUse(args);
 assert.deepEqual(prepareResearchUse(args),issued);assert.equal(stableJson(args),before);
 assert.deepEqual(verifyResearchUse({...args,issued}),issued);
 for(const text of ['PRIVATE_SENTINEL','PRIVATE_SYNTHETIC_ID','tt999999991','feedback_id','generated_at'])assert(!stableJson(issued).includes(text));
 assert.equal(issued.context.genre,'scifi');assert(issued.context.preferences.length>0);
});
test('inactive, incomplete, forged and unpinned receipts cannot reach research',()=>{
 const args=fixture();args.inputs.activation.research_learning_enabled=false;assert.throws(()=>prepareResearchUse(args),/inactive/);
 for(const mutate of [a=>{delete a.artifact.files['normalized-evidence.json'];},a=>{a.artifact.files['research-context/scifi.json']='{}\n';},a=>{a.artifact.commit='main';},a=>{a.artifact.branch='learning/receipt-forged';},a=>{a.artifact.files['extra.json']='{}';},a=>{a.genre='unknown';},a=>{a.researchDate='2026-02-30';}]){
  const changed=fixture();mutate(changed);assert.throws(()=>prepareResearchUse(changed));
 }
});
test('fresh current source, policy, engine and activation are required at consumption',()=>{
 for(const mutate of [a=>{a.inputs.source.inventory_hash='2'.repeat(64);},a=>{a.inputs.profiles.anime.revision='2'.repeat(40);},a=>{a.inputs.engineFingerprint='2'.repeat(64);},a=>{a.inputs.activation.research_learning_enabled=false;}]){
  const args=fixture(),issued=prepareResearchUse(args);mutate(args);assert.throws(()=>verifyResearchUse({...args,issued}));
 }
 const args=fixture(),issued=prepareResearchUse(args);issued.context.preferences=[];
 assert.throws(()=>verifyResearchUse({...args,issued}),/changed/);
});
test('superseding feedback invalidates the prior receipt and handoff',()=>{
 const args=fixture(),issued=prepareResearchUse(args),old=args.inputs.source.tips[0];
 const event={...old,feedback_id:'SUPERSEDING_SYNTHETIC',supersedes:old.feedback_id,feedback:''};
 args.inputs.source.records.push({event,blob_oid:gitBlobOid(stableJson(event))});
 args.inputs.source.tips=[event];args.inputs.source.event_count=2;args.inputs.source.source_revision='2'.repeat(40);args.inputs.source.inventory_hash='3'.repeat(64);
 args.inputs.packet={schema_version:1,source_revision:args.inputs.source.source_revision,request_id:interpretationRequest(args.inputs.source).request_id,interpretations:[]};
 assert.throws(()=>verifyResearchUse({...args,issued}),/stale/);
 args.artifact={...buildReceipt(args.inputs),commit:'3'.repeat(40)};
 const fresh=prepareResearchUse(args);assert.notEqual(fresh.use_id,issued.use_id);assert.equal(fresh.context.preferences.length,0);
});
test('retracted evidence cannot be revived by a previously valid handoff',()=>{
 const args=fixture(),issued=prepareResearchUse(args);
 // The trusted inventory loader has already resolved the retraction graph.
 // Complete raw records remain pinned while the surviving active tips are empty.
 args.inputs.source.tips=[];args.inputs.source.source_revision='4'.repeat(40);args.inputs.source.inventory_hash='4'.repeat(64);
 args.inputs.packet={schema_version:1,source_revision:args.inputs.source.source_revision,request_id:interpretationRequest(args.inputs.source).request_id,interpretations:[]};
 assert.throws(()=>verifyResearchUse({...args,issued}),/stale/);
 args.artifact={...buildReceipt(args.inputs),commit:'4'.repeat(40)};
 assert.equal(prepareResearchUse(args).context.preferences.length,0);
});
