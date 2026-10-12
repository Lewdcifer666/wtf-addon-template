import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildReceipt,verifyReceipt,GENRES} from '../receipt.mjs';
import {interpretationRequest,gitBlobOid,stableJson} from '../interpretation.mjs';
import {receiptInputs as inputs} from './fixtures/receipt-inputs.mjs';

test('receipt is deterministic, has no refresh clock, and hashes all six source policies and output bytes',()=>{
 const input=inputs(),before=stableJson(input),one=buildReceipt(input),two=buildReceipt(input);
 assert.deepEqual(one,two);assert.equal(stableJson(input),before);assert.equal(Object.keys(one.files).length,20);
 const receipt=JSON.parse(one.files['receipt.json']);assert.equal(receipt.research_learning_enabled,false);assert(!('generated_at' in receipt));
 assert.equal(verifyReceipt(one.files,one),true);
 const wrong={...one.files,'research-context/scifi.json':'{}\n'};assert.throws(()=>verifyReceipt(wrong,one),/differs/);
 const changed=inputs();changed.profiles.anime.revision='1'.repeat(40);assert.notEqual(buildReceipt(changed).branch,one.branch);
 changed.activation.research_learning_enabled=true;assert.notEqual(buildReceipt(changed).branch,buildReceipt(inputs()).branch);
});
test('no personal identifiers, opinions, ratings or quotes reach the sanitized private research briefs',()=>{
 const result=buildReceipt(inputs());
 for(const genre of GENRES){const text=result.files[`research-context/${genre}.json`];
  for(const forbidden of ['PRIVATE_SENTINEL','PRIVATE_SYNTHETIC_ID','tt999999991','rating','quote','feedback_id'])assert(!text.includes(forbidden));
 }
 assert(!result.files['normalized-evidence.json'].includes('PRIVATE_SENTINEL'));
});
test('partial six-profile state and AI score/activation fields cannot produce receipts',()=>{
 const missing=inputs();delete missing.profiles.mystery;assert.throws(()=>buildReceipt(missing),/All six/);
 const injected=inputs();injected.packet.score=99;assert.throws(()=>buildReceipt(injected),/schema/);
 const activation=inputs();activation.activation.public_catalog_personalization_enabled=true;assert.throws(()=>buildReceipt(activation),/activation/);
});

test('pinned title-specific execution evidence reaches learned diagnostics without fabricating unknown quality',()=>{
 const input=inputs(),first=input.source.tips[0];first.liked=['acting'];
 input.source.records[0].blob_oid=gitBlobOid(stableJson(first));input.packet.interpretations[0].raw_blob_oid=input.source.records[0].blob_oid;
 const second={...first,feedback_id:'SECOND_SYNTHETIC',imdb_id:'tt999999992',feedback:''};
 input.source.tips.push(second);input.source.records.push({event:second,blob_oid:gitBlobOid(stableJson(second))});input.source.event_count=2;
 for(const inputProfile of Object.values(input.profiles))inputProfile.publicItems.push({...inputProfile.publicItems[0],imdb_id:second.imdb_id});
 input.packet.request_id=interpretationRequest(input.source).request_id;
 const before=JSON.parse(buildReceipt(input).files['scores/scifi.json']).items[first.imdb_id];
 assert.equal(before.execution_adjustment,null);assert.equal(before.learned,null);
 input.profiles.scifi.executionEvidence={[first.imdb_id]:{acting:1}};
 const after=JSON.parse(buildReceipt(input).files['scores/scifi.json']).items[first.imdb_id];
 assert(after.execution_adjustment>0);assert.notEqual(after.learned,null);assert.equal(after.baseline,before.baseline);
 input.profiles.scifi.executionEvidence[first.imdb_id].acting=0;
 assert.throws(()=>buildReceipt(input),/Invalid candidate execution evidence/);
});
