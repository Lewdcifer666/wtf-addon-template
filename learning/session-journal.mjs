// Historical PRIVATE evidence only. Signed session/search records are never
// accepted as current taste, proof that an AI received a brief, or causal effect.
// This reader has no writer, workflow dispatch, search provider, or raw feedback.
import fs from 'node:fs';
import Ajv from 'ajv';
import {digest,stableJson} from './interpretation.mjs';
import {LearningError,readArtifactJson,readImmutable} from './git-artifacts.mjs';

const validateObservation=new Ajv({strict:true,allErrors:false}).compile(JSON.parse(fs.readFileSync(new URL('./schemas/research-search-observation.schema.json',import.meta.url),'utf8')));
const fail=()=>{throw new LearningError('invalid_session_journal');};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...keys].sort().join('|');
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);

// Description is pure formatting, NOT authentication. Writers still require an
// opaque verified session; readers authenticate the original handoff and these
// GitHub-main-signed records against its recomputed complete source tuple.
export function describeResearchSession({issued,handoffCommit,issuanceCommit}){
 const request={schema_version:1,genre:issued.genre,research_date:issued.research_date,
  private_revision:issued.source_heads.private,public_revision:issued.source_heads.public[issued.genre]};
 const binding={schema_version:1,kind:'private_research_session',request,
  handoff_commit:handoffCommit,issuance_commit:issuanceCommit,issued};
 const session_id=digest(stableJson(binding));
 const response={schema_version:1,kind:'private_research_context_response',session_id,
  genre:issued.genre,research_date:issued.research_date,handoff_commit:handoffCommit,issuance_commit:issuanceCommit,
  use_id:issued.use_id,receipt_commit:issued.receipt_commit,source_heads:issued.source_heads,
  context_hash:issued.context_hash,context:issued.context};
 return {session_id,binding,response};
}

export const sessionContextBody=response=>({schema_version:1,kind:'private_research_context_prepared',
 packet_absence_checked:true,response});
export const sessionSearchBody=(search_id,observation)=>({schema_version:1,kind:'private_research_search_record',
 packet_absence_checked:true,session_id:observation.session_id,search_id,observation});

export const sessionJournalHeadsHash=journal=>digest(stableJson({context:journal?.context_commit??null,
 searches:(journal?.searches||[]).map(s=>[s.search_id,s.commit]).sort((a,b)=>a[0].localeCompare(b[0],'en'))}));

// Metadata alone may invalidate a completed observation, but can never mark it
// complete. Only the sealed index produced after full record verification can
// do that. Late refs/interrupted writers therefore reopen the bounded queue.
export async function loadSessionJournalHeads(api){
 const contexts=await api.get('/git/matching-refs/heads/learning/session-');
 const searches=await api.get('/git/matching-refs/heads/learning/search-');
 if(!Array.isArray(contexts)||!Array.isArray(searches))fail();
 const journals=new Map(),seen=new Set();
 const journal=id=>{if(!journals.has(id))journals.set(id,{context_commit:null,searches:[]});return journals.get(id);};
 for(const ref of contexts){
  const match=/^refs\/heads\/learning\/session-([a-f0-9]{64})$/.exec(ref?.ref);
  if(!match||!sha(ref.object?.sha)||seen.has(ref.ref))fail();seen.add(ref.ref);
  journal(match[1]).context_commit=ref.object.sha;
 }
 for(const ref of searches){
  const match=/^refs\/heads\/learning\/search-([a-f0-9]{64})-([a-f0-9]{64})$/.exec(ref?.ref);
  if(!match||!sha(ref.object?.sha)||seen.has(ref.ref))fail();seen.add(ref.ref);
  journal(match[1]).searches.push({search_id:match[2],commit:ref.object.sha});
 }
 return new Map([...journals].map(([id,value])=>[id,sessionJournalHeadsHash(value)]));
}

export function validateSessionSearch(observation,response){
 if(!validateObservation(observation)||observation.session_id!==response.session_id
  ||observation.use_id!==response.use_id||observation.context_hash!==response.context_hash
  ||!observation.query.trim()||Buffer.from(observation.query,'utf8').toString('utf8')!==observation.query
  ||observation.preference_indexes.some((index,position,list)=>index>=response.context.preferences.length||(position>0&&list[position-1]>=index)))fail();
 for(const source of observation.sources){
  let url;try{url=new URL(source.url);}catch{fail();}
  if(url.protocol!=='https:'||url.username||url.password||!url.hostname.includes('.'))fail();
 }
 return observation;
}

export async function readSealedSessionRecord({api,base,branch,name,proof,assertCurrent,expectedBody=null,ref=null}){
 if(typeof assertCurrent!=='function'||typeof proof?.verify!=='function')fail();
 ref??=await api.optional(`/git/ref/heads/${branch}`);
 if(!ref)return null;
 const raw=await readArtifactJson(api,ref,name,{maxBytes:1024*1024}),record=raw.value;
 if(raw.parent!==base.sha||!exact(record,['body','proof'])||(expectedBody!==null&&stableJson(record.body)!==stableJson(expectedBody)))fail();
 await proof.verify(record.proof,record.body,base.sha);
 const graph=await readImmutable(api,{base,branch,files:{[name]:stableJson(record)}});
 if(graph?.commit!==raw.commit.sha)fail();
 await assertCurrent();
 return {commit:raw.commit.sha,branch,body:record.body};
}

export async function loadSessionSearchRefs(api,session_id){
 if(typeof session_id!=='string'||!/^[a-f0-9]{64}$/.test(session_id))fail();
 const prefix=`refs/heads/learning/search-${session_id}-`;
 const refs=await api.get(`/git/matching-refs/heads/learning/search-${session_id}-`);
 if(!Array.isArray(refs)||refs.length>100
  ||refs.some(r=>!r||typeof r.ref!=='string'||!r.ref.startsWith(prefix)||!/^[a-f0-9]{64}$/.test(r.ref.slice(prefix.length))||!sha(r.object?.sha))
  ||new Set(refs.map(r=>r.ref)).size!==refs.length)fail();
 return refs;
}

// Verification after a worker restart must not silently omit an unresolved
// pre-search intent. Ref metadata may block, but only sealed matching records
// can establish completion. Anonymous legacy observations keep their semantics.
export async function assertSessionTaskIntentsResolved({api,base,response,journal,proof,assertCurrent}){
 const prefix=`refs/heads/learning/task-intent-${response.session_id}-`;
 const load=async()=>{
  const refs=await api.get(`/git/matching-refs/heads/learning/task-intent-${response.session_id}-`);
  if(!Array.isArray(refs)||refs.length>100||new Set(refs.map(r=>r?.ref)).size!==refs.length
   ||refs.some(r=>!r?.ref?.startsWith(prefix)||!/^[a-f0-9]{64}$/.test(r.ref.slice(prefix.length))||!sha(r.object?.sha)))fail();
  return refs;
 };
 const refs=await load(),searches=(journal.searches??[]).map(s=>s.observation).filter(o=>o.task_request_id!==null&&o.task_request_id!==undefined);
 const complete=new Map(searches.map(s=>[digest(s.task_request_id),s]));
 if(refs.some(r=>!complete.has(r.ref.slice(prefix.length))))throw new LearningError('task_search_unresolved');
 if(refs.length!==searches.length)fail();
 for(const ref of refs){
  const observation=complete.get(ref.ref.slice(prefix.length));
  const record=await readSealedSessionRecord({api,base,branch:ref.ref.slice('refs/heads/'.length),name:'intent.json',proof,assertCurrent,ref});
  const body=record?.body;
  if(!exact(body,['schema_version','kind','session_id','request_id','query','preference_indexes','nonce'])
   ||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(body.nonce??'')
   ||body.schema_version!==1||body.kind!=='private_task_search_intent'||body.session_id!==response.session_id
   ||body.request_id!==observation.task_request_id||body.query!==observation.query
   ||stableJson(body.preference_indexes)!==stableJson(observation.preference_indexes))fail();
 }
 await assertCurrent();
 if(stableJson((await load()).map(r=>[r.ref,r.object.sha]).sort())!==stableJson(refs.map(r=>[r.ref,r.object.sha]).sort()))fail();
}

// Called only AFTER the collector authenticated/recomputed the original active
// receipt, handoff, issuance proof and actual public packet. Missing context is
// not a successful use. A prepared context alone proves no delivery or search.
export async function readResearchSessionJournal({api,base,issued,handoffCommit,issuanceCommit,proof,assertCurrent}){
 if(typeof assertCurrent!=='function'||!sha(base?.sha)||base.sha!==issued?.source_heads?.private)fail();
 const metadata=await api.get('/');
 if(api.repository!=='Lewdcifer666/wtf-scifi-feedback'||metadata.full_name!==api.repository||metadata.private!==true||metadata.default_branch!=='main')fail();
 const {session_id,response}=describeResearchSession({issued,handoffCommit,issuanceCommit});
 const context=await readSealedSessionRecord({api,base,branch:`learning/session-${session_id}`,name:'session.json',
  expectedBody:sessionContextBody(response),proof,assertCurrent});
 const prefix=`refs/heads/learning/search-${session_id}-`;
 const refs=await loadSessionSearchRefs(api,session_id);
 if(!context){if(refs.length)fail();await assertCurrent();return null;}
 const searches=[];
 for(const ref of [...refs].sort((a,b)=>a.ref.localeCompare(b.ref,'en'))){
  const search_id=ref.ref.slice(prefix.length),record=await readSealedSessionRecord({api,base,branch:ref.ref.slice('refs/heads/'.length),name:'search.json',proof,assertCurrent,ref});
  if(!exact(record.body,['schema_version','kind','packet_absence_checked','session_id','search_id','observation']))fail();
  const observation=validateSessionSearch(record.body.observation,response);
  if(search_id!==digest(stableJson(observation))||stableJson(record.body)!==stableJson(sessionSearchBody(search_id,observation)))fail();
  searches.push({commit:record.commit,search_id,observation});
 }
 const requestIds=searches.map(s=>s.observation.task_request_id).filter(id=>id!==null&&id!==undefined);
 if(new Set(requestIds).size!==requestIds.length)fail();
 // Recheck mutable refs after all awaited verification. Their immutable bodies
 // may not be swapped while the observer constructs its historical artifact.
 await assertCurrent();
 const latest=await loadSessionSearchRefs(api,session_id);
 if(stableJson(latest.map(r=>[r.ref,r.object.sha]).sort())!==stableJson(refs.map(r=>[r.ref,r.object.sha]).sort()))fail();
 if((await api.optional(`/git/ref/heads/${context.branch}`))?.object?.sha!==context.commit)fail();
 for(const search of searches)if((await api.optional(`/git/ref/heads/learning/search-${session_id}-${search.search_id}`))?.object?.sha!==search.commit)fail();
 return {schema_version:1,kind:'private_historical_session_journal',session_id,context_commit:context.commit,
  context_prepared_verified:true,brief_delivery_verified:false,search_adapter_invocations_observed:searches.length,
  actual_context_use_verified:false,behavioral_effect_observed:false,searches};
}
