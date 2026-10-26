// PC-side interpretation transport. No Git writes or signing capability.
import {LearningError} from './git-artifacts.mjs';
import {stableJson} from './interpretation.mjs';
import {PROOF_REPOSITORY} from './observation-proof.mjs';
import {validateInterpretationWorkerCall,interpretationWorkerHash,readInterpretationWorkerResult} from './interpretation-worker.mjs';
import {brokerCallFamily} from './broker-request-store.mjs';
import {interpretationTransportPlan,interpretationWireHash,readInterpretationPart,interpretationPartBranch} from './interpretation-transport.mjs';
const fail=code=>{throw new LearningError(code);};
const isRoot=entry=>brokerCallFamily(entry.call)==='interpretation'&&!['part','assemble'].includes(entry.call.operation);

export function createInterpretationBrokerAdapter({api,proof,store,dispatchWorker,clock=()=>new Date(),interpretationAccessAllowed=async()=>false}={}){
 let queue=Promise.resolve(),cursor=0;const verifiedParts=new Map();
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
   await assertCurrent();
   const plan=interpretationTransportPlan(call);
   if(!plan.inline)await store.complete(interpretationWireHash(plan.assembly),result.commit);
   await store.complete(key,result.commit);await allowed();
   return structuredClone(result.body.result);
  }
  if(completed)fail('immutable_artifact_mismatch');
  let wire=call;const plan=interpretationTransportPlan(call);
  if(!plan.inline){
   wire=plan.assembly;
   for(const part of plan.parts){
    const partKey=interpretationWireHash(part);await store.reserve(part);
    const {data_base64,...request}=part.request;
    let observed;const hint=await store.completed(partKey),cached=verifiedParts.get(partKey);
    if(cached&&hint?.result_commit===cached){
     // The graph/bytes were verified in this process. Immutable content cannot
     // change, but its mutable ref, current source and access must remain fresh.
     await allowed();const ref=await api.optional(`/git/ref/heads/${interpretationPartBranch(request)}`);
     if(ref?.object?.sha!==cached||ref.ref!==`refs/heads/${interpretationPartBranch(request)}`)fail('immutable_artifact_mismatch');
     observed={commit:cached};
    }else observed=await readInterpretationPart({api,base,request,expectedData:data_base64,assertCurrent});
    if(observed){
     if(hint&&hint.result_commit!==observed.commit)fail('immutable_artifact_mismatch');
     await allowed();await store.complete(partKey,observed.commit);
     if(verifiedParts.size>=1024)verifiedParts.delete(verifiedParts.keys().next().value);verifiedParts.set(partKey,observed.commit);continue;
    }
    if(hint)fail('immutable_artifact_mismatch');wire=part;break;
   }
   await store.reserve(wire);
  }
  await assertCurrent();
  if(submit&&await store.reserveDispatch(interpretationWireHash(wire),clock().toISOString())){
   await assertCurrent();
   try{await dispatchWorker(wire);}catch{fail('private_interpretation_pending');}
  }
  fail('private_interpretation_pending');
 }
 const serialized=fn=>{const next=queue.then(fn);queue=next.catch(()=>{});return next;};
 return Object.freeze({
  persistsTaskBookkeeping:true,
  dispatch(input){const snapshot=validateInterpretationWorkerCall(input);return serialized(async()=>{
   await allowed();
   const first=(await store.pending()).find(isRoot);
   if(first&&first.request_hash!==interpretationWorkerHash(snapshot))try{await run(first.call,{submit:false});}catch{}
   return run(snapshot);
  });},
  reconcilePending({limit=1}={}){return serialized(async()=>{
   await allowed();if(!Number.isInteger(limit)||limit<1||limit>20)fail('invalid_interpretation_task_call');
   const entries=(await store.pending()).filter(isRoot),counts={completed:0,pending:0,unresolved:0};
   const batch=entries.length?Array.from({length:Math.min(limit,entries.length)},(_,i)=>entries[(cursor+i)%entries.length]):[];
   cursor=entries.length?(cursor+batch.length)%entries.length:0;
   for(const entry of batch){try{await run(entry.call);counts.completed++;}
    catch(error){if(error.code==='private_interpretation_pending')counts.pending++;else counts.unresolved++;}}
   return counts;
  });}
 });
}
