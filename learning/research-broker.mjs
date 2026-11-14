// PC-side closed dispatcher. Its GitHub client is READ ONLY; all derived Git
// writes and OIDC signing happen inside the bounded trusted-main workflow.
import {LearningError,readArtifactJson} from './git-artifacts.mjs';
import {stableJson} from './interpretation.mjs';
import {GENRES} from './receipt.mjs';
import {PROOF_REPOSITORY} from './observation-proof.mjs';
import {validateWorkerCall,workerRequestHash,readWorkerRecord,assertWorkerHeads,isHistoricalVerificationResult} from './research-worker.mjs';
import {brokerCallFamily} from './broker-request-store.mjs';
import {berlinResearchDate} from './handoff.mjs';
import {assertPrivateTaskDeadline,privateTaskDelay,withPrivateTaskDeadline} from './task-deadline.mjs';
import {RESEARCH_REQUEST_MS,RESEARCH_RESULT_WAIT_MS} from './request-budgets.mjs';
const fail=code=>{throw new LearningError(code);};

export function createResearchBrokerAdapter({api,publicApis,proof,store,dispatchWorker,clock=()=>new Date(),taskAccessAllowed=async()=>false,
 resultWaitMs=0,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),monotonic=()=>Date.now()}={}){
 if(!Number.isInteger(resultWaitMs)||resultWaitMs<0||resultWaitMs>RESEARCH_RESULT_WAIT_MS||typeof sleep!=='function'||typeof monotonic!=='function')fail('invalid_task_call');
 let queue=Promise.resolve(),cursor=0;
 // Rejection hints only: never proof, current heads, a completed result or a
 // dispatch permission. Old token-bound calls otherwise re-read their private
 // ticket and public heads on every background turn after an upgrade/date change.
 // Keep the journal immutable and bound this process-local metadata independently.
 const backgroundHints=new Map(),hintLimit=1024;
 const rememberHint=(token,hint)=>{
  backgroundHints.delete(token);
  if(backgroundHints.size>=hintLimit)backgroundHints.delete(backgroundHints.keys().next().value);
  backgroundHints.set(token,hint);
 };
 const excludedByHint=(call,today)=>{
  const hint=backgroundHints.get(call.request.task_token);
  return !!hint&&(hint.obsolete||hint.research_date<today);
 };
 async function backgroundCandidate(call){
  if(call.operation==='open')return true;
  const today=berlinResearchDate(clock());
  if(excludedByHint(call,today))return false;
  if(backgroundHints.has(call.request.task_token))return true;
  if(api?.writable!==false||api.repository!==PROOF_REPOSITORY)fail('private_task_access_held');
  const metadata=await api.get('/'),base=await api.pinMain();
  if(metadata.full_name!==PROOF_REPOSITORY||metadata.private!==true||metadata.default_branch!=='main'
   ||!/^[a-f0-9]{40}$/.test(base?.sha??''))fail('private_repository_required');
  const branch=`learning/task-token-${call.request.task_token}`,ref=await api.optional(`/git/ref/heads/${branch}`);
  // Missing/failed reads may be temporary visibility or transport failures;
  // they cannot establish an obsolete record and must not poison the hints.
  if(!ref)return true;
  if(ref.ref!==`refs/heads/${branch}`||!/^[a-f0-9]{40}$/.test(ref.object?.sha??''))fail('invalid_task_record');
  const raw=await readArtifactJson(api,ref,'task-ticket.json',{maxBytes:1024*1024});
  if(raw.parent!==base.sha){rememberHint(call.request.task_token,{obsolete:true});return false;}
  const body=raw.value?.body;let opened;
  try{opened=validateWorkerCall({schema_version:1,operation:'open',request:body?.open_request});}
  catch{return true;}
  if(body.kind!=='private_task_ticket'||body.task_token!==call.request.task_token
   ||body.source_heads?.private!==base.sha||opened.request.private_revision!==base.sha)return true;
  const hint={obsolete:false,private_revision:base.sha,research_date:opened.request.research_date};rememberHint(call.request.task_token,hint);
  return hint.research_date>=today;
 }
 async function run(input,{submit=true}={}){
  const call=validateWorkerCall(input);
  assertPrivateTaskDeadline();
  if(typeof taskAccessAllowed!=='function'||await taskAccessAllowed()!==true)fail('private_task_access_held');
  if(call.operation==='open'&&call.request.research_date!==berlinResearchDate(clock()))fail('stale_input');
  if(!store||typeof store.reserve!=='function'||typeof store.pending!=='function'||typeof store.reserveDispatch!=='function'
   ||typeof store.complete!=='function'||typeof store.completed!=='function'||typeof dispatchWorker!=='function'||api?.writable!==false)fail('private_task_access_held');
  const metadata=await api.get('/'),base=await api.pinMain();
  if(api.repository!==PROOF_REPOSITORY||metadata.full_name!==PROOF_REPOSITORY||metadata.private!==true||metadata.default_branch!=='main')fail('private_repository_required');
  if(call.operation==='open'&&call.request.private_revision!==base.sha)fail('stale_input');
  let ticket,request;
  if(call.operation==='open')request=call.request;
  else{
   const hint=backgroundHints.get(call.request.task_token);
   if(hint?.private_revision&&hint.private_revision!==base.sha)rememberHint(call.request.task_token,{obsolete:true});
   ticket=await readWorkerRecord({api,base,proof,kind:'ticket',branch:`learning/task-token-${call.request.task_token}`});
   if(!ticket||ticket.body.task_token!==call.request.task_token)fail('unknown_task_session');request=ticket.body.open_request;
   rememberHint(call.request.task_token,{obsolete:false,private_revision:base.sha,research_date:request.research_date});
  }
  const heads=call.operation==='verify'?ticket.body.source_heads:
   {private:base.sha,public:Object.fromEntries(await Promise.all(GENRES.map(async g=>[g,(await publicApis[g].pinMain()).sha])))};
  const assertCurrent=(sourceHeads,historical=call.operation==='verify')=>assertWorkerHeads({api,publicApis,heads:sourceHeads,request,operation:call.operation,researchCommit:call.request.research_commit,clock,historical});
  await assertCurrent(heads);
  if(call.operation==='open'){
   // Availability is a prerequisite, never authentication. A missing current
   // interpretation cannot be repaired by dispatching another research job.
   // The trusted worker still validates its complete packet/proof and computes
   // the current receipt before any context or provider capability is released.
   const branch=`interpretation/${base.sha}`,ref=await api.optional(`/git/ref/heads/${branch}`);
   if(!ref)fail('interpretation_not_staged');
   if(ref.ref!==`refs/heads/${branch}`||!/^[a-f0-9]{40}$/.test(ref.object?.sha??''))fail('invalid_interpretation_record');
   await assertCurrent(heads);
  }
  // Reserve before dispatch. A changed query cannot borrow the same search ID.
  assertPrivateTaskDeadline();
  const saved=await store.reserve(call),requestHash=workerRequestHash(call);
  if(saved.request_hash!==requestHash||stableJson(saved.call)!==stableJson(call))fail('task_request_conflict');
  const result=await readWorkerRecord({api,base,proof,kind:'result',branch:`learning/task-result-${requestHash}`});
  if(result){
   if(stableJson(result.body.call)!==stableJson(call)||(ticket&&result.body.session_id!==ticket.body.session_id))fail('invalid_task_record');
   await assertCurrent(result.body.source_heads,isHistoricalVerificationResult(result.body));
   if(await taskAccessAllowed()!==true)fail('private_task_access_held');
   await store.complete(requestHash,result.commit);
   return structuredClone(result.body.result);
  }
  // A missing formerly completed artifact is tampering/loss, not permission to
  // regenerate that immutable result with a new proof or replacement writer.
  if(await store.completed(requestHash))fail('immutable_artifact_mismatch');
  if(submit&&await store.reserveDispatch(requestHash,clock().toISOString())){
   // Persisted reservation survives an uncertain dispatch or PC restart.
   try{await dispatchWorker(call);}catch{fail('private_task_pending');}
  }
  fail('private_task_pending');
 }
 const serialized=fn=>{const next=queue.then(fn);queue=next.catch(()=>{});return next;};
 return Object.freeze({
  persistsTaskBookkeeping:true,
  dispatch(input){const snapshot=validateWorkerCall(input);return withPrivateTaskDeadline(async()=>{
   assertPrivateTaskDeadline();
   if(await taskAccessAllowed()!==true)fail('private_task_access_held');
   // Interactive time belongs to this original request. The independent
   // background reconciler handles other persisted work without starving it.
   try{return await serialized(()=>run(snapshot));}catch(error){
    if(error.code!=='private_task_pending'||!resultWaitMs)throw error;
    const deadline=monotonic()+resultWaitMs;
    for(let reads=0;reads<30&&monotonic()<deadline;reads++){
     assertPrivateTaskDeadline();
     await privateTaskDelay(Math.min(10000,deadline-monotonic()),sleep);
     assertPrivateTaskDeadline();
     // Missing-result polls read only the original ref. Full proof/current-head
     // checks still run before any result is released. No dispatch/provider
     // repetition, mutable head cache or alternative endpoint is introduced.
     if(await taskAccessAllowed()!==true)fail('private_task_access_held');
     const ref=await api.optional(`/git/ref/heads/learning/task-result-${workerRequestHash(snapshot)}`);
     if(!ref)continue;
     try{return await serialized(()=>run(snapshot,{submit:false}));}catch(next){if(next.code!=='private_task_pending')throw next;}
    }
    throw error;
   }
  },{timeoutMs:RESEARCH_REQUEST_MS});},
  reconcilePending({limit=1}={}){return withPrivateTaskDeadline(()=>serialized(async()=>{
   assertPrivateTaskDeadline();
   if(await taskAccessAllowed()!==true)fail('private_task_access_held');
   if(!Number.isInteger(limit)||limit<1||limit>20)fail('invalid_task_call');
   const today=berlinResearchDate(clock());
   const entries=(await store.pending()).filter(entry=>brokerCallFamily(entry.call)==='research'
    &&(entry.call.operation==='open'?entry.call.request.research_date===today:!excludedByHint(entry.call,today))),counts={completed:0,pending:0,unresolved:0};
   // Requests remain persisted after every result/error, including old policy.
   const batch=entries.length?Array.from({length:Math.min(limit,entries.length)},(_,i)=>entries[(cursor+i)%entries.length]):[];
   cursor=entries.length?(cursor+batch.length)%entries.length:0;
   for(const item of batch){
    try{if(!await backgroundCandidate(item.call))continue;await run(item.call);counts.completed++;}
    catch(error){if(error.code==='private_task_pending')counts.pending++;else counts.unresolved++;}
   }
   return counts;
  }));}
 });
}
