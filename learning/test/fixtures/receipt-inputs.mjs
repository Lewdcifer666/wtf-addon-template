import fs from 'node:fs';
import {GENRES} from '../../receipt.mjs';
import {interpretationRequest,gitBlobOid,stableJson} from '../../interpretation.mjs';
const read=name=>JSON.parse(fs.readFileSync(new URL(name,import.meta.url),'utf8'));
export function receiptInputs(){
 const event={schema_version:3,feedback_id:'PRIVATE_SYNTHETIC_ID',imdb_id:'tt999999991',status:'seen',profile_context:null,rating:5,feedback:'PRIVATE_SENTINEL I want more mystery.',liked:[],disliked:[],premise_interest:null};
 const source={source_revision:'a'.repeat(40),inventory_hash:'b'.repeat(64),event_count:1,records:[{event,blob_oid:gitBlobOid(stableJson(event))}],tips:[event]};
 const request=interpretationRequest(source),packet={schema_version:1,source_revision:source.source_revision,request_id:request.request_id,interpretations:[{feedback_id:event.feedback_id,raw_blob_oid:source.records[0].blob_oid,status:'interpreted',statements:[{category:'concept',aspect:'mystery',meaning:'wanted_more',scope:'content_preference',quote:'I want more mystery',confidence:'high'}]}]};
 const profiles={};
 for(const genre of GENRES){
  const profile=read(`./${genre}-policy.json`),dimension=genre==='mystery'?'central_mystery':'mystery';
  profile.dna_baseline={weights:{[dimension]:1},completeness_defaults:{min_known_dimensions:1,min_confidence:0,required_known_dimensions:[dimension]},archetypes:[]};
  profile.dna_guardrails={hard_exclusion:[],combination:[]};profile.automation_rules={minimum_match_score:10};
  profiles[genre]={revision:'c'.repeat(40),inventory_hash:'d'.repeat(64),profile,adapter:read(`../../config/${genre}.json`),
   catalogs:{catalogs:[{id:'dna-match',min_score:0,dna:{mode:'baseline_profile',archetype_bonus_max:0}}]},
   publicItems:[{imdb_id:event.imdb_id,type:'movie',status:'watch',dna:{[dimension]:8},dna_confidence:1}]};
 }
 return {source,packet,profiles,packetCommit:'e'.repeat(40),trustedRevision:'f'.repeat(40),engineFingerprint:'a'.repeat(64),activation:{schema_version:1,research_learning_enabled:false,public_catalog_personalization_enabled:false}};
}
