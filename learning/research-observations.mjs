import {buildReceipt,GENRES} from './receipt.mjs';
import {loadVerifiedReceipt} from './receipt-loader.mjs';
import {prepareResearchUse} from './research-use.mjs';
import {authenticateResearchCommit} from './research-commit.mjs';
import {createResearchValidator} from './research-contract.mjs';
import {digest,gitBlobOid,stableJson} from './interpretation.mjs';
import {LearningError,readImmutable,persistImmutable,failureArtifact,requireTrustedAncestor} from './git-artifacts.mjs';

const fail=()=>{throw new LearningError('invalid_research_observation');};
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const validDate=value=>typeof value==='string'&&/^20\d\d-\d\d-\d\d$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;

// Read a bounded data blob to discover its claimed binding. This is not an
// attestation: callers must recompute every receipt/handoff byte afterward.
async function artifactJson(api,ref,name){
 if(!sha(ref?.object?.sha))fail();
 const commit=await api.get(`/git/commits/${ref.object.sha}`);
 if(commit?.sha!==ref.object.sha||commit.parents?.length!==1||!sha(commit.parents[0].sha)||!sha(commit.tree?.sha))fail();
 const tree=await api.get(`/git/trees/${commit.tree.sha}?recursive=1`);
 if(tree?.sha!==commit.tree.sha||tree.truncated!==false||!Array.isArray(tree.tree))fail();
 const entry=tree.tree.find(e=>e.path===`learning-output/${name}`);
 if(entry?.type!=='blob'||entry.mode!=='100644'||!sha(entry.sha)||!Number.isSafeInteger(entry.size)||entry.size<1||entry.size>1024*1024)fail();
 const blob=await api.get(`/git/blobs/${entry.sha}`);
 if(blob?.encoding!=='base64'||blob.size!==entry.size)fail();
 const bytes=Buffer.from(blob.content,'base64');
 if(bytes.length!==entry.size||gitBlobOid(bytes)!==entry.sha||!Buffer.from(bytes.toString('utf8')).equals(bytes))fail();
 return {commit,parent:commit.parents[0].sha,value:JSON.parse(bytes.toString('utf8'))};
}

// The immutable handoff refs are the durable queue. Publication can advance
// public main and new feedback can advance private main before this collector
// runs. Recover using the ORIGINAL complete source tuple, as historical data,
// never as current taste evidence or a renewed snapshot. All derived content
// remains private. No AI interpretation, research packet or main is written.
export async function collectResearchObservations({api,publicApis,base,activation,engineFingerprint,loadInputs,assertCurrent,researchDate}){
 if(activation.research_learning_enabled!==true)return {state:'inactive',observations:[]};
 if(typeof loadInputs!=='function'||typeof assertCurrent!=='function'||!validDate(researchDate))fail();
 const metadata=await api.get('/');
 if(api.repository!=='Lewdcifer666/wtf-scifi-feedback'||metadata.full_name!==api.repository||metadata.private!==true||metadata.default_branch!=='main')fail();
 const refs=await api.get('/git/matching-refs/heads/learning/handoff-');
 if(!Array.isArray(refs)||refs.length>10000||new Set(refs.map(r=>r.ref)).size!==refs.length)fail();
 const observations=[];
 for(const ref of [...refs].sort((a,b)=>a.ref.localeCompare(b.ref,'en'))){
  if(!/^refs\/heads\/learning\/handoff-[a-f0-9]{64}$/.test(ref.ref))fail();
  let packetCommit=null,sourceRevision=base.sha;
  try{
   await assertCurrent();
   const raw=await artifactJson(api,ref,'handoff.json'),issued=raw.value;
   if(!GENRES.includes(issued.genre)||!validDate(issued.research_date)||issued.research_date>researchDate||!hash(issued.use_id)||ref.ref!==`refs/heads/learning/handoff-${issued.use_id}`||!sha(issued.receipt_commit)||!sha(issued.source_heads?.private)||issued.source_heads.private!==raw.parent)fail();
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
   const trace=await authenticateResearchCommit({api:publicApi,issued,inputs,artifact,researchDate:issued.research_date,commit:packetCommit,
    validatePacket:createResearchValidator(inputs.profiles[issued.genre],{now:Date.parse(researchDate+'T12:00:00Z')}),assertCurrent,historical:true});
   const body={schema_version:1,kind:'private_historical_research_observation',handoff_commit:handoff.commit,observer_engine_fingerprint:engineFingerprint,
    current_evidence:false,actual_context_use_verified:false,behavioral_effect_observed:false,trace};
   const observationId=digest(stableJson(body));
   const stored=await persistImmutable(api,{base:historicalBase,branch:`learning/observation-${observationId}`,files:{'observation.json':stableJson(body)},assertCurrent});
   await assertCurrent();
   if((await api.get(`/git/ref/heads/${handoff.branch}`)).object?.sha!==handoff.commit||(await publicApi.get(`/git/ref/heads/${researchBranch}`)).object?.sha!==packetCommit)throw new LearningError('stale_input');
   observations.push({handoff_commit:handoff.commit,state:'diagnostics_recorded',branch:stored.branch,commit:stored.commit});
  }catch(error){
   if(error.code==='stale_input')throw error;
   await persistImmutable(api,{base,...failureArtifact({packetCommit:ref.object.sha,sourceRevision,evaluatedBase:base.sha,engineFingerprint,code:'invalid_research_observation'}),assertCurrent});
   observations.push({handoff_commit:ref.object.sha,state:'verification_failed',code:'invalid_research_observation'});
  }
 }
 await assertCurrent();
 if(observations.some(o=>o.state==='verification_failed'))throw new LearningError('invalid_research_observation');
 return {state:'collected',observations};
}
