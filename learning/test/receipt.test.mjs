import fs from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildReceipt,verifyReceipt,GENRES} from '../receipt.mjs';
import {interpretationRequest,gitBlobOid,stableJson} from '../interpretation.mjs';
const read=name=>JSON.parse(fs.readFileSync(new URL(name,import.meta.url),'utf8'));
function inputs(){
 const event={schema_version:3,feedback_id:'PRIVATE_SYNTHETIC_ID',imdb_id:'tt999999991',status:'seen',profile_context:null,rating:5,feedback:'PRIVATE_SENTINEL I want more mystery.',liked:[],disliked:[],premise_interest:null};
 const source={source_revision:'a'.repeat(40),inventory_hash:'b'.repeat(64),event_count:1,records:[{event,blob_oid:gitBlobOid(stableJson(event))}],tips:[event]};
 const request=interpretationRequest(source),packet={schema_version:1,source_revision:source.source_revision,request_id:request.request_id,interpretations:[{feedback_id:event.feedback_id,raw_blob_oid:source.records[0].blob_oid,status:'interpreted',statements:[{category:'concept',aspect:'mystery',meaning:'wanted_more',scope:'content_preference',quote:'I want more mystery',confidence:'high'}]}]};
 const profiles={};
 for(const genre of GENRES){
  const profile=read(`./fixtures/${genre}-policy.json`),dimension=genre==='mystery'?'central_mystery':'mystery';
  profile.dna_baseline={weights:{[dimension]:1},completeness_defaults:{min_known_dimensions:1,min_confidence:0,required_known_dimensions:[dimension]},archetypes:[]};
  profile.dna_guardrails={hard_exclusion:[],combination:[]};profile.automation_rules={minimum_match_score:10};
  profiles[genre]={revision:'c'.repeat(40),inventory_hash:'d'.repeat(64),profile,adapter:read(`../config/${genre}.json`),
   catalogs:{catalogs:[{id:'dna-match',min_score:0,dna:{mode:'baseline_profile',archetype_bonus_max:0}}]},
   publicItems:[{imdb_id:event.imdb_id,type:'movie',status:'watch',dna:{[dimension]:8},dna_confidence:1}]};
 }
 return {source,packet,profiles,packetCommit:'e'.repeat(40),trustedRevision:'f'.repeat(40),engineFingerprint:'a'.repeat(64),activation:{schema_version:1,research_learning_enabled:false,public_catalog_personalization_enabled:false}};
}
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
