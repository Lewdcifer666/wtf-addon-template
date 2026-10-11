// Pure private-learning packet validation. User free text is evidence, never
// instructions. This module emits no logs and never mutates captured records.
import crypto from 'node:crypto';
import fs from 'node:fs';
import Ajv from 'ajv';
const validateSchema=new Ajv({strict:true,allErrors:false}).compile(JSON.parse(fs.readFileSync(new URL('./schemas/feedback-interpretation.schema.json',import.meta.url),'utf8')));
export const INTERPRETATION_VERSION = 1;
export const ASPECTS = Object.freeze({
  execution: ['acting','characters','dialogue','pacing','visuals','effects','ending_payoff','sound_music','originality'],
  tone: ['suspense','horror','action','humor','survival_chase','military_focus'],
  concept: ['mystery','science_biology','alien_unknown','scientific_investigation','world_rules','concept_escalation','weirdness','reality_time_anomaly','mind_consciousness','experiments','conspiracy','creature_threat','premise_concept'],
});
const LEGACY = {
  liked: {biology:'science_biology',rule_discovery:'world_rules',impossible_system:'world_rules',fast_pacing:'pacing',great_payoff:'ending_payoff',time_reality:'reality_time_anomaly'},
  disliked: {too_slow:'pacing',boring_middle:'pacing',too_much_action:'action',too_much_horror:'horror',psychological_horror:'horror',weak_payoff:'ending_payoff',monster_chase:'survival_chase',weak_characters:'characters'},
};
const fail=message=>{throw Error(`Interpretation rejected: ${message}`);};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>{if(!object(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail('closed object shape');};
export const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export const gitBlobOid=bytes=>crypto.createHash('sha1').update(`blob ${Buffer.byteLength(bytes)}\0`).update(bytes).digest('hex');
export const stableJson=value=>JSON.stringify(value,null,2)+'\n';
export function interpretationRequest({source_revision,inventory_hash,records,tips}){
  const byId=new Map(records.map(r=>[r.event.feedback_id,r]));
  const required=tips.filter(e=>e.status!=='retracted'&&typeof e.feedback==='string'&&e.feedback.trim())
    .map(e=>({feedback_id:e.feedback_id,raw_blob_oid:byId.get(e.feedback_id)?.blob_oid}));
  const identity={schema_version:INTERPRETATION_VERSION,source_revision,inventory_hash,required};
  return {...identity,request_id:digest(stableJson(identity))};
}
export function canonicalAspect(raw,side,version){
  if(Object.values(ASPECTS).some(a=>a.includes(raw)))return raw;
  return version===1 ? LEGACY[side]?.[raw]||null : null;
}
// eventRecords are produced from a complete, revision-pinned Git inventory by
// trusted code, not chosen by the AI. Every entry carries its original blob OID.
export function validateInterpretation(packet,{sourceRevision,eventRecords,tips,requestId}){
  if(!validateSchema(packet))fail('closed schema');
  exact(packet,['schema_version','source_revision','request_id','interpretations']);
  if(packet.schema_version!==INTERPRETATION_VERSION||packet.source_revision!==sourceRevision||!/^[a-f0-9]{40}$/.test(sourceRevision))fail('source revision');
  if(!/^[a-f0-9]{64}$/.test(requestId)||packet.request_id!==requestId)fail('request identity');
  if(!Array.isArray(packet.interpretations)||packet.interpretations.length>10000)fail('interpretation list');
  const required=tips.filter(e=>e.status!=='retracted'&&typeof e.feedback==='string'&&e.feedback.trim());
  const records=new Map(eventRecords.map(r=>[r.event.feedback_id,r]));
  const needed=new Map(required.map(e=>[e.feedback_id,e])),seen=new Set();
  for(const item of packet.interpretations){
    exact(item,['feedback_id','raw_blob_oid','status','statements']);
    if(typeof item.feedback_id!=='string'||seen.has(item.feedback_id)||!needed.has(item.feedback_id))fail('unexpected or duplicate event');
    seen.add(item.feedback_id);const record=records.get(item.feedback_id),event=needed.get(item.feedback_id);
    if(!record||item.raw_blob_oid!==record.blob_oid||!/^[a-f0-9]{40}$/.test(item.raw_blob_oid))fail('raw provenance');
    if(!['interpreted','ambiguous','no_signal'].includes(item.status)||!Array.isArray(item.statements)||item.statements.length>32)fail('status or statements');
    if((item.status==='interpreted')!==(item.statements.length>0))fail('status disagreement');
    const unique=new Set();
    for(const statement of item.statements){
      exact(statement,['category','aspect','meaning','scope','quote','confidence']);
      if(!ASPECTS[statement.category]?.includes(statement.aspect))fail('unknown aspect');
      if(!['worked','did_not_work','wanted_more','wanted_less','uncertain'].includes(statement.meaning))fail('meaning');
      if(!['title_execution','content_preference','tone_preference'].includes(statement.scope))fail('scope');
      const expected={execution:'title_execution',concept:'content_preference',tone:'tone_preference'}[statement.category];
      if(statement.scope!==expected)fail('category/scope disagreement');
      if(typeof statement.quote!=='string'||statement.quote.trim().length<3||statement.quote.length>2000||!event.feedback.includes(statement.quote))fail('quote not in pinned raw text');
      if(!['high','medium','low'].includes(statement.confidence))fail('confidence');
      const key=`${statement.category}:${statement.aspect}`;if(unique.has(key))fail('duplicate aspect');unique.add(key);
    }
  }
  if(seen.size!==needed.size)fail('incomplete current free-text interpretation');
  return packet;
}
// Structured chips always win over free-text interpretation for the same
// aspect, regardless of polarity. Interpretation cannot infer a numeric rating,
// premise-interest answer, IMDb identity, catalog origin, DNF or watched status.
export function normalizedTips(tips,packet){
  const interpreted=new Map(packet.interpretations.map(i=>[i.feedback_id,i]));
  return tips.map(event=>{
    const derived=structuredClone(event),lineage=[];
    const occupied=new Set(['liked','disliked'].flatMap(side=>(event[side]||[]).map(raw=>canonicalAspect(raw,side,event.schema_version)).filter(Boolean)));
    if(event.status!=='retracted')for(const statement of interpreted.get(event.feedback_id)?.statements||[]){
      if(statement.confidence!=='high'||statement.meaning==='uncertain'||occupied.has(statement.aspect))continue;
      const side=['worked','wanted_more'].includes(statement.meaning)?'liked':'disliked';
      occupied.add(statement.aspect);
      // Keep inference separate from captured chips. Giving it a chip would
      // silently promote weak inferred evidence to full structured strength.
      lineage.push({category:statement.category,aspect:statement.aspect,side,
        meaning:statement.meaning,maximum_magnitude:0.3,source:'interpreted_free_text'});
    }
    return {event:derived,lineage};
  });
}
