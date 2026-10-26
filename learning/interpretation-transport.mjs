// Complete-packet transport around GitHub's bounded dispatch input. Parts are
// UNSIGNED transport data; only full source/quote validation can mint a receipt.
import Ajv from 'ajv';
import {digest,stableJson} from './interpretation.mjs';
import {LearningError,readArtifactJson,readImmutable,persistImmutable} from './git-artifacts.mjs';
import {PROOF_REPOSITORY} from './observation-proof.mjs';
import {createPrivateInterpretationTaskAdapter} from './interpretation-task.mjs';
import {interpretationWorkerCallSchema,validateInterpretationWorkerCall,interpretationWorkerHash,executeInterpretationWorker} from './interpretation-worker.mjs';
const fail=code=>{throw new LearningError(code);};
const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const sha={type:'string',pattern:'^[a-f0-9]{40}$'},hash={type:'string',pattern:'^[a-f0-9]{64}$'},size=40*1024;
const metadata={source_revision:sha,request_id:hash,packet_hash:hash,part_count:{type:'integer',minimum:1,maximum:32},packet_bytes:{type:'integer',minimum:1,maximum:1024*1024}};
const wireSchema={oneOf:[...interpretationWorkerCallSchema().oneOf,...['part','assemble'].map(operation=>object({schema_version:{const:1},operation:{const:operation},
 request:object(operation==='part'?{...metadata,part_index:{type:'integer',minimum:0,maximum:31},data_base64:{type:'string',minLength:4,maxLength:4*Math.ceil(size/3),pattern:'^[A-Za-z0-9+/]+={0,2}$'}}:{...metadata,target_operation:{enum:['validate','submit']}})}))]};
const validWire=new Ajv({strict:true,allErrors:false}).compile(wireSchema);
const validPartMetadata=new Ajv({strict:true,allErrors:false}).compile(object({...metadata,part_index:{type:'integer',minimum:0,maximum:31}}));
export const interpretationWireCallSchema=()=>structuredClone(wireSchema);
export function validateInterpretationWireCall(input){
 if(!validWire(input))fail('invalid_interpretation_task_call');
 if(!['part','assemble'].includes(input.operation))return validateInterpretationWorkerCall(input);
 const r=input.request;
 if(r.part_count!==Math.ceil(r.packet_bytes/size)||input.operation==='part'&&r.part_index>=r.part_count)fail('invalid_interpretation_task_call');
 const request={source_revision:r.source_revision,request_id:r.request_id,packet_hash:r.packet_hash,part_count:r.part_count,packet_bytes:r.packet_bytes};
 if(input.operation==='part'){
  const data=Buffer.from(r.data_base64,'base64'),length=r.part_index===r.part_count-1?r.packet_bytes-size*(r.part_count-1):size;
  if(data.length!==length||data.toString('base64')!==r.data_base64)fail('invalid_interpretation_task_call');
  request.part_index=r.part_index;request.data_base64=r.data_base64;
 }else request.target_operation=r.target_operation;
 return {schema_version:1,operation:input.operation,request};
}
export const interpretationWireHash=input=>{const call=validateInterpretationWireCall(input);return ['part','assemble'].includes(call.operation)?digest(stableJson(call)):interpretationWorkerHash(call);};
export const interpretationDispatchBody=call=>JSON.stringify({ref:'main',inputs:{dry_run:false,interpretation_request:stableJson(validateInterpretationWireCall(call))}});
export function interpretationTransportPlan(input){
 const call=validateInterpretationWorkerCall(input);
 if(Buffer.byteLength(interpretationDispatchBody(call))<=60000)return {inline:true,call};
 if(!['validate','submit'].includes(call.operation))fail('interpretation_submission_limit');
 const bytes=Buffer.from(stableJson(call.request.packet)),common={source_revision:call.request.source_revision,request_id:call.request.request_id,
  packet_hash:digest(bytes),part_count:Math.ceil(bytes.length/size),packet_bytes:bytes.length};
 const parts=Array.from({length:common.part_count},(_,part_index)=>validateInterpretationWireCall({schema_version:1,operation:'part',request:{...common,part_index,
  data_base64:bytes.subarray(part_index*size,(part_index+1)*size).toString('base64')}}));
 return {inline:false,parts,assembly:validateInterpretationWireCall({schema_version:1,operation:'assemble',request:{...common,target_operation:call.operation}})};
}
const branchFor=request=>`learning/interpretation-part-${request.source_revision}-${request.packet_hash}-${String(request.part_index).padStart(2,'0')}`;
function requirePartMetadata(request){if(!validPartMetadata(request)||request.part_count!==Math.ceil(request.packet_bytes/size)||request.part_index>=request.part_count)fail('invalid_interpretation_task_call');}
export function interpretationPartBranch(request){
 requirePartMetadata(request);return branchFor(request);
}
export async function readInterpretationPart({api,base,request,assertCurrent,expectedData}={}){
 if(typeof assertCurrent!=='function')fail('private_interpretation_access_held');requirePartMetadata(request);await assertCurrent();
 const metadata=await api.get('/');
 if(api.repository!==PROOF_REPOSITORY||metadata?.full_name!==PROOF_REPOSITORY||metadata.private!==true||metadata.default_branch!=='main')fail('private_repository_required');
 if(base?.sha!==request.source_revision)fail('stale_input');
 const ref=await api.optional(`/git/ref/heads/${branchFor(request)}`);if(!ref)return null;
 const raw=await readArtifactJson(api,ref,'interpretation-part.json',{maxBytes:64*1024}),body=raw.value;
 if(raw.parent!==base.sha||!body||Object.keys(body).sort().join()!=='call,kind,schema_version'||body.schema_version!==1||body.kind!=='private_interpretation_transport_part')fail('invalid_interpretation_record');
 const call=validateInterpretationWireCall(body.call);
 if(call.operation!=='part'||stableJson(call)!==stableJson(body.call))fail('invalid_interpretation_record');
 const {data_base64,...meta}=call.request;
 if(stableJson(meta)!==stableJson(request)||expectedData!==undefined&&data_base64!==expectedData)fail('immutable_artifact_mismatch');
 const graph=await readImmutable(api,{base,branch:branchFor(request),files:{'interpretation-part.json':stableJson(body)}});
 if(graph?.commit!==raw.commit.sha)fail('invalid_interpretation_record');
 await assertCurrent();return {commit:raw.commit.sha,data:Buffer.from(data_base64,'base64')};
}
export async function executeInterpretationWireWorker(options={}){
 const call=validateInterpretationWireCall(options.call);
 if(!['part','assemble'].includes(call.operation))return executeInterpretationWorker({...options,call});
 const {api,trustedRevision,interpretationAccessAllowed=async()=>false}=options,r=call.request;
 const assertCurrent=async()=>{
  if(typeof interpretationAccessAllowed!=='function'||await interpretationAccessAllowed()!==true)fail('private_interpretation_access_held');
  const metadata=await api.get('/');
  if(api.repository!==PROOF_REPOSITORY||metadata?.full_name!==PROOF_REPOSITORY||metadata.private!==true||metadata.default_branch!=='main')fail('private_repository_required');
  if(trustedRevision!==r.source_revision||(await api.pinMain()).sha!==trustedRevision)fail('stale_input');
  if(await interpretationAccessAllowed()!==true)fail('private_interpretation_access_held');
 };
 await assertCurrent();const base=await api.pinMain();if(base.sha!==trustedRevision)fail('stale_input');
 if(call.operation==='part'){
  // These bytes are UNTRUSTED transport, never a signed/validated interpretation.
  // Do not reload all feedback for every part; assembly validates the full source.
  const {data_base64,...request}=r;
  const existing=await readInterpretationPart({api,base,request,expectedData:data_base64,assertCurrent});
  if(existing)return {state:'interpretation_part_staged',commit:existing.commit,reused:true};
  const body={schema_version:1,kind:'private_interpretation_transport_part',call};
  const saved=await persistImmutable(api,{base,branch:branchFor(r),files:{'interpretation-part.json':stableJson(body)},assertCurrent});
  const read=await readInterpretationPart({api,base,request,expectedData:data_base64,assertCurrent});
  if(!read||read.commit!==saved.commit)fail('invalid_interpretation_record');
  return {state:'interpretation_part_staged',commit:saved.commit,reused:saved.reused};
 }
 const adapter=createPrivateInterpretationTaskAdapter({api,trustedRevision,interpretationAccessAllowed});
 const plan=await adapter.dispatch({schema_version:1,operation:'request',request:{source_revision:trustedRevision}});
 if(plan.request_id!==r.request_id)fail('stale_input');
 const parts=[];
 const {target_operation,...partMetadata}=r;
 for(let part_index=0;part_index<r.part_count;part_index++){
  const part=await readInterpretationPart({api,base,request:{...partMetadata,part_index},assertCurrent});
  if(!part)fail('private_interpretation_pending');parts.push(part.data);
 }
 const bytes=Buffer.concat(parts),text=bytes.toString('utf8');
 if(bytes.length!==r.packet_bytes||digest(bytes)!==r.packet_hash||!Buffer.from(text).equals(bytes))fail('invalid_interpretation');
 let packet;try{packet=JSON.parse(text);}catch{fail('invalid_interpretation');}
 const submit=validateInterpretationWorkerCall({schema_version:1,operation:target_operation,request:{source_revision:r.source_revision,request_id:r.request_id,packet}});
 if(stableJson(submit.request.packet)!==text)fail('invalid_interpretation');
 // Only complete semantic validation below may stage the real interpretation,
 // sign a submission receipt or enter deterministic aggregation.
 return executeInterpretationWorker({...options,call:submit});
}
