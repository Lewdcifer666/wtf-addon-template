// PC-side interpretation transport. No Git writes or signing capability.
import {LearningError} from './git-artifacts.mjs';
import {stableJson} from './interpretation.mjs';
import {PROOF_REPOSITORY} from './observation-proof.mjs';
import {validateInterpretationWorkerCall,interpretationWorkerHash,readInterpretationWorkerResult} from './interpretation-worker.mjs';
import {brokerCallFamily} from './broker-request-store.mjs';
const fail=code=>{throw new LearningError(code);};

export function createInterpretationBrokerAdapter({api,proof,store,dispatchWorker,clock=()=>new Date(),interpretationAccessAllowed=async()=>false}={}){
 let queue=Promise.resolve(),cursor=0;
 const allowed=async()=>{if(typeof interpretationAccessAllowed!=='function'||await interpretationAccessAllowed()!==true)fail('private_interpretation_access_held');};
 async function run(input,{submit=true}={}){
  const call=validateInterpretationWorkerCall(input);await allowed();
  if(api?.writable!==false||!store||['reserve','pending','reserveDispatch','complete','completed'].some(key=>typeof store[key]!=='function')
   ||typeof dispatchWorker!=='function')fail('private_interpretation_access_held');
  const assertCurrent=async()=>{
   await allowed();const metadata=await api.get('/');
   if(api.repository!==PROOF_REPOSITORY||metadata?.full_name!==PROOF_REPOSITORY||metadata.private!==true||metadata.default_branch!=='main')fail('private_repository_required');
   if((await api.pinMain()).sha!==call.request.source_revision)fail('stale_input');await allowed();
  };
  await assertCurrent();const base=await api.pinMain();if(base.sha!==call.request.source_revision)fail('stale_input');
  const saved=await store.reserve(call),key=interpretationWorkerHash(call);
  if(saved.request_hash!==key||stableJson(saved.call)!==stableJson(call))fail('task_request_conflict');
  const result=await readInterpretationWorkerResult({api,base,call,proof,assertCurrent}),completed=await store.completed(key);
  if(result){
   if(completed&&completed.result_commit!==result.commit)fail('immutable_artifact_mismatch');
   await assertCurrent();await store.complete(key,result.commit);await allowed();
   return structuredClone(result.body.result);
  }
  if(completed)fail('immutable_artifact_mismatch');
  if(submit&&await store.reserveDispatch(key,clock().toISOString())){
   await assertCurrent();
   try{await dispatchWorker(call);}catch{fail('private_interpretation_pending');}
  }
  fail('private_interpretation_pending');
 }
 const serialized=fn=>{const next=queue.then(fn);queue=next.catch(()=>{});return next;};
 return Object.freeze({
  persistsTaskBookkeeping:true,
  dispatch(input){const snapshot=validateInterpretationWorkerCall(input);return serialized(async()=>{
   await allowed();
   const first=(await store.pending()).find(entry=>brokerCallFamily(entry.call)==='interpretation');
   if(first&&first.request_hash!==interpretationWorkerHash(snapshot))try{await run(first.call,{submit:false});}catch{}
   return run(snapshot);
  });},
  reconcilePending({limit=1}={}){return serialized(async()=>{
   await allowed();if(!Number.isInteger(limit)||limit<1||limit>20)fail('invalid_interpretation_task_call');
   const entries=(await store.pending()).filter(entry=>brokerCallFamily(entry.call)==='interpretation'),counts={completed:0,pending:0,unresolved:0};
   const batch=entries.length?Array.from({length:Math.min(limit,entries.length)},(_,i)=>entries[(cursor+i)%entries.length]):[];
   cursor=entries.length?(cursor+batch.length)%entries.length:0;
   for(const entry of batch){try{await run(entry.call);counts.completed++;}
    catch(error){if(error.code==='private_interpretation_pending')counts.pending++;else counts.unresolved++;}}
   return counts;
  });}
 });
}
