import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {aggregateLearning,validateAdapter,learningAdjustments,researchContext} from '../aggregate.mjs';
import {deriveSignals as legacy} from './fixtures/scifi-structured-reference.mjs';
import {resolveFeedback} from '../resolve-feedback.mjs';
import {normalizedTips} from '../interpretation.mjs';
const read=path=>JSON.parse(fs.readFileSync(new URL(path,import.meta.url),'utf8'));
const adapter=g=>read(`../config/${g}.json`),profile=g=>read(`./fixtures/${g}-policy.json`);
const event=(n,extra={})=>({schema_version:3,feedback_id:`synthetic-${n}`,supersedes:null,imdb_id:`tt99999999${n}`,source_id:null,status:'seen',rated_at:'2026-10-01T10:00:00Z',rating:4,premise_interest:null,liked:[],disliked:[],profile_context:null,...extra});
const normalize=tips=>tips.map(event=>({event,lineage:[]}));
test('six explicit adapters validate against independent public registries and guardrails',()=>{
 for(const genre of ['scifi','fantasy','action','anime','thriller','mystery'])validateAdapter(adapter(genre),profile(genre));
 const a=adapter('mystery');a.projectable.push('mystery_density');assert.throws(()=>validateAdapter(a,profile('mystery')),/non-projectable/);
});
test('structured Sci-Fi formulas exactly match the frozen implementation across v1/v2/v3 and scopes',()=>{
 const cases=[event(1,{schema_version:1,more_like_this:'yes',liked:['biology','rule_discovery'],disliked:['too_slow','not_enough_mystery']}),
  event(2,{schema_version:2,premise_interest:'no',liked:['experiments'],disliked:['horror']}),event(3,{profile_context:'scifi',liked:['acting','mystery'],disliked:['world_rules']}),
  event(4,{profile_context:'anime',liked:['mystery','acting','suspense','alien_unknown'],disliked:['military_focus']}),event(5,{profile_context:null,liked:['creature_threat','acting'],disliked:['horror']}),
  event(6,{imdb_id:null,liked:['acting']})];
 const publicItems=[1,2,3,4].map(n=>({imdb_id:`tt99999999${n}`,dna:{biology_genetics:9,mystery:8,rule_discovery:7,experiments:8,creature_threat:4,alien_unknown_life:null,unknown_phenomenon:9}}));
 for(const subset of [cases,cases.slice(0,1),cases.slice(0,2),cases.slice(2)]){
  const tips=resolveFeedback(subset),old=legacy({tips,publicItems}),now=aggregateLearning({normalized:normalize(tips),publicItems,adapter:adapter('scifi')});
  for(const [before,after] of [['contentPreferences','content'],['executionPreferences','execution'],['tonePreferences','tone']])assert.deepEqual(now[after].values,Object.fromEntries([...old[before]].sort()));
  assert.deepEqual(now.ratings,[...old.ratings].sort((a,b)=>a-b));assert.equal(now.content_evidence_titles,old.contentEvidenceTitles);assert.equal(now.execution_evidence_titles,old.executionEvidenceTitles);
 }
});
test('owned-ID and context boundaries do not leak another genre tone into Anime',()=>{
 const tips=[event(1,{profile_context:'scifi',liked:['horror','pacing','mystery']}),event(2,{profile_context:'anime',liked:['horror','pacing']})];
 const out=aggregateLearning({normalized:normalize(tips),publicItems:[{imdb_id:tips[0].imdb_id,dna:{horror:9,mystery:9}}],adapter:adapter('anime')});
 assert.deepEqual(out.tone.values,{});assert.deepEqual(out.content.values,{});assert.deepEqual(out.execution.values,{pacing:.3});assert.deepEqual(out.ratings,[]);
});
test('AI inference is capped below chips even after score normalization; shortage is positive preference',()=>{
 const e=event(1),a=adapter('scifi'),publicItems=[{imdb_id:e.imdb_id,dna:{mystery:10}}];
 const packet={interpretations:[{feedback_id:e.feedback_id,statements:[{category:'concept',aspect:'mystery',meaning:'wanted_more',confidence:'high'}]}]};
 const inferred=aggregateLearning({normalized:normalizedTips([e],packet),publicItems,adapter:a});
 const structured=aggregateLearning({normalized:normalize([{...e,liked:['mystery']}]),publicItems,adapter:a});
 const args={item:publicItems[0],profile:profile('scifi'),adapter:a};
 const before=learningAdjustments({...args,signals:structured}),after=learningAdjustments({...args,signals:inferred});
 assert(after.content_adjustment>0);assert(Math.abs(after.content_adjustment-before.content_adjustment*.3)<1e-12);
 assert(inferred.content.values.mystery<structured.content.values.mystery);
});

test('unrelated structured evidence cannot raise a mixed title inferred adjustment above its cap',()=>{
 const e=event(1,{liked:['creature_threat','acting']}),a=adapter('scifi');
 const item={imdb_id:e.imdb_id,dna:{creature_threat:0,experiments:10}};
 const packet={interpretations:[{feedback_id:e.feedback_id,statements:[{category:'concept',aspect:'experiments',meaning:'worked',confidence:'high'},
  {category:'execution',aspect:'dialogue',meaning:'worked',confidence:'high'}]}]};
 const inferred=aggregateLearning({normalized:normalizedTips([e],packet),publicItems:[item],adapter:a});
 const structured=aggregateLearning({normalized:normalize([{...e,liked:[...e.liked,'experiments','dialogue']}]),publicItems:[item],adapter:a});
 const args={item,profile:profile('scifi'),adapter:a,executionEvidence:{[e.imdb_id]:{dialogue:1}}};
 const x=learningAdjustments({...args,signals:inferred}),y=learningAdjustments({...args,signals:structured});
 assert(x.content_adjustment>0);assert(Math.abs(x.content_adjustment-y.content_adjustment*.3)<1e-12);
 assert(Math.abs(x.execution_adjustment-y.execution_adjustment*.3)<1e-12);
});
test('superseding and retracting recomputes rather than accumulating or resurrecting evidence',()=>{
 const original=event(1,{liked:['mystery']}),replacement=event(1,{feedback_id:'replacement',supersedes:original.feedback_id,liked:[],disliked:['mystery']});
 const tombstone={...replacement,feedback_id:'tombstone',supersedes:'replacement',status:'retracted',liked:[],disliked:[],rating:null};
 const args={publicItems:[{imdb_id:original.imdb_id,dna:{mystery:9}}],adapter:adapter('scifi')};
 const aggregate=events=>aggregateLearning({...args,normalized:normalize(resolveFeedback(events))});
 assert(aggregate([original]).content.values.mystery>0);assert(aggregate([original,replacement]).content.values.mystery<0);
 assert.deepEqual(aggregate([original,replacement,tombstone]).content.values,{});
});
test('null DNA never becomes zero; pacing never changes pace_speed; private context excludes personal fields',()=>{
 const e=event(1,{liked:['pacing','mystery'],disliked:['conspiracy']}),a=adapter('thriller');
 const signals=aggregateLearning({normalized:normalize([e]),publicItems:[{imdb_id:e.imdb_id,dna:{mystery:null}}],adapter:a});
 assert(!('pace_speed' in signals.content.values));
 assert.equal(learningAdjustments({item:{dna:{mystery:null}},signals,profile:profile('thriller'),adapter:a}).content_adjustment,null);
 const context=researchContext(signals,a),text=JSON.stringify(context);
 for(const secret of [e.feedback_id,e.imdb_id,'rated_at','rating','lineage','feedback'])assert(!text.includes(secret));
 assert(!context.preferences.some(p=>p.aspect==='conspiracy')); // single negative title is not a generalized aversion
});
