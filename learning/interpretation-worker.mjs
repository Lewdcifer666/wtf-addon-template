// Bounded trusted-main interpretation transport and private packet ingestion.
// No AI API, public writes, activation change or caller-selected destination.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Ajv from 'ajv';
import {digest,gitBlobOid,stableJson} from './interpretation.mjs';
import {createPrivateInterpretationTaskAdapter,interpretationTaskCallSchema} from './interpretation-task.mjs';
import {LearningError,readArtifactJson,readImmutable,persistSealedState,requirePacketDiff,requireTrustedAncestor} from './git-artifacts.mjs';
import {githubObservationProof,PROOF_REPOSITORY} from './observation-proof.mjs';
import {GitHub} from './github.mjs';
import {GENRES} from './receipt.mjs';
import {reconcile} from './reconcile.mjs';
import {verifyEngineManifest} from './integrity.mjs';

const fail=code=>{throw new LearningError(code);};
const sha=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===[...keys].sort().join('|');
const callSchema=interpretationTaskCallSchema(),submitSchema=structuredClone(callSchema.oneOf.find(v=>v.properties.operation.const==='validate'));
submitSchema.properties.operation.const='submit';callSchema.oneOf.push(submitSchema);
const validCall=new Ajv({strict:true,allErrors:false}).compile(callSchema);
const canonicalPacket=p=>({schema_version:p.schema_version,source_revision:p.source_revision,request_id:p.request_id,
 interpretations:p.interpretations.map(i=>({feedback_id:i.feedback_id,raw_blob_oid:i.raw_blob_oid,status:i.status,
  statements:i.statements.map(s=>({category:s.category,aspect:s.aspect,meaning:s.meaning,scope:s.scope,quote:s.quote,confidence:s.confidence}))
   .sort((a,b)=>{const x=a.category+':'+a.aspect,y=b.category+':'+b.aspect;return x<y?-1:x>y?1:0;})}))
  .sort((a,b)=>a.feedback_id<b.feedback_id?-1:a.feedback_id>b.feedback_id?1:0)});
export const interpretationWorkerCallSchema=()=>structuredClone(callSchema);
export function validateInterpretationWorkerCall(input){
 if(!validCall(input))fail('invalid_interpretation_task_call');
 const request={source_revision:input.request.source_revision};
 if(input.operation!=='request')request.request_id=input.request.request_id;
 if(input.operation==='page')request.page_index=input.request.page_index;
 if(input.request.packet)request.packet=canonicalPacket(input.request.packet);
 const call={schema_version:1,operation:input.operation,request};
 // Stay below GitHub's65,535-character input limit INCLUDING outer JSON escaping.
 if(Buffer.byteLength(JSON.stringify({ref:'main',inputs:{dry_run:false,interpretation_request:stableJson(call)}}))>60000)fail('interpretation_submission_limit');
 return call;
}
export const interpretationWorkerHash=input=>digest(stableJson(validateInterpretationWorkerCall(input)));

async function currentPrivate(api,revision,allowed){
 if(await allowed()!==true)fail('private_interpretation_access_held');
 const metadata=await api.get('/');
 if(api.repository!==PROOF_REPOSITORY||metadata?.full_name!==PROOF_REPOSITORY||metadata.private!==true||metadata.default_branch!=='main')fail('private_repository_required');
 if(!sha(revision)||(await api.pinMain()).sha!==revision)fail('stale_input');
 if(await allowed()!==true)fail('private_interpretation_access_held');
}
const packetLocation=call=>({branch:`interpretation/${call.request.source_revision}`,
 path:`learning-inbox/${call.request.source_revision}/${call.request.request_id}.json`});
async function readStaged(api,base,call,assertCurrent,expectedCommit=null){
 const {branch,path:packetPath}=packetLocation(call),ref=await api.optional(`/git/ref/heads/${branch}`);
 if(!ref)return null;
 if(ref.ref!==`refs/heads/${branch}`||!sha(ref.object?.sha)||expectedCommit!==null&&ref.object.sha!==expectedCommit)fail('immutable_artifact_mismatch');
 const commit=await api.get(`/git/commits/${ref.object.sha}`);
 if(commit?.sha!==ref.object.sha||!sha(commit.tree?.sha))fail('invalid_interpretation');
 requirePacketDiff(await api.get(`/compare/${base.sha}...${commit.sha}`),base.sha,packetPath);
 const tree=await api.get(`/git/trees/${commit.tree.sha}?recursive=1`);
 if(tree?.sha!==commit.tree.sha||tree.truncated!==false||!Array.isArray(tree.tree))fail('invalid_interpretation');
 const entry=tree.tree.find(e=>e.path===packetPath);
 if(entry?.type!=='blob'||entry.mode!=='100644'||!sha(entry.sha)||!Number.isSafeInteger(entry.size)||entry.size<1||entry.size>1024*1024)fail('invalid_interpretation');
 const blob=await api.get(`/git/blobs/${entry.sha}`);
 if(blob?.encoding!=='base64'||blob.size!==entry.size||typeof blob.content!=='string'||blob.content.length>2*1024*1024)fail('invalid_interpretation');
 const bytes=Buffer.from(blob.content,'base64'),text=bytes.toString('utf8');
 if(bytes.length!==entry.size||gitBlobOid(bytes)!==entry.sha||!Buffer.from(text).equals(bytes))fail('invalid_interpretation');
 let stored;try{stored=validateInterpretationWorkerCall({...call,request:{...call.request,packet:JSON.parse(text)}}).request.packet;}catch{fail('invalid_interpretation');}
 if(stableJson(stored)!==stableJson(call.request.packet))fail('immutable_artifact_mismatch');
 await assertCurrent();return {commit:commit.sha,branch,packet_path:packetPath,reused:true};
}
async function stagePacket({api,base,call,assertCurrent}){
 const existing=await readStaged(api,base,call,assertCurrent);if(existing)return existing;
 const {branch,path:packetPath}=packetLocation(call),content=stableJson(call.request.packet);
 const sourceTree=await api.get(`/git/trees/${base.tree.sha}?recursive=1`);
 if(sourceTree?.sha!==base.tree.sha||sourceTree.truncated!==false||!Array.isArray(sourceTree.tree)||sourceTree.tree.some(e=>e.path===packetPath))fail('invalid_interpretation');
 await assertCurrent();
 const blob=await api.post('/git/blobs',{content,encoding:'utf-8'});
 if(blob.sha!==gitBlobOid(content))fail('artifact_blob_mismatch');
 const tree=await api.post('/git/trees',{base_tree:base.tree.sha,tree:[{path:packetPath,mode:'100644',type:'blob',sha:blob.sha}]});
 if(!sha(tree?.sha))fail('artifact_blob_mismatch');
 const commit=await api.post('/git/commits',{message:'Stage validated private feedback interpretation',tree:tree.sha,parents:[base.sha]});
 if(!sha(commit?.sha))fail('artifact_blob_mismatch');
 await assertCurrent();
 try{await api.post('/git/refs',{ref:`refs/heads/${branch}`,sha:commit.sha});}
 catch(error){
  if(![409,422].includes(error.status)&&error.code!=='transport_failure'&&!(error.code==='github_request_failed'&&error.status>=500))throw error;
  // A read-only recovery of this same ref is not another write or AI invocation.
  const recovered=await readStaged(api,base,call,assertCurrent);if(!recovered)throw error;return recovered;
 }
 const saved=await readStaged(api,base,call,assertCurrent,commit.sha);
 if(!saved)fail('invalid_interpretation');return {...saved,reused:false};
}

export async function readInterpretationWorkerResult({api,base,call:input,proof,assertCurrent}){
 if(typeof assertCurrent!=='function')fail('private_interpretation_access_held');
 await assertCurrent();
 const call=validateInterpretationWorkerCall(input),key=interpretationWorkerHash(call),branch=`learning/interpretation-result-${key}`;
 const metadata=await api.get('/');
 if(api.repository!==PROOF_REPOSITORY||metadata?.full_name!==PROOF_REPOSITORY||metadata.private!==true||metadata.default_branch!=='main')fail('private_repository_required');
 if(base?.sha!==call.request.source_revision)fail('stale_input');
 const ref=await api.optional(`/git/ref/heads/${branch}`);if(!ref)return null;
 const raw=await readArtifactJson(api,ref,'interpretation-result.json',{maxBytes:512*1024}),record=raw.value;
 if(raw.parent!==base.sha||!exact(record,['body','proof']))fail('invalid_interpretation_record');
 const body=record.body;
 if(!exact(body,['schema_version','kind','request_hash','source_revision','call','result'])||body.schema_version!==1
  ||body.kind!=='private_interpretation_task_result'||body.request_hash!==key||body.source_revision!==base.sha
  ||stableJson(body.call)!==stableJson(call)||body.result?.schema_version!==1||body.result.source_revision!==base.sha)fail('invalid_interpretation_record');
 const kinds={request:'private_interpretation_request',page:'private_interpretation_page',validate:'private_interpretation_validation',submit:'private_interpretation_staged'};
 if(body.result.kind!==kinds[call.operation]||!hash(body.result.request_id)||call.operation!=='request'&&body.result.request_id!==call.request.request_id)fail('invalid_interpretation_record');
 await proof.verify(record.proof,body,base.sha);
 const graph=await readImmutable(api,{base,branch,files:{'interpretation-result.json':stableJson(record)}});
 if(graph?.commit!==raw.commit.sha)fail('invalid_interpretation_record');
 if(call.operation==='submit'){
  const location=packetLocation(call);
  if(!exact(body.result,['schema_version','kind','source_revision','request_id','packet_hash','branch','packet_path','interpretation_commit','validated','staged','activation_changed'])
   ||body.result.packet_hash!==digest(stableJson(call.request.packet))||body.result.branch!==location.branch||body.result.packet_path!==location.path
   ||!sha(body.result.interpretation_commit)||body.result.validated!==true||body.result.staged!==true||body.result.activation_changed!==false)fail('invalid_interpretation_record');
  // A lost frozen packet cannot silently be recreated from a completed hint.
  if(!await readStaged(api,base,call,assertCurrent,body.result.interpretation_commit))fail('invalid_interpretation_record');
 }
 await assertCurrent();return {commit:raw.commit.sha,branch,body};
}

export async function executeInterpretationWorker({api,publicApis,trustedRevision,call:input,proof,
 interpretationAccessAllowed=async()=>false,reconcileAfterSubmit=reconcile}={}){
 const call=validateInterpretationWorkerCall(input);
 if(typeof interpretationAccessAllowed!=='function'||await interpretationAccessAllowed()!==true)fail('private_interpretation_access_held');
 if(call.request.source_revision!==trustedRevision)fail('stale_input');
 const assertCurrent=()=>currentPrivate(api,trustedRevision,interpretationAccessAllowed);
 await assertCurrent();const base=await api.pinMain();if(base.sha!==trustedRevision)fail('stale_input');
 const adapter=createPrivateInterpretationTaskAdapter({api,trustedRevision,interpretationAccessAllowed});
 const validationCall=call.operation==='submit'?{...call,operation:'validate'}:call;
 // ALWAYS recompute current source validation, including when a result exists.
 const prepared=await adapter.dispatch(validationCall);
 let saved=await readInterpretationWorkerResult({api,base,call,proof,assertCurrent}),reused=Boolean(saved);
 if(saved&&call.operation!=='submit'&&stableJson(saved.body.result)!==stableJson(prepared))fail('invalid_interpretation_record');
 if(!saved){
  let result=prepared;
  if(call.operation==='submit'){
   const staged=await stagePacket({api,base,call,assertCurrent});
   result={schema_version:1,kind:'private_interpretation_staged',source_revision:trustedRevision,request_id:call.request.request_id,
    packet_hash:digest(stableJson(call.request.packet)),branch:staged.branch,packet_path:staged.packet_path,
    interpretation_commit:staged.commit,validated:true,staged:true,activation_changed:false};
  }
  const body={schema_version:1,kind:'private_interpretation_task_result',request_hash:interpretationWorkerHash(call),source_revision:trustedRevision,call,result};
  if(Buffer.byteLength(stableJson(body))>384*1024)fail('interpretation_submission_limit');
  await assertCurrent();
  await persistSealedState({api,base,branch:`learning/interpretation-result-${body.request_hash}`,name:'interpretation-result.json',body,proof,assertCurrent});
  saved=await readInterpretationWorkerResult({api,base,call,proof,assertCurrent});if(!saved)fail('invalid_interpretation_record');
 }
 // GITHUB_TOKEN Git writes do not wake push workflows. Recompute in this same
 // bounded job; if interrupted, normal hourly reconciliation retains recovery.
 let aggregation=null;
 if(call.operation==='submit'){
  await assertCurrent();
  aggregation=await reconcileAfterSubmit({api,publicApis,trustedRevision,proof,accessAllowed:interpretationAccessAllowed});
 }
 await assertCurrent();
 return {state:call.operation==='submit'?'interpretation_staged':'completed',request_hash:interpretationWorkerHash(call),commit:saved.commit,reused,
  ...(aggregation?{reconciliation:{state:aggregation.state}}:{})};
}

const safeErrors=new Set(['invalid_interpretation_task_call','interpretation_submission_limit','private_interpretation_access_held',
 'private_repository_required','stale_input','invalid_source','invalid_interpretation','invalid_interpretation_record','immutable_artifact_mismatch','private_task_access_held',
 'unauthorized_packet_changes','github_request_failed','transport_failure','proof_credentials_required','proof_key_unavailable','proof_transport_failure','invalid_observation_proof']);
export const interpretationWorkerError=error=>safeErrors.has(error?.code)?error.code:'private_interpretation_pending';
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 Promise.resolve().then(async()=>{
  if(process.argv.length!==2||process.env.PRIVATE_INTERPRETATION_WORKER_ENABLED!=='true'||process.env.GITHUB_REPOSITORY!==PROOF_REPOSITORY
   ||process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_EVENT_NAME!=='workflow_dispatch'
   ||process.env.GITHUB_WORKFLOW_REF!==PROOF_REPOSITORY+'/.github/workflows/learning-finalize.yml@refs/heads/main')fail('private_interpretation_access_held');
  verifyEngineManifest(process.cwd());
  const eventFile=process.env.GITHUB_EVENT_PATH;if(typeof eventFile!=='string')fail('invalid_interpretation_task_call');
  const stat=fs.lstatSync(eventFile);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>256*1024)fail('invalid_interpretation_task_call');
  const bytes=fs.readFileSync(eventFile),text=bytes.toString('utf8');if(!Buffer.from(text).equals(bytes))fail('invalid_interpretation_task_call');
  const event=JSON.parse(text),inputs=event.inputs??{};
  if(inputs.task_request||inputs.consume_genre&&inputs.consume_genre!=='none'||![undefined,false,'false',''].includes(inputs.provenance_probe)
   ||![false,'false'].includes(inputs.dry_run)||typeof inputs.interpretation_request!=='string'||Buffer.byteLength(inputs.interpretation_request)>60000)fail('invalid_interpretation_task_call');
  let call;try{call=JSON.parse(inputs.interpretation_request);}catch{fail('invalid_interpretation_task_call');}
  const api=new GitHub(PROOF_REPOSITORY,process.env.GH_TOKEN,{writable:true,cacheImmutable:true});
  const publicApis=Object.fromEntries(GENRES.map(g=>[g,new GitHub(`Lewdcifer666/wtf-${g}-stremio`,process.env.GH_TOKEN,{cacheImmutable:true})]));
  const proof=githubObservationProof({assertTriggerAncestor:(trigger,executed)=>requireTrustedAncestor(api,trigger,executed)});
  const result=await executeInterpretationWorker({api,publicApis,trustedRevision:process.env.LEARNING_TRUSTED_SHA,call,proof,interpretationAccessAllowed:async()=>true});
  console.log(JSON.stringify({state:result.state,reused:result.reused,reconciliation:result.reconciliation?.state??null}));
 }).catch(error=>{console.error(JSON.stringify({state:'pending',code:interpretationWorkerError(error)}));process.exitCode=1;});
}
