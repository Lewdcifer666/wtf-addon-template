import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateInterpretation,normalizedTips,gitBlobOid,stableJson} from '../interpretation.mjs';
const revision='a'.repeat(40),requestId='c'.repeat(64);
const event={feedback_id:'synthetic-event',schema_version:3,status:'rated',imdb_id:'tt999999991',profile_context:null,feedback:'The pacing dragged, but I want more stories about experiments.',liked:[],disliked:['pacing'],rating:2,premise_interest:null};
const record={event,blob_oid:gitBlobOid(stableJson(event))};
const make=()=>({schema_version:1,source_revision:revision,request_id:requestId,interpretations:[{feedback_id:event.feedback_id,raw_blob_oid:record.blob_oid,status:'interpreted',statements:[
 {category:'execution',aspect:'pacing',meaning:'worked',scope:'title_execution',quote:'The pacing dragged',confidence:'high'},
 {category:'concept',aspect:'experiments',meaning:'wanted_more',scope:'content_preference',quote:'I want more stories about experiments',confidence:'high'},
]}]});
const inputs={sourceRevision:revision,requestId,eventRecords:[record],tips:[event]};
test('provenance-linked interpretation supplements but cannot override structured evidence',()=>{
 const packet=validateInterpretation(make(),inputs),before=stableJson(event),out=normalizedTips([event],packet)[0];
 assert.equal(stableJson(event),before);assert.deepEqual(out.event.disliked,['pacing']);assert.deepEqual(out.event.liked,[]);
 assert.equal(out.event.rating,2);assert.equal(out.event.premise_interest,null);assert.equal(out.event.imdb_id,event.imdb_id);
 assert.deepEqual(out.lineage,[{category:'concept',aspect:'experiments',side:'liked',meaning:'wanted_more',maximum_magnitude:0.3,source:'interpreted_free_text'}]);
});
test('incomplete, stale, fabricated or scored interpretations are refused',()=>{
 for(const alter of [p=>p.interpretations=[],p=>p.source_revision='b'.repeat(40),p=>p.score=90,p=>p.interpretations[0].raw_blob_oid='b'.repeat(40),p=>p.interpretations[0].statements[0].quote='not in the source',p=>p.interpretations[0].statements[0].scope='content_preference',p=>p.interpretations.push(p.interpretations[0]),p=>p.interpretations[0].statements[0].weight=20]){
  const packet=make();alter(packet);assert.throws(()=>validateInterpretation(packet,inputs),/Interpretation rejected/);
 }
});
test('uncertainty is retained privately but does not become a learned contribution',()=>{
 const packet=make();packet.interpretations[0].statements[1].confidence='medium';
 assert.deepEqual(normalizedTips([event],validateInterpretation(packet,inputs))[0].lineage,[]);
});
test('retracted and superseded events never require an interpretation or contribute',()=>{
 const tombstone={...event,feedback_id:'synthetic-retraction',status:'retracted',feedback:null,liked:[],disliked:[]};
 const packet={schema_version:1,source_revision:revision,request_id:requestId,interpretations:[]};
 validateInterpretation(packet,{...inputs,tips:[tombstone]});
 assert.deepEqual(normalizedTips([tombstone],make())[0].lineage,[]);
 assert.throws(()=>validateInterpretation(make(),{...inputs,tips:[tombstone]}),/unexpected/);
});
