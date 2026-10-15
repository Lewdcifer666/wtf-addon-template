// Dormant trusted-host entry point. This does not create an HTTP/MCP server,
// install a connector, stage AI packets, change activation, or invoke an AI API.
import fs from 'node:fs';
import Ajv from 'ajv';
import {randomUUID} from 'node:crypto';
import {LearningError} from './git-artifacts.mjs';
import {stableJson,digest} from './interpretation.mjs';
import {openResearchSession,privateResearchSessionResponse,recheckResearchSession,
 observeResearchSessionSearch,verifyResearchSessionCommit,restoreResearchSessionSearches} from './research-session.mjs';
import {persistResearchSessionContext,persistResearchSessionSearch,
 persistResearchSessionTaskIntent,readResearchSessionTaskIntent} from './session-journal-writer.mjs';
import {loadSessionSearchRefs} from './session-journal.mjs';

const token={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'};
const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const call=(operation,request)=>object({schema_version:{const:1},operation:{const:operation},request});
const sessionRequest=JSON.parse(fs.readFileSync(new URL('./schemas/research-session-request.schema.json',import.meta.url),'utf8'));
const validate=new Ajv({strict:true,allErrors:false}).compile({oneOf:[
 call('open',sessionRequest),call('context',object({task_token:token})),
 call('search',object({task_token:token,request_id:{type:'string',pattern:'^[a-zA-Z0-9._-]{1,64}$'},
  query:{type:'string',minLength:1,maxLength:2000},preference_indexes:{type:'array',maxItems:100,uniqueItems:true,items:{type:'integer',minimum:0}}})),
 call('verify',object({task_token:token,research_commit:{type:'string',pattern:'^[a-f0-9]{40}$'}}))
]});
const fail=code=>{throw new LearningError(code);};
const recoverable=error=>error?.code==='github_request_failed'&&[408,429,500,502,503,504].includes(error.status)
 ||['transport_failure','proof_key_unavailable','proof_transport_failure'].includes(error?.code);
const publicErrors=new Set(['invalid_task_call','private_task_access_held','task_session_limit','unknown_task_session',
 'task_request_conflict','task_search_unresolved','learning_inactive','invalid_consumer_request','invalid_handoff',
 'stale_input','research_already_staged','private_repository_required','invalid_search_request','search_provider_unavailable',
 'research_search_failed','invalid_search_result','session_journal_limit','session_context_not_persisted',
 'github_request_failed','transport_failure','proof_credentials_required','proof_key_unavailable','proof_transport_failure',
 'invalid_session_journal','invalid_observation_proof','immutable_artifact_mismatch','invalid_signed_artifact']);
const safeError=error=>new LearningError(publicErrors.has(error?.code)?error.code:'private_task_failed');

// These options are installed by trusted host code, NEVER by a task request.
// The host must authenticate its private caller before dispatch. A separate
// fail-closed deployment gate preserves the safety hold even if the checked-in
// activation policy is later enabled. One process queues all calls; existing
// workflow-wide non-canceling concurrency remains the outer writer boundary.
export function createPrivateResearchTaskAdapter({api,publicApis,trustedRevision,clock,proof,searchProvider=null,
 taskAccessAllowed=async()=>false}){
 if(typeof taskAccessAllowed!=='function')fail('private_task_access_held');
 const sessions=new Map(),requests=new Map();let queue=Promise.resolve();
 const authority={api,publicApis,trustedRevision,clock,proof,searchProvider};
 const writeContext=async entry=>{
  if(entry.blocked)throw entry.blocked;
  try{
   entry.context=await persistResearchSessionContext({api,session:entry.session,proof});
   {
    const recovered=await restoreResearchSessionSearches(entry.session);
    const searches=new Map(),anonymous=[];
    for(const search of recovered){
     if(search.task_request_id===null){anonymous.push(search.handle);continue;}
     if(!await readResearchSessionTaskIntent({api,session:entry.session,proof,request:{request_id:search.task_request_id,
      query:search.query,preference_indexes:search.preference_indexes}}))fail('invalid_session_journal');
     searches.set(search.task_request_id,{signature:stableJson({query:search.query,preference_indexes:search.preference_indexes}),
      observed:{handle:search.handle,sources:search.sources},persisted:{commit:search.commit},blocked:null});
    }
    // Preserve an observed but not yet persisted result owned by this process.
    // Reopening must not discard the only safe retry handle.
    for(const [id,search] of entry.searches)if(!search.persisted&&!searches.has(id))searches.set(id,search);
    const prefix=`refs/heads/learning/task-intent-${entry.session.session_id}-`;
    const refs=await api.get(`/git/matching-refs/heads/learning/task-intent-${entry.session.session_id}-`);
    if(!Array.isArray(refs)||refs.length>100||new Set(refs.map(r=>r?.ref)).size!==refs.length
     ||refs.some(r=>!r?.ref?.startsWith(prefix)||!/^[a-f0-9]{64}$/.test(r.ref.slice(prefix.length))||!/^[a-f0-9]{40}$/.test(r.object?.sha)))fail('invalid_session_journal');
    // Metadata may block work, never authenticate a completed operation. A
    // signed search plus its signed matching intent is required above.
    const complete=new Set([...searches.keys()].map(digest));
    entry.unresolvedIntents=refs.some(r=>!complete.has(r.ref.slice(prefix.length)));
    entry.searches=searches;entry.anonymous=anonymous;
   }
   return await privateResearchSessionResponse(entry.session);
  }catch(error){if(!recoverable(error))entry.blocked=safeError(error);throw error;}
 };
 const sessionFor=taskToken=>{
  const entry=sessions.get(taskToken);if(!entry)fail('unknown_task_session');
  if(entry.blocked)throw entry.blocked;return entry;
 };
 const contextResponse=(entry,response)=>({schema_version:1,kind:'private_task_context',task_token:entry.token,
  context_commit:entry.context.commit,response,actual_context_use_verified:false,behavioral_effect_observed:false});
 async function dispatch({operation,request}){
  if(await taskAccessAllowed()!==true)fail('private_task_access_held');
  if(operation==='open'){
   const key=stableJson(request);let entry=requests.get(key);
   if(!entry){
    if(sessions.size>=6)fail('task_session_limit');
    const session=await openResearchSession({...authority,request});
    entry={session,token:randomUUID(),searches:new Map(),anonymous:[],unresolvedIntents:false,context:null,blocked:null};
    sessions.set(entry.token,entry);requests.set(key,entry);
   }
   return contextResponse(entry,await writeContext(entry));
  }
  const entry=sessionFor(request.task_token);
  if(operation==='context')return contextResponse(entry,await privateResearchSessionResponse(entry.session));
  if(operation==='verify'){
   if(entry.unresolvedIntents||[...entry.searches.values()].some(s=>!s.persisted))fail('task_search_unresolved');
   const verified=await verifyResearchSessionCommit({session:entry.session,researchCommit:request.research_commit,
    searches:[...entry.anonymous,...[...entry.searches.values()].map(s=>s.observed.handle)]});
   return {schema_version:1,kind:'private_task_research_verification',session_id:entry.session.session_id,
    research_commit:verified.trace.research_commit,search_adapter_invocations_observed:verified.search_adapter_invocations_observed,
    actual_context_use_verified:false,behavioral_effect_observed:false};
  }
  await recheckResearchSession(entry.session);
  if(entry.unresolvedIntents)fail('task_search_unresolved');
  const signature=stableJson({query:request.query,preference_indexes:[...request.preference_indexes].sort((a,b)=>a-b)});
  let search=entry.searches.get(request.request_id);
  if(search&&search.signature!==signature)fail('task_request_conflict');
  if(!search){
   if(searchProvider===null)fail('search_provider_unavailable');
   if([...entry.searches.values()].some(s=>!s.persisted))fail('task_search_unresolved');
   const refs=await loadSessionSearchRefs(api,entry.session.session_id);
   if(refs.length>=100||entry.searches.size>=100)fail('session_journal_limit');
   search={signature,nonce:randomUUID(),observed:null,persisted:null,blocked:null};entry.searches.set(request.request_id,search);
  }
  if(search.blocked)throw search.blocked;
  if(!search.observed){
   try{
    const intent=await persistResearchSessionTaskIntent({api,session:entry.session,proof,nonce:search.nonce,
     request:{request_id:request.request_id,query:request.query,preference_indexes:[...request.preference_indexes].sort((a,b)=>a-b)}});
    if(!intent.owned)fail('task_search_unresolved');
   }catch(error){
    if(error.code==='task_search_unresolved'){
     entry.unresolvedIntents=true;entry.searches.delete(request.request_id);
    }else if(!recoverable(error))entry.blocked=search.blocked=safeError(error);
    throw error;
   }
   try{search.observed=await observeResearchSessionSearch({session:entry.session,query:request.query,
    preferenceIndexes:request.preference_indexes,taskRequestId:request.request_id});}
   // A provider error is terminal for this request; never try another provider
   // or automatically repeat an invocation whose result is unknown.
   catch(error){if(!recoverable(error))entry.blocked=search.blocked=safeError(error);throw error;}
  }
  if(!search.persisted){
   try{search.persisted=await persistResearchSessionSearch({api,session:entry.session,handle:search.observed.handle,proof});}
   catch(error){if(!recoverable(error))entry.blocked=search.blocked=safeError(error);throw error;}
  }
  // Never release an unpersisted or newly stale provider result to a task.
  await recheckResearchSession(entry.session);
  return {schema_version:1,kind:'private_task_search_result',session_id:entry.session.session_id,
   request_id:request.request_id,search_id:search.observed.handle.search_id,observation_commit:search.persisted.commit,
   sources:structuredClone(search.observed.sources),actual_context_use_verified:false,behavioral_effect_observed:false};
 }
 return Object.freeze({async dispatch(input){
  if(!validate(input))fail('invalid_task_call');
  // Snapshot before queueing, including while an earlier call is suspended.
  const snapshot=structuredClone(input),run=queue.then(()=>dispatch(snapshot));queue=run.catch(()=>{});
  try{return await run;}catch(error){throw safeError(error);}
 }});
}
