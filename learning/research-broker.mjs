// PC-side closed dispatcher. Its GitHub client is READ ONLY; all derived Git
// writes and OIDC signing happen inside the bounded trusted-main workflow.
import {LearningError} from './git-artifacts.mjs';
import {stableJson} from './interpretation.mjs';
import {GENRES} from './receipt.mjs';
import {PROOF_REPOSITORY} from './observation-proof.mjs';
import {validateWorkerCall,workerRequestHash,readWorkerRecord,assertWorkerHeads} from './research-worker.mjs';
const fail=code=>{throw new LearningError(code);};

export function createResearchBrokerAdapter({api,publicApis,proof,store,dispatchWorker,clock=()=>new Date(),taskAccessAllowed=async()=>false}={}){
 let queue=Promise.resolve(),cursor=0;
 async function run(input,{submit=true}={}){
  const call=validateWorkerCall(input);
  if(typeof taskAccessAllowed!=='function'||await taskAccessAllowed()!==true)fail('private_task_access_held');
  if(!store||typeof store.reserve!=='function'||typeof store.pending!=='function'||typeof store.reserveDispatch!=='function'
   ||typeof store.complete!=='function'||typeof store.completed!=='function'||typeof dispatchWorker!=='function'||api?.writable!==false)fail('private_task_access_held');
  const metadata=await api.get('/'),base=await api.pinMain();
  if(api.repository!==PROOF_REPOSITORY||metadata.full_name!==PROOF_REPOSITORY||metadata.private!==true||metadata.default_branch!=='main')fail('private_repository_required');
  let ticket,request;
  if(call.operation==='open')request=call.request;
  else{
   ticket=await readWorkerRecord({api,base,proof,kind:'ticket',branch:`learning/task-token-${call.request.task_token}`});
   if(!ticket||ticket.body.task_token!==call.request.task_token)fail('unknown_task_session');request=ticket.body.open_request;
  }
  const heads={private:base.sha,public:Object.fromEntries(await Promise.all(GENRES.map(async g=>[g,(await publicApis[g].pinMain()).sha])))};
  const assertCurrent=sourceHeads=>assertWorkerHeads({api,publicApis,heads:sourceHeads,request,operation:call.operation,researchCommit:call.request.research_commit,clock});
  await assertCurrent(heads);
  // Reserve before dispatch. A changed query cannot borrow the same search ID.
  const saved=await store.reserve(call),requestHash=workerRequestHash(call);
  if(saved.request_hash!==requestHash||stableJson(saved.call)!==stableJson(call))fail('task_request_conflict');
  const result=await readWorkerRecord({api,base,proof,kind:'result',branch:`learning/task-result-${requestHash}`});
  if(result){
   if(stableJson(result.body.call)!==stableJson(call)||(ticket&&result.body.session_id!==ticket.body.session_id))fail('invalid_task_record');
   await assertCurrent(result.body.source_heads);
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
  dispatch(input){const snapshot=validateWorkerCall(input);return serialized(async()=>{
   if(await taskAccessAllowed()!==true)fail('private_task_access_held');
   // Read back the current outstanding result before submitting another job.
   // This never repeats a provider call or trusts the local completion hint.
   const first=(await store.pending())[0];
   if(first&&first.request_hash!==workerRequestHash(snapshot))try{await run(first.call,{submit:false});}catch{}
   return run(snapshot);
  });},
  reconcilePending({limit=1}={}){return serialized(async()=>{
   if(await taskAccessAllowed()!==true)fail('private_task_access_held');
   if(!Number.isInteger(limit)||limit<1||limit>20)fail('invalid_task_call');
   const entries=await store.pending(),counts={completed:0,pending:0,unresolved:0};
   // Requests remain persisted after every result/error, including old policy.
   const batch=entries.length?Array.from({length:Math.min(limit,entries.length)},(_,i)=>entries[(cursor+i)%entries.length]):[];
   cursor=entries.length?(cursor+batch.length)%entries.length:0;
   for(const item of batch){
    try{await run(item.call);counts.completed++;}
    catch(error){if(error.code==='private_task_pending')counts.pending++;else counts.unresolved++;}
   }
   return counts;
  });}
 });
}
