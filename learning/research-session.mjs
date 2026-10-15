// Private, read-only request/response boundary for a future trusted task adapter.
// This module does not stage interpretations, request a workflow, install a
// connector, publish research, or bypass a safety-denied operation.
import fs from 'node:fs';
import Ajv from 'ajv';
import {randomUUID} from 'node:crypto';
import {reconcile} from './reconcile.mjs';
import {berlinResearchDate} from './handoff.mjs';
import {GENRES} from './receipt.mjs';
import {digest,stableJson} from './interpretation.mjs';
import {LearningError} from './git-artifacts.mjs';
import {describeResearchSession,readResearchSessionJournal} from './session-journal.mjs';

const validateRequest=new Ajv({strict:true,allErrors:false}).compile(JSON.parse(fs.readFileSync(new URL('./schemas/research-session-request.schema.json',import.meta.url),'utf8')));
const sessions=new WeakMap();
const searchRecords=new WeakMap();
const taskSearches=new WeakMap();
const validateSearchResult=new Ajv({strict:true,allErrors:false}).compile({
  type:'object',additionalProperties:false,required:['sources','request_id'],properties:{
    request_id:{type:['string','null'],minLength:1,maxLength:256},
    sources:{type:'array',maxItems:100,items:{type:'object',additionalProperties:false,required:['url','title'],
      properties:{url:{type:'string',minLength:1,maxLength:4096},title:{type:'string',maxLength:1024}}}}
  }
});
const fail=code=>{throw new LearningError(code);};
const validDate=value=>Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const freeze=value=>{
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){
    for(const child of Object.values(value))freeze(child);
    Object.freeze(value);
  }
  return value;
};
const recordFor=session=>{
  const record=session&&typeof session==='object'?sessions.get(session):null;
  if(!record)fail('unauthenticated_research_session');
  return record;
};

async function assertHeads(options,issued){
  const metadata=await options.api.get('/');
  if(metadata.full_name!=='Lewdcifer666/wtf-scifi-feedback'||metadata.private!==true||metadata.default_branch!=='main')fail('private_repository_required');
  if((await options.api.pinMain()).sha!==issued.source_heads.private)fail('stale_input');
  for(const genre of GENRES){
    if(options.publicApis[genre].repository!==`Lewdcifer666/wtf-${genre}-stremio`||(await options.publicApis[genre].pinMain()).sha!==issued.source_heads.public[genre])fail('stale_input');
  }
}

async function assertNotStaged(options,request){
  const api=options.publicApis[request.genre],repository=`Lewdcifer666/wtf-${request.genre}-stremio`;
  const metadata=await api.get('/');
  if(api.repository!==repository||metadata.full_name!==repository||metadata.private!==false||metadata.default_branch!=='main')fail('invalid_consumer_request');
  const branch=`research/${request.research_date}-${request.genre}`;
  const ref=await api.optional(`/git/ref/heads/${branch}`);
  // An untouched dated ref is allowed. Any advanced branch must be handled by
  // existing immutable reconciliation, never replaced by a fresh session.
  if(ref&&(ref.ref!==`refs/heads/${branch}`||ref.object?.sha!==request.public_revision))fail('research_already_staged');
}

// No caller-selected feedback subset, stale snapshot, or caller-authored brief
// is accepted. The existing consumer reloads the complete current inventories,
// recomputes the receipt, and authenticates its handoff and ordering certificate.
export async function openResearchSession({api,publicApis,trustedRevision,request,clock=()=>new Date(),proof=null,searchProvider=null}){
  if(!validateRequest(request)||!validDate(request.research_date)||request.private_revision!==trustedRevision)fail('invalid_consumer_request');
  if(searchProvider!==null&&(typeof searchProvider.id!=='string'||!/^[a-z][a-z0-9._-]{0,63}$/.test(searchProvider.id)||typeof searchProvider.search!=='function'))fail('invalid_search_provider');
  const copied={schema_version:1,genre:request.genre,research_date:request.research_date,
    private_revision:request.private_revision,public_revision:request.public_revision};
  if(copied.research_date!==berlinResearchDate(clock()))fail('invalid_consumer_request');
  const options={api,publicApis,trustedRevision,clock,proof};
  const current=await reconcile({...options,dryRun:true,consumeGenre:copied.genre});
  const handoff=current.handoff;
  if(current.state!=='research_ready'||handoff.issued.source_heads.public[copied.genre]!==copied.public_revision)fail('stale_input');
  await assertNotStaged(options,copied);
  await assertHeads(options,handoff.issued);
  await assertNotStaged(options,copied);
  if(copied.research_date!==berlinResearchDate(clock()))fail('stale_input');
  const {binding,session_id}=describeResearchSession({issued:handoff.issued,handoffCommit:handoff.commit,issuanceCommit:handoff.issuance_commit});
  const session=freeze({schema_version:1,kind:'private_research_session',genre:copied.genre,
    research_date:copied.research_date,session_id});
  sessions.set(session,{options,request:freeze(copied),binding:freeze(structuredClone(binding)),
    provider:searchProvider===null?null:Object.freeze({id:searchProvider.id,search:searchProvider.search.bind(searchProvider)})});
  return session;
}

// Explicit PRIVATE response only. Generic JSON logging of the session handle
// cannot accidentally print a brief. The adapter must not publish this response
// in a public packet, Actions output/artifact, or public research task summary.
export async function privateResearchSessionResponse(session){
  const {binding}=recordFor(session);
  await recheckResearchSession(session);
  return freeze(structuredClone(describeResearchSession({issued:binding.issued,
    handoffCommit:binding.handoff_commit,issuanceCommit:binding.issuance_commit}).response));
}

// Reopening recomputes current state after other genres may have published.
// A stale result fails; this reader never mints a replacement receipt/handoff.
export async function recheckResearchSession(session){
  const {options,request}=recordFor(session);
  const fresh=await openResearchSession({...options,request});
  if(fresh.session_id!==session.session_id)fail('stale_input');
  return session;
}

// The provider is installed by trusted adapter code, never selected by a JSON
// request or AI-authored script. Only the query is sent to it; the private brief
// and preference mapping stay here. Failure stops this call without retries or
// another writer/provider. These records prove that this adapter invoked its
// configured search function, not that an AI claim or causal effect is true.
export async function observeResearchSessionSearch({session,query,preferenceIndexes,taskRequestId=null}){
  const {provider,binding}=recordFor(session);
  if(!provider)fail('search_provider_unavailable');
  const preferenceCount=binding.issued.context.preferences.length;
  if((taskRequestId!==null&&(typeof taskRequestId!=='string'||!/^[a-zA-Z0-9._-]{1,64}$/.test(taskRequestId)))
    ||typeof query!=='string'||!query.trim()||query.length>2000||Buffer.from(query,'utf8').toString('utf8')!==query
    ||!Array.isArray(preferenceIndexes)||preferenceIndexes.length>preferenceCount
    ||new Set(preferenceIndexes).size!==preferenceIndexes.length
    ||Array.from(preferenceIndexes).some(i=>!Number.isInteger(i)||i<0||i>=preferenceCount))fail('invalid_search_request');
  const selectedIndexes=[...preferenceIndexes].sort((a,b)=>a-b);
  const signature=stableJson({query,preference_indexes:selectedIndexes});
  let pending;
  if(taskRequestId!==null){
    if(!taskSearches.has(session))taskSearches.set(session,new Map());
    pending=taskSearches.get(session);const previous=pending.get(taskRequestId);
    if(previous){
      if(previous.signature!==signature)fail('task_request_conflict');
      await recheckResearchSession(session);return previous.result;
    }
    if(pending.size>=100)fail('session_journal_limit');
  }
  await recheckResearchSession(session);
  const invocation_id=randomUUID();
  let result;
  try{result=structuredClone(await provider.search(query));}catch{fail('research_search_failed');}
  if(!validateSearchResult(result))fail('invalid_search_result');
  for(const source of result.sources){
    let url;try{url=new URL(source.url);}catch{fail('invalid_search_result');}
    if(url.protocol!=='https:'||url.username||url.password||!url.hostname.includes('.'))fail('invalid_search_result');
  }
  const body=freeze({schema_version:3,kind:'private_observed_research_search',invocation_id,task_request_id:taskRequestId,session_id:session.session_id,
    use_id:binding.issued.use_id,context_hash:binding.issued.context_hash,provider_id:provider.id,
    query,preference_indexes:selectedIndexes,
    provider_request_id:result.request_id,sources:structuredClone(result.sources)});
  const handle=freeze({schema_version:1,kind:'private_research_search_handle',search_id:digest(stableJson(body))});
  searchRecords.set(handle,{session,body});
  const observed=freeze({handle,sources:freeze(structuredClone(result.sources))});
  // Retain a real completed invocation BEFORE the awaited final head check.
  // Transient verification failures can retry its stable task request ID
  // without invoking the provider again; stale evidence is never released.
  if(pending)pending.set(taskRequestId,{signature,result:observed});
  await recheckResearchSession(session);return observed;
}

// Explicit private transport boundary; copied handles and records from another
// session are refused. The durable journal writer cannot accept AI-authored JSON
// in place of an observation made by the configured trusted search adapter.
export function privateResearchSearchObservation({session,handle}){
  recordFor(session);
  const record=handle&&typeof handle==='object'?searchRecords.get(handle):null;
  if(!record||record.session!==session)fail('unauthenticated_research_search');
  return freeze(structuredClone({search_id:handle.search_id,observation:record.body}));
}

// Recover only signed immutable observations authenticated against this active
// session's original complete source tuple. Plain JSON still cannot mint a
// handle. Recovery does not invoke a search or revive stale taste evidence.
export async function restoreResearchSessionSearches(session){
  const {options,binding}=recordFor(session);await recheckResearchSession(session);
  const base=await options.api.pinMain();
  const journal=await readResearchSessionJournal({api:options.api,base,issued:binding.issued,
    handoffCommit:binding.handoff_commit,issuanceCommit:binding.issuance_commit,proof:options.proof,
    assertCurrent:()=>recheckResearchSession(session)});
  const restored=(journal?.searches||[]).map(({search_id,observation,commit})=>{
    const handle=freeze({schema_version:1,kind:'private_research_search_handle',search_id});
    searchRecords.set(handle,{session,body:freeze(structuredClone(observation))});
    return {handle,commit,task_request_id:observation.task_request_id??null,query:observation.query,
      preference_indexes:structuredClone(observation.preference_indexes),sources:structuredClone(observation.sources)};
  });
  await recheckResearchSession(session);return freeze(restored);
}

// Bind the session to the actual validated public packet before publication.
// Caller-authored JSON cannot substitute for the in-process authenticated
// handle. This proves input provenance and candidate diagnostics only; it does
// NOT assert that the AI used the brief or that recommendations changed.
export async function verifyResearchSessionCommit({session,researchCommit,searches=[]}){
  const {options,request,binding}=recordFor(session);
  if(typeof researchCommit!=='string'||!/^[a-f0-9]{40}$/.test(researchCommit))fail('invalid_consumer_request');
  if(!Array.isArray(searches)||searches.length>100)fail('invalid_research_search_evidence');
  const records=Array.from(searches,handle=>{const record=privateResearchSearchObservation({session,handle});return {search_id:record.search_id,...record.observation};});
  if(new Set(records.map(r=>r.search_id)).size!==records.length)fail('invalid_research_search_evidence');
  if(request.research_date!==berlinResearchDate(options.clock()))fail('stale_input');
  const verified=await reconcile({...options,dryRun:true,consumeGenre:request.genre,researchCommit});
  if(verified.state!=='research_verified'||stableJson(verified.handoff.issued)!==stableJson(binding.issued)
    ||verified.handoff.commit!==binding.handoff_commit||verified.handoff.issuance_commit!==binding.issuance_commit)fail('stale_input');
  await assertHeads(options,binding.issued);
  const branch=`research/${request.research_date}-${request.genre}`;
  const ref=await options.publicApis[request.genre].optional(`/git/ref/heads/${branch}`);
  if(ref?.ref!==`refs/heads/${branch}`||ref.object?.sha!==researchCommit)fail('stale_input');
  if(request.research_date!==berlinResearchDate(options.clock()))fail('stale_input');
  return freeze({schema_version:1,kind:'private_research_session_verification',session_id:session.session_id,
    trace:structuredClone(verified.trace),searches:structuredClone(records),
    search_adapter_invocations_observed:records.length,actual_context_use_verified:false,behavioral_effect_observed:false});
}
