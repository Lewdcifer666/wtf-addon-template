import {digest,stableJson,interpretationRequest,validateInterpretation,normalizedTips} from './interpretation.mjs';
import {validateAdapter,validateExecutionEvidence,aggregateLearning,researchContext,learningAdjustments} from './aggregate.mjs';
import {makePolicy,scoreItem,baselineContentPre} from '../engine/dna-score.mjs';

export const GENRES=['action','anime','fantasy','mystery','scifi','thriller'];
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const clamp=value=>Math.min(Math.max(value,0),100);
export function validateActivation(activation){
  if(!activation||activation.schema_version!==1||typeof activation.research_learning_enabled!=='boolean'
    ||activation.public_catalog_personalization_enabled!==false||Object.keys(activation).sort().join()!=='public_catalog_personalization_enabled,research_learning_enabled,schema_version')throw Error('Unsupported learning activation policy');
  return activation;
}

// The caller supplies data loaded from pinned Git blobs, never imported code
// from the six addon repositories or from an interpretation branch.
export function buildReceipt({source,packet,packetCommit,trustedRevision,engineFingerprint,profiles,activation}){
  if(!sha(packetCommit)||!sha(trustedRevision)||!hash(engineFingerprint))throw Error('Unpinned learning engine or interpretation');
  if(Object.keys(profiles).sort().join('|')!==GENRES.join('|'))throw Error('All six pinned profile inputs are required');
  validateActivation(activation);
  const request=interpretationRequest(source);
  validateInterpretation(packet,{sourceRevision:source.source_revision,eventRecords:source.records,tips:source.tips,requestId:request.request_id});
  const normalized=normalizedTips(source.tips,packet),files={},profileSources={};
  const rawOid=new Map(source.records.map(r=>[r.event.feedback_id,r.blob_oid]));
  files['normalized-evidence.json']=stableJson(normalized.map(({event:e,lineage})=>({
    feedback_id:e.feedback_id,raw_blob_oid:rawOid.get(e.feedback_id),imdb_id:e.imdb_id,
    schema_version:e.schema_version,status:e.status,profile_context:e.profile_context??null,
    rating:e.rating??null,premise_interest:(e.schema_version===1?e.more_like_this:e.premise_interest)??null,
    liked:e.liked||[],disliked:e.disliked||[],interpreted_aspects:lineage
  })));
  for(const genre of GENRES){
    const input=profiles[genre],{profile,catalogs,publicItems,adapter,executionEvidence={}}=input;
    if(!sha(input.revision)||!hash(input.inventory_hash)||adapter.genre!==genre)throw Error('Unpinned or mismatched profile input');
    validateAdapter(adapter,profile);
    // Optional title-specific assessments are repository-owned public facts,
    // never inferred from a user's rating or execution preference. Absence
    // remains unknown; do not fabricate candidate quality to enable a score.
    validateExecutionEvidence(executionEvidence);
    const signals=aggregateLearning({normalized,publicItems,adapter}),context=researchContext(signals,adapter);
    files[`signals/${genre}.json`]=stableJson(signals);
    files[`research-context/${genre}.json`]=stableJson(context);
    const policy=makePolicy(profile),definition=catalogs.catalogs.find(d=>d.id==='dna-match');
    if(definition?.dna?.mode!=='baseline_profile')throw Error('Missing baseline research diagnostics policy');
    const scores={};
    for(const item of [...publicItems].sort((a,b)=>String(a.imdb_id).localeCompare(String(b.imdb_id),'en'))){
      if(item.status!=='watch'||!/^tt\d+$/.test(item.imdb_id))continue;
      const baseline=scoreItem(policy,definition,item,new Map()).score;
      if(baseline===null||baseline<profile.automation_rules.minimum_match_score)continue;
      const adjustments=learningAdjustments({item,signals,profile,adapter,executionEvidence});
      let personalized=null;
      if(signals.ratings.length>=2&&signals.content_evidence_titles>=1&&adjustments.content_adjustment!==null&&adjustments.execution_adjustment!==null){
        const content=baselineContentPre(policy,item,definition.dna.archetype_bonus_max).contentPre;
        const executionBase=signals.ratings.reduce((a,b)=>a+b,0)/signals.ratings.length*20;
        const pair={dna_match:Math.round(clamp(content+adjustments.content_adjustment)),execution_fit:Math.round(clamp(executionBase+adjustments.execution_adjustment))};
        personalized=scoreItem(policy,definition,item,new Map([[item.imdb_id,pair]])).score;
      }
      scores[item.imdb_id]={baseline,learned:personalized,...adjustments};
    }
    files[`scores/${genre}.json`]=stableJson({schema_version:1,purpose:'private_counterfactual_diagnostics',publication_scores_unchanged:true,items:scores});
    profileSources[genre]={revision:input.revision,inventory_hash:input.inventory_hash,adapter_hash:digest(stableJson(adapter))};
  }
  const sources={feedback_revision:source.source_revision,feedback_inventory_hash:source.inventory_hash,event_count:source.event_count,
    request_id:request.request_id,interpretation_commit:packetCommit,interpretation_hash:digest(stableJson(packet)),
    trusted_revision:trustedRevision,engine_fingerprint:engineFingerprint,profiles:profileSources,activation_hash:digest(stableJson(activation))};
  const outputHashes=Object.fromEntries(Object.keys(files).sort().map(path=>[path,digest(files[path])]));
  const identity={schema_version:1,sources,output_hashes:outputHashes};
  const stateDigest=digest(stableJson(identity));
  files['receipt.json']=stableJson({...identity,state_digest:stateDigest,research_learning_enabled:activation.research_learning_enabled});
  return {branch:`learning/receipt-${stateDigest}`,state_digest:stateDigest,files};
}

// Comparing immutable bytes also prevents an arbitrary branch with a plausible
// name from being mistaken for an engine-produced completed receipt.
export function verifyReceipt(actual,expected){
  if(Object.keys(actual).sort().join('|')!==Object.keys(expected.files).sort().join('|'))throw Error('Incomplete or unexpected receipt files');
  for(const [path,bytes] of Object.entries(expected.files))if(actual[path]!==bytes)throw Error('Immutable learning receipt differs');
  return true;
}
