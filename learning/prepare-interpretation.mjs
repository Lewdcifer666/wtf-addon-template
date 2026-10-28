// Trusted GitHub producer for scheduled AI input. No AI invocation, packet
// submission, search, activation or caller-selected evidence/digest to sign.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {GitHub} from './github.mjs';
import {LearningError,readArtifactJson,readImmutable,persistSealedState,requireTrustedAncestor} from './git-artifacts.mjs';
import {stableJson,digest} from './interpretation.mjs';
import {executeInterpretationWorker,readInterpretationWorkerResult,interpretationWorkerHash,interpretationWorkerError} from './interpretation-worker.mjs';
import {githubObservationProof,PROOF_REPOSITORY} from './observation-proof.mjs';
import {verifyEngineManifest} from './integrity.mjs';
const fail=code=>{throw new LearningError(code);};
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value),hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.sort().join();

export async function preparePrivateInterpretation({api,trustedRevision,proof,interpretationAccessAllowed=async()=>false}={}){
 const assertCurrent=async()=>{
  if(typeof interpretationAccessAllowed!=='function'||await interpretationAccessAllowed()!==true)fail('private_interpretation_access_held');
  if(api?.writable!==true)fail('private_interpretation_access_held');
  const metadata=await api.get('/');
  if(api.repository!==PROOF_REPOSITORY||metadata?.full_name!==PROOF_REPOSITORY||metadata.private!==true||metadata.default_branch!=='main')fail('private_repository_required');
  if(!sha(trustedRevision)||(await api.pinMain()).sha!==trustedRevision)fail('stale_input');
  if(await interpretationAccessAllowed()!==true)fail('private_interpretation_access_held');
 };
 await assertCurrent();const base=await api.pinMain();if(base.sha!==trustedRevision)fail('stale_input');
 const request={schema_version:1,operation:'request',request:{source_revision:trustedRevision}},requestHash=interpretationWorkerHash(request),branch=`learning/interpretation-prepared-${trustedRevision}`;
 const old=await api.optional(`/git/ref/heads/${branch}`);let completed=null;
 if(old){
  const raw=await readArtifactJson(api,old,'interpretation-prepared.json',{maxBytes:2*1024*1024}),record=raw.value,body=record?.body;
  if(raw.parent!==trustedRevision||!exact(record,['body','proof'])||!exact(body,['schema_version','kind','source_revision','request_hash','request_commit','pages'])
   ||body.schema_version!==1||body.kind!=='private_interpretation_input_prepared'||body.source_revision!==trustedRevision||body.request_hash!==requestHash||!sha(body.request_commit)
   ||!Array.isArray(body.pages)||body.pages.length>10000||body.pages.some((p,i)=>!exact(p,['page_index','commit','page_hash'])||p.page_index!==i||!sha(p.commit)||!hash(p.page_hash)))fail('invalid_interpretation_record');
  await proof.verify(record.proof,body,trustedRevision);
  const graph=await readImmutable(api,{base,branch,files:{'interpretation-prepared.json':stableJson(record)}});
  if(graph?.commit!==raw.commit.sha)fail('invalid_interpretation_record');completed=body;
 }
 let changed=false;
 const obtain=async(call,expectedCommit)=>{
  let saved=await readInterpretationWorkerResult({api,base,call,proof,assertCurrent});
  if(!saved){
   if(completed)fail('immutable_artifact_mismatch');
   await executeInterpretationWorker({api,trustedRevision,call,proof,interpretationAccessAllowed});changed=true;
   saved=await readInterpretationWorkerResult({api,base,call,proof,assertCurrent});
  }
  if(!saved||expectedCommit!==undefined&&saved.commit!==expectedCommit)fail('immutable_artifact_mismatch');return saved;
 };
 const descriptor=await obtain(request,completed?.request_commit),plan=descriptor.body.result;
 if(!Number.isInteger(plan.page_count)||plan.page_count<0||plan.page_count>10000||!Array.isArray(plan.page_hashes)||plan.page_hashes.length!==plan.page_count
  ||plan.page_hashes.some(value=>!hash(value))||!hash(plan.request_id)||completed&&completed.pages.length!==plan.page_count)fail('invalid_interpretation_record');
 const pages=[];
 for(let page_index=0;page_index<plan.page_count;page_index++){
  const call={schema_version:1,operation:'page',request:{source_revision:trustedRevision,request_id:plan.request_id,page_index}};
  const saved=await obtain(call,completed?.pages[page_index]?.commit),page=saved.body.result,page_hash=digest(stableJson(page));
  if(page.page_index!==page_index||page.page_count!==plan.page_count||page_hash!==plan.page_hashes[page_index]
   ||completed&&completed.pages[page_index].page_hash!==page_hash)fail('invalid_interpretation_record');
  pages.push({page_index,commit:saved.commit,page_hash});
 }
 if(!completed){
  const body={schema_version:1,kind:'private_interpretation_input_prepared',source_revision:trustedRevision,request_hash:requestHash,request_commit:descriptor.commit,pages};
  if(Buffer.byteLength(stableJson(body))>2*1024*1024-32768)fail('interpretation_submission_limit');
  await persistSealedState({api,base,branch,name:'interpretation-prepared.json',body,proof,assertCurrent});changed=true;
 }
 await assertCurrent();return {state:'interpretation_input_prepared',pages:pages.length,reused:!changed};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 Promise.resolve().then(async()=>{
  if(process.argv.length!==2||process.env.PRIVATE_INTERPRETATION_WORKER_ENABLED!=='true'||process.env.GITHUB_REPOSITORY!==PROOF_REPOSITORY
   ||process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_WORKFLOW_REF!==PROOF_REPOSITORY+'/.github/workflows/learning-finalize.yml@refs/heads/main'
   ||!['schedule','push','workflow_run','workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME))fail('private_interpretation_access_held');
  verifyEngineManifest(process.cwd());
  const api=new GitHub(PROOF_REPOSITORY,process.env.GH_TOKEN,{writable:true,cacheImmutable:true,batchBlobs:true});
  const proof=githubObservationProof({assertTriggerAncestor:(trigger,executed)=>requireTrustedAncestor(api,trigger,executed)});
  const result=await preparePrivateInterpretation({api,trustedRevision:process.env.LEARNING_TRUSTED_SHA,proof,interpretationAccessAllowed:async()=>true});
  console.log(JSON.stringify(result));
 }).catch(error=>{console.error(JSON.stringify({state:'pending',code:interpretationWorkerError(error)}));process.exitCode=1;});
}
