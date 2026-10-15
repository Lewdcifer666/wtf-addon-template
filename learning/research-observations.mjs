import {buildReceipt,GENRES} from './receipt.mjs';
import {loadVerifiedReceipt} from './receipt-loader.mjs';
import {prepareResearchUse} from './research-use.mjs';
import {authenticateResearchCommit} from './research-commit.mjs';
import {createResearchValidator} from './research-contract.mjs';
import {digest,stableJson} from './interpretation.mjs';
import {LearningError,readImmutable,persistImmutable,failureArtifact,requireTrustedAncestor,readArtifactJson as artifactJson} from './git-artifacts.mjs';
import {readHandoffIssuance} from './handoff-issuance.mjs';
import {loadObservationIndex,saveObservationIndex,selectObservationBatch} from './observation-index.mjs';
import {readResearchSessionJournal,describeResearchSession,loadSessionJournalHeads,sessionJournalHeadsHash} from './session-journal.mjs';

const fail=()=>{throw new LearningError('invalid_research_observation');};
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const validDate=value=>typeof value==='string'&&/^20\d\d-\d\d-\d\d$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;

// The immutable handoff refs are the durable queue. Publication can advance
// public main and new feedback can advance private main before this collector
// runs. Recover using the ORIGINAL complete source tuple, as historical data,
// never as current taste evidence or a renewed snapshot. All derived content
// remains private. No AI interpretation, research packet or main is written.
export async function collectResearchObservations({api,publicApis,proof,base,activation,engineFingerprint,loadInputs,assertCurrent,researchDate,clock=()=>new Date(),budget=6}){
 if(activation.research_learning_enabled!==true)return {state:'inactive',observations:[]};
 if(typeof loadInputs!=='function'||typeof assertCurrent!=='function'||!validDate(researchDate))fail();
 const metadata=await api.get('/');
 if(api.repository!=='Lewdcifer666/wtf-scifi-feedback'||metadata.full_name!==api.repository||metadata.private!==true||metadata.default_branch!=='main')fail();
 const refs=await api.get('/git/matching-refs/heads/learning/handoff-');
 if(!Array.isArray(refs)||new Set(refs.map(r=>r.ref)).size!==refs.length||!refs.every(r=>sha(r.object?.sha)))fail();
 const aliases=await api.get('/git/matching-refs/heads/learning/queue-');if(!Array.isArray(aliases))fail();
 const periods=new Map();
 for(const ref of aliases){const m=/^refs\/heads\/learning\/queue-(20\d\d-(?:0[1-9]|1[0-2]))-([a-f0-9]{64})$/.exec(ref.ref);if(!m||!sha(ref.object?.sha))fail();if(periods.has(ref.object.sha)&&periods.get(ref.object.sha)!==m[1])fail();periods.set(ref.object.sha,m[1]);}
 const groups=new Map();for(const ref of refs){const period=periods.get(ref.object.sha)||'legacy';if(!groups.has(period))groups.set(period,[]);groups.get(period).push(ref);}
 const currentPeriod=researchDate.slice(0,7),older=[...groups.keys()].filter(p=>p!==currentPeriod&&p!=='legacy').sort();
 const selected=[...(groups.has(currentPeriod)?[currentPeriod]:[]),...(older.length?[older[Math.floor(+clock()/3600000)%older.length]]:[]),...(groups.has('legacy')?['legacy']:[])];
 const publicRefs=new Map();
 for(const genre of GENRES){const result=await publicApis[genre].get('/git/matching-refs/heads/research/');if(!Array.isArray(result))fail();for(const ref of result){if(!sha(ref.object?.sha))fail();publicRefs.set(genre+':'+ref.ref,ref.object.sha);}}
 const outputRefs=await api.get('/git/matching-refs/heads/learning/observation-');if(!Array.isArray(outputRefs))fail();
 const observationHeads=new Map(outputRefs.map(r=>[r.ref.slice('refs/heads/'.length),r.object?.sha]));
 let journalHeads;
 try{journalHeads=await loadSessionJournalHeads(api);}
 catch(error){
  if(error.code!=='invalid_session_journal')throw error;
  await persistImmutable(api,{base,...failureArtifact({packetCommit:null,sourceRevision:base.sha,evaluatedBase:base.sha,engineFingerprint,code:'invalid_research_observation'}),assertCurrent});
  throw new LearningError('invalid_research_observation');
 }
 const journalMatches=entry=>entry.state==='ordering_unproven'||(hash(entry.session_id)&&hash(entry.journal_heads_hash)
  &&entry.journal_heads_hash===(journalHeads.get(entry.session_id)||sessionJournalHeadsHash(null)));
 const allObservations=[];let inspected=0,deferred=0;
 for(const [position,period] of selected.entries()){
 const periodBudget=Math.floor(budget/selected.length)+(position<budget%selected.length?1:0);if(periodBudget===0)continue;
 const scopedRefs=groups.get(period),previous=await loadObservationIndex({api,base,proof,assertCurrent,period}),index=previous.index;
 const completed=new Map(index.completed.map(e=>[e.handoff_commit+':'+e.research_commit,e]));
 const reusable=index.completed.filter(e=>publicRefs.get(e.genre+':refs/heads/research/'+e.research_date+'-'+e.genre)===e.research_commit
   &&(e.state==='ordering_unproven'||observationHeads.get(e.branch)===e.commit)&&journalMatches(e));
 const done=new Set(reusable.map(e=>e.handoff_commit));
 const observations=reusable.filter(e=>scopedRefs.some(r=>r.object.sha===e.handoff_commit)).map(({genre,research_date,research_commit,session_id,journal_heads_hash,...entry})=>entry);
 const pending=scopedRefs.filter(r=>!done.has(r.object.sha));
 const batch=selectObservationBatch(pending,index,{clock,budget:periodBudget,rebuilding:previous.key_reverification_required});
 let cursor=index.cursor;
 for(const ref of batch){
  if(!/^refs\/heads\/learning\/handoff-[a-f0-9]{64}$/.test(ref.ref))fail();
  let packetCommit=null,sourceRevision=base.sha;
  try{
   await assertCurrent();
   const raw=await artifactJson(api,ref,'handoff.json'),issued=raw.value;
   if(!GENRES.includes(issued.genre)||!validDate(issued.research_date)||issued.research_date>researchDate||!hash(issued.use_id)||ref.ref!==`refs/heads/learning/handoff-${issued.use_id}`||!sha(issued.receipt_commit)||!sha(issued.source_heads?.private)||issued.source_heads.private!==raw.parent)fail();
   if(period!=='legacy'&&(issued.research_date.slice(0,7)!==period||!aliases.some(a=>a.ref===`refs/heads/learning/queue-${period}-${issued.use_id}`&&a.object.sha===raw.commit.sha)))fail();
   sourceRevision=raw.parent;
   await requireTrustedAncestor(api,sourceRevision,base.sha);
   const historicalBase=await api.get(`/git/commits/${sourceRevision}`);
   if(historicalBase?.sha!==sourceRevision)fail();
   if(!/^learning\/receipt-[a-f0-9]{64}$/.test(issued.receipt_branch))fail();
   const receiptRef=await api.get(`/git/ref/heads/${issued.receipt_branch}`);
   if(receiptRef?.object?.sha!==issued.receipt_commit)fail();
   const rawReceipt=await artifactJson(api,receiptRef,'receipt.json');
   if(rawReceipt.parent!==sourceRevision||rawReceipt.value.sources?.feedback_revision!==sourceRevision)fail();
   const inputs=await loadInputs({base:historicalBase,receipt:rawReceipt.value});
   const expected=buildReceipt(inputs),artifact=await loadVerifiedReceipt({api,base:historicalBase,expected,assertCurrent});
   const recomputed=prepareResearchUse({inputs,artifact,genre:issued.genre,researchDate:issued.research_date});
   if(stableJson(issued)!==stableJson(recomputed))fail();
   const handoff=await readImmutable(api,{base:historicalBase,branch:ref.ref.slice('refs/heads/'.length),files:{'handoff.json':stableJson(recomputed)}});
   if(handoff?.commit!==raw.commit.sha)fail();
   const publicApi=publicApis[issued.genre],researchBranch=`research/${issued.research_date}-${issued.genre}`;
   const researchRef=await publicApi.optional(`/git/ref/heads/${researchBranch}`);
   if(!researchRef){observations.push({handoff_commit:handoff.commit,state:'awaiting_research_packet'});continue;}
   packetCommit=researchRef.object?.sha;
   if(!sha(packetCommit))fail();
   if(packetCommit===issued.source_heads.public[issued.genre]){observations.push({handoff_commit:handoff.commit,state:'awaiting_research_packet'});continue;}
   const researchCommit=await publicApi.get(`/git/commits/${packetCommit}`);
   if(researchCommit?.sha!==packetCommit||researchCommit.parents?.length!==1)fail();
   // A new receipt may be issued AFTER the day's research. Its existence is
   // not a claim that the earlier packet used it; never relabel that research.
   if(researchCommit.parents[0].sha!==issued.source_heads.public[issued.genre]){observations.push({handoff_commit:handoff.commit,state:'research_not_bound_to_handoff'});continue;}
   let issuance;
   try{issuance=await readHandoffIssuance({api,proof,base:historicalBase,issued,handoff,assertCurrent});}
   catch(error){
    if(!['handoff_issuance_missing','proof_key_unavailable'].includes(error.code))throw error;
    const entry={handoff_commit:handoff.commit,research_commit:packetCommit,genre:issued.genre,research_date:issued.research_date,state:'ordering_unproven',branch:null,commit:null};
    // Missing ordering evidence is terminal for THIS immutable packet. It is
    // not a claim of context use, and no late certificate may manufacture it.
    if(error.code==='handoff_issuance_missing')completed.set(handoff.commit+':'+packetCommit,entry);
    observations.push({handoff_commit:handoff.commit,state:error.code==='proof_key_unavailable'?'ordering_verification_pending':'ordering_unproven',branch:null,commit:null});continue;
   }
   const trace=await authenticateResearchCommit({api:publicApi,issued,inputs,artifact,researchDate:issued.research_date,commit:packetCommit,
    validatePacket:createResearchValidator(inputs.profiles[issued.genre],{now:Date.parse(researchDate+'T12:00:00Z')}),assertCurrent,historical:true});
   let journal;
   try{journal=await readResearchSessionJournal({api,base:historicalBase,issued,handoffCommit:handoff.commit,issuanceCommit:issuance.commit,proof,assertCurrent});}
   catch(error){
    if(error.code!=='proof_key_unavailable')throw error;
    observations.push({handoff_commit:handoff.commit,state:'session_verification_pending',branch:null,commit:null});continue;
   }
   const body={schema_version:journal?2:1,kind:'private_historical_research_observation',handoff_commit:handoff.commit,issuance_commit:issuance.commit,observer_engine_fingerprint:engineFingerprint,
    current_evidence:false,actual_context_use_verified:false,behavioral_effect_observed:false,trace,...(journal?{session_journal:journal}:{})};
   const observationId=digest(stableJson(body));
   const stored=await persistImmutable(api,{base:historicalBase,branch:`learning/observation-${observationId}`,files:{'observation.json':stableJson(body)},assertCurrent});
   await assertCurrent();
   if((await api.get(`/git/ref/heads/${handoff.branch}`)).object?.sha!==handoff.commit||(await publicApi.get(`/git/ref/heads/${researchBranch}`)).object?.sha!==packetCommit)throw new LearningError('stale_input');
   observations.push({handoff_commit:handoff.commit,state:'diagnostics_recorded',branch:stored.branch,commit:stored.commit});
   observationHeads.set(stored.branch,stored.commit);
   const sessionId=describeResearchSession({issued,handoffCommit:handoff.commit,issuanceCommit:issuance.commit}).session_id;
   completed.set(handoff.commit+':'+packetCommit,{handoff_commit:handoff.commit,research_commit:packetCommit,genre:issued.genre,research_date:issued.research_date,state:'diagnostics_recorded',branch:stored.branch,commit:stored.commit,
    session_id:sessionId,journal_heads_hash:sessionJournalHeadsHash(journal)});
  }catch(error){
   if(error.code==='stale_input')throw error;
   await persistImmutable(api,{base,...failureArtifact({packetCommit:ref.object.sha,sourceRevision,evaluatedBase:base.sha,engineFingerprint,code:'invalid_research_observation'}),assertCurrent});
   observations.push({handoff_commit:ref.object.sha,state:'verification_failed',code:'invalid_research_observation'});
  }finally{
   cursor=ref.object.sha;
  }
 }
 await assertCurrent();
 const terminal=new Set([...completed.values()].filter(e=>publicRefs.get(e.genre+':refs/heads/research/'+e.research_date+'-'+e.genre)===e.research_commit
   &&(e.state==='ordering_unproven'||observationHeads.get(e.branch)===e.commit)&&journalMatches(e)).map(e=>e.handoff_commit));
 if(scopedRefs.filter(r=>!terminal.has(r.object.sha)).length<=periodBudget)cursor=null;
 await saveObservationIndex({api,base,proof,previous,index:{...index,cursor,known_handoffs:scopedRefs.map(r=>r.object.sha),completed:[...completed.values()]},assertCurrent});
 if(observations.some(o=>o.state==='verification_failed'))throw new LearningError('invalid_research_observation');
 allObservations.push(...observations);inspected+=scopedRefs.length;deferred+=Math.max(0,pending.length-batch.length);
 }
 return {state:'collected',observations:allObservations.sort((a,b)=>a.handoff_commit.localeCompare(b.handoff_commit,'en')),deferred:deferred+refs.length-inspected};
}
