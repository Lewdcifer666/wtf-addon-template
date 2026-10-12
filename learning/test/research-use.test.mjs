import assert from 'node:assert/strict';
import {test} from 'node:test';
import {receiptInputs} from './fixtures/receipt-inputs.mjs';
import {receiptApi,verifiedReceipt} from './fixtures/verified-receipt.mjs';
import {buildReceipt} from '../receipt.mjs';
import {loadVerifiedReceipt} from '../receipt-loader.mjs';
import {prepareResearchUse,verifyResearchUse} from '../research-use.mjs';
import {interpretationRequest,gitBlobOid,stableJson} from '../interpretation.mjs';

async function fixture(){
 const inputs=receiptInputs();inputs.activation.research_learning_enabled=true;
 const artifact=await verifiedReceipt(inputs,buildReceipt(inputs));
 return {inputs,artifact,genre:'scifi',researchDate:'2026-10-12'};
}
test('active fresh handoff is deterministic, private, sanitized and immutable',async()=>{
 const args=await fixture(),before=stableJson(args),issued=prepareResearchUse(args);
 assert.deepEqual(prepareResearchUse(args),issued);assert.equal(stableJson(args),before);
 assert.deepEqual(verifyResearchUse({...args,issued}),issued);
 for(const text of ['PRIVATE_SENTINEL','PRIVATE_SYNTHETIC_ID','tt999999991','feedback_id','generated_at'])assert(!stableJson(issued).includes(text));
 assert.equal(issued.context.genre,'scifi');assert(issued.context.preferences.length>0);
 assert.throws(()=>{args.artifact.commit='f'.repeat(40);},TypeError);
 assert.throws(()=>{args.artifact.files['receipt.json']='{}';},TypeError);
});
test('inactive, incomplete, forged and unpinned receipts cannot reach research',async()=>{
 const args=await fixture();args.inputs.activation.research_learning_enabled=false;assert.throws(()=>prepareResearchUse(args),/inactive/);
 for(const mutate of [a=>{a.artifact={...a.artifact,commit:'f'.repeat(40)};},a=>{a.artifact=structuredClone(a.artifact);},a=>{a.genre='unknown';},a=>{a.researchDate='2026-02-30';}]){
  const changed=await fixture();mutate(changed);assert.throws(()=>prepareResearchUse(changed));
 }
});
test('authenticated loader rejects forged refs, commits, trees, blobs and extra changes',async()=>{
 const inputs=receiptInputs(),expected=buildReceipt(inputs);
 for(const mutate of [x=>{x.ref.object.sha='f'.repeat(40);},x=>{x.ref.ref='refs/heads/elsewhere';},x=>{x.commit.parents=[];},x=>{x.tree.sha='f'.repeat(40);},x=>{x.tree.truncated=true;},x=>{x.tree.tree[0].sha='f'.repeat(40);},x=>{x.tree.tree.pop();},x=>{x.comparison.files.push({filename:'learning/reconcile.mjs',status:'modified'});},x=>{x.metadata.private=false;},x=>{x.api.repository='Lewdcifer666/wtf-thriller-stremio';}]){
  const options=receiptApi(inputs,expected);mutate(options);await assert.rejects(loadVerifiedReceipt(options));
 }
 const missing=receiptApi(inputs,expected);missing.api.optional=async()=>null;
 await assert.rejects(loadVerifiedReceipt(missing),/receipt_not_persisted/);
 const stale=receiptApi(inputs,expected);stale.assertCurrent=async()=>{throw Error('stale_input');};
 await assert.rejects(loadVerifiedReceipt(stale),/stale_input/);
});
test('fresh current source, policy, engine and activation are required at consumption',async()=>{
 for(const mutate of [a=>{a.inputs.source.inventory_hash='2'.repeat(64);},a=>{a.inputs.profiles.anime.revision='2'.repeat(40);},a=>{a.inputs.engineFingerprint='2'.repeat(64);},a=>{a.inputs.activation.research_learning_enabled=false;}]){
  const args=await fixture(),issued=prepareResearchUse(args);mutate(args);assert.throws(()=>verifyResearchUse({...args,issued}));
 }
 const args=await fixture(),issued=prepareResearchUse(args);issued.context.preferences=[];
 assert.throws(()=>verifyResearchUse({...args,issued}),/changed/);
 const tomorrow=await fixture();
 assert.throws(()=>verifyResearchUse({...tomorrow,issued:prepareResearchUse(tomorrow),researchDate:'2026-10-13'}),/daily key/);
});
test('superseding feedback invalidates the prior receipt and handoff',async()=>{
 const args=await fixture(),issued=prepareResearchUse(args),old=args.inputs.source.tips[0];
 const event={...old,feedback_id:'SUPERSEDING_SYNTHETIC',supersedes:old.feedback_id,feedback:''};
 args.inputs.source.records.push({event,blob_oid:gitBlobOid(stableJson(event))});
 args.inputs.source.tips=[event];args.inputs.source.event_count=2;args.inputs.source.source_revision='2'.repeat(40);args.inputs.source.inventory_hash='3'.repeat(64);
 args.inputs.packet={schema_version:1,source_revision:args.inputs.source.source_revision,request_id:interpretationRequest(args.inputs.source).request_id,interpretations:[]};
 assert.throws(()=>verifyResearchUse({...args,issued}),/stale/);
 args.artifact=await verifiedReceipt(args.inputs,buildReceipt(args.inputs));
 const fresh=prepareResearchUse(args);assert.notEqual(fresh.use_id,issued.use_id);assert.equal(fresh.context.preferences.length,0);
});
test('retracted evidence cannot be revived by a previously valid handoff',async()=>{
 const args=await fixture(),issued=prepareResearchUse(args);
 args.inputs.source.tips=[];args.inputs.source.source_revision='4'.repeat(40);args.inputs.source.inventory_hash='4'.repeat(64);
 args.inputs.packet={schema_version:1,source_revision:args.inputs.source.source_revision,request_id:interpretationRequest(args.inputs.source).request_id,interpretations:[]};
 assert.throws(()=>verifyResearchUse({...args,issued}),/stale/);
 args.artifact=await verifiedReceipt(args.inputs,buildReceipt(args.inputs));
 assert.equal(prepareResearchUse(args).context.preferences.length,0);
});
