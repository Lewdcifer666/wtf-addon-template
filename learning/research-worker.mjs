// A single bounded trusted-main job executes a closed task call. The PC cannot
// submit a digest for signing, select code, publish, or write private Git refs.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Ajv from 'ajv';
import {GitHub} from './github.mjs';
import {digest,stableJson} from './interpretation.mjs';
import {GENRES} from './receipt.mjs';
import {berlinResearchDate} from './handoff.mjs';
import {LearningError,readArtifactJson,readImmutable,persistSealedState,persistArtifactAlias,requireTrustedAncestor} from './git-artifacts.mjs';
import {githubObservationProof,PROOF_REPOSITORY} from './observation-proof.mjs';
import {createPrivateResearchTaskAdapter,researchTaskCallSchema,privateTaskErrorCode} from './research-task-adapter.mjs';
import {createPublicSearchProvider} from './public-search.mjs';
import {recoverResearchSessionForVerification,restoreResearchSessionSearches,verifyResearchSessionCommit} from './research-session.mjs';
import {verifyEngineManifest} from './integrity.mjs';
import {reconcile} from './reconcile.mjs';

const validCall=new Ajv({strict:true,allErrors:false}).compile(researchTaskCallSchema());
const fail=code=>{throw new LearningError(code);};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...keys].sort().join('|');
const sha=s=>typeof s==='string'&&/^[a-f0-9]{40}$/.test(s);
const hash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const uuid=s=>typeof s==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(s);
export function validateWorkerCall(value){
 if(!validCall(value)||Buffer.byteLength(stableJson(value))>16384)fail('invalid_task_call');
 return structuredClone(value);
}
export const workerRequestHash=value=>digest(stableJson(validateWorkerCall(value)));

function validateHeads(heads){
 if(!exact(heads,['private','public'])||!sha(heads.private)||!exact(heads.public,GENRES)||!GENRES.every(g=>sha(heads.public[g])))fail('invalid_task_record');
}
function validateRecord(body,kind){
 if(kind==='ticket'){
  if(!exact(body,['schema_version','kind','request_hash','open_request','task_token','session_id','source_heads'])||body.schema_version!==1
   ||body.kind!=='private_task_ticket'||!uuid(body.task_token)||!hash(body.session_id)
   ||body.request_hash!==workerRequestHash({schema_version:1,operation:'open',request:body.open_request}))fail('invalid_task_record');
 }else{
  if(!exact(body,['schema_version','kind','request_hash','call','result','session_id','source_heads'])||body.schema_version!==1
   ||body.kind!=='private_task_result'||body.request_hash!==workerRequestHash(body.call)||!hash(body.session_id)
   ||!body.result||typeof body.result!=='object'||Array.isArray(body.result)||body.result.schema_version!==1)fail('invalid_task_record');
 }
 validateHeads(body.source_heads);
}

export async function readWorkerRecord({api,base,branch,kind,proof,assertCurrent=async()=>{}}){
 if(api?.repository!==PROOF_REPOSITORY)fail('private_repository_required');
 const metadata=await api.get('/');
 if(metadata.full_name!==PROOF_REPOSITORY||metadata.private!==true||metadata.default_branch!=='main')fail('private_repository_required');
 const pattern=kind==='ticket'?/^learning\/task-(?:ticket-[a-f0-9]{64}|token-[a-f0-9-]{36})$/:/^learning\/task-result-[a-f0-9]{64}$/;
 if(!pattern.test(branch)||!sha(base?.sha)||typeof proof?.verify!=='function')fail('invalid_task_record');
 const ref=await api.optional(`/git/ref/heads/${branch}`);if(!ref)return null;
 const name=kind==='ticket'?'task-ticket.json':'task-result.json';
 const raw=await readArtifactJson(api,ref,name,{maxBytes:1024*1024}),record=raw.value;
 if(raw.parent!==base.sha||!exact(record,['body','proof']))fail('invalid_task_record');
 validateRecord(record.body,kind);
 const expected=kind==='result'?`learning/task-result-${record.body.request_hash}`:
  branch.startsWith('learning/task-token-')?`learning/task-token-${record.body.task_token}`:`learning/task-ticket-${record.body.request_hash}`;
 if(branch!==expected)fail('invalid_task_record');
 if(record.body.source_heads.private!==base.sha)fail('stale_input');
 await proof.verify(record.proof,record.body,base.sha);
 const graph=await readImmutable(api,{base,branch,files:{[name]:stableJson(record)}});
 if(graph?.commit!==raw.commit.sha)fail('invalid_task_record');
 await assertCurrent();return {commit:raw.commit.sha,branch,name,record,body:record.body};
}

export async function assertWorkerHeads({api,publicApis,heads,request,operation,researchCommit,clock=()=>new Date()}){
 validateHeads(heads);
 const metadata=await api.get('/');
 if(metadata.private!==true||metadata.full_name!==PROOF_REPOSITORY||metadata.default_branch!=='main'||api.repository!==PROOF_REPOSITORY||(await api.pinMain()).sha!==heads.private
  ||request.private_revision!==heads.private||request.public_revision!==heads.public[request.genre]
  ||request.research_date!==berlinResearchDate(clock()))fail('stale_input');
 for(const genre of GENRES)if(publicApis[genre]?.repository!==`Lewdcifer666/wtf-${genre}-stremio`||(await publicApis[genre].pinMain()).sha!==heads.public[genre])fail('stale_input');
 const branch=`research/${request.research_date}-${request.genre}`,ref=await publicApis[request.genre].optional(`/git/ref/heads/${branch}`);
 if(operation==='verify'){
  if(ref?.ref!==`refs/heads/${branch}`||ref.object?.sha!==researchCommit)fail('stale_input');
 }else if(ref&&(ref.ref!==`refs/heads/${branch}`||ref.object?.sha!==request.public_revision))fail('research_already_staged');
 if(request.research_date!==berlinResearchDate(clock()))fail('stale_input');
}

export async function executeResearchWorker({api,publicApis,trustedRevision,proof,clock=()=>new Date(),call,
 searchProvider=null,taskAccessAllowed=async()=>false}){
 const copied=validateWorkerCall(call);
 // Independent server-owned hold precedes metadata reads, signing or searches.
 if(typeof taskAccessAllowed!=='function'||await taskAccessAllowed()!==true)fail('private_task_access_held');
 const metadata=await api.get('/');
 if(api.repository!==PROOF_REPOSITORY||metadata.full_name!==PROOF_REPOSITORY||metadata.private!==true||metadata.default_branch!=='main')fail('private_repository_required');
 const base=await api.pinMain();if(base.sha!==trustedRevision)fail('stale_input');
 const requestHash=workerRequestHash(copied),branch=`learning/task-result-${requestHash}`;
 let ticket=null,request;
 if(copied.operation==='open')request=copied.request;
 else{
  ticket=await readWorkerRecord({api,base,branch:`learning/task-token-${copied.request.task_token}`,kind:'ticket',proof});
  if(!ticket||ticket.body.task_token!==copied.request.task_token)fail('unknown_task_session');
  request=ticket.body.open_request;
 }
 const assertCurrent=heads=>assertWorkerHeads({api,publicApis,heads,request,operation:copied.operation,researchCommit:copied.request.research_commit,clock});
 const existing=await readWorkerRecord({api,base,branch,kind:'result',proof});
 if(existing){
  if(stableJson(existing.body.call)!==stableJson(copied)||(ticket&&existing.body.session_id!==ticket.body.session_id))fail('invalid_task_record');
  await assertCurrent(existing.body.source_heads);return {state:'completed',request_hash:requestHash,commit:existing.commit,reused:true};
 }
 if(copied.operation==='open'){
  const priorTicket=await readWorkerRecord({api,base,branch:`learning/task-ticket-${requestHash}`,kind:'ticket',proof});
  if(priorTicket){
   // An interrupted/frozen session is recovered, never replaced by a fresh
   // policy tuple or new provenance after a search could already have run.
   if(stableJson(priorTicket.body.open_request)!==stableJson(request))fail('invalid_task_record');
   await assertCurrent(priorTicket.body.source_heads);
  }else{
   // Another genre may have published since hourly reconciliation. Refresh
   // deterministic state BEFORE a genuinely new session and before research.
   const heads={private:base.sha,public:Object.fromEntries(await Promise.all(GENRES.map(async genre=>[genre,(await publicApis[genre].pinMain()).sha])))};
   await assertCurrent(heads);
   const refreshed=await reconcile({api,publicApis,trustedRevision,proof,clock,accessAllowed:taskAccessAllowed});
   if(refreshed.state!=='computed_active')fail(refreshed.state==='awaiting_interpretation'?'interpretation_not_staged':'learning_inactive');
   await assertCurrent(heads);
  }
 }
 let result,heads,sessionId;
 if(copied.operation==='verify'){
  const session=await recoverResearchSessionForVerification({api,publicApis,trustedRevision,proof,clock,request,researchCommit:copied.request.research_commit});
  if(session.session_id!==ticket.body.session_id)fail('invalid_task_record');
  const saved=await restoreResearchSessionSearches(session);
  const verified=await verifyResearchSessionCommit({session,researchCommit:copied.request.research_commit,searches:saved.map(s=>s.handle)});
  result={schema_version:1,kind:'private_task_research_verification',session_id:session.session_id,research_commit:verified.trace.research_commit,
   search_adapter_invocations_observed:verified.search_adapter_invocations_observed,actual_context_use_verified:false,behavioral_effect_observed:false};
  heads=ticket.body.source_heads;sessionId=session.session_id;
 }else{
  const adapter=createPrivateResearchTaskAdapter({api,publicApis,trustedRevision,proof,clock,searchProvider,taskAccessAllowed});
  const opened=await adapter.dispatch({schema_version:1,operation:'open',request});
  heads=opened.response.source_heads;sessionId=opened.response.session_id;
  await assertCurrent(heads);
  if(!ticket){
   const ticketBranch=`learning/task-ticket-${requestHash}`;
   ticket=await readWorkerRecord({api,base,branch:ticketBranch,kind:'ticket',proof,assertCurrent:()=>assertCurrent(heads)});
   if(!ticket){
    const body={schema_version:1,kind:'private_task_ticket',request_hash:requestHash,open_request:request,
     task_token:opened.task_token,session_id:sessionId,source_heads:heads};
    await persistSealedState({api,base,branch:ticketBranch,name:'task-ticket.json',body,proof,assertCurrent:()=>assertCurrent(heads)});
    ticket=await readWorkerRecord({api,base,branch:ticketBranch,kind:'ticket',proof,assertCurrent:()=>assertCurrent(heads)});
   }
   if(!ticket)fail('invalid_task_record');
   if(ticket.body.session_id!==sessionId||stableJson(ticket.body.open_request)!==stableJson(request)||stableJson(ticket.body.source_heads)!==stableJson(heads))fail('stale_input');
   await persistArtifactAlias(api,{base,original:{branch:ticket.branch,commit:ticket.commit},branch:`learning/task-token-${ticket.body.task_token}`,
    files:{'task-ticket.json':stableJson(ticket.record)},assertCurrent:()=>assertCurrent(heads)});
  }
  if(ticket.body.session_id!==sessionId||stableJson(ticket.body.open_request)!==stableJson(request)||stableJson(ticket.body.source_heads)!==stableJson(heads))fail('stale_input');
  if(copied.operation==='open'||copied.operation==='context')result={...opened,task_token:ticket.body.task_token};
  else result=await adapter.dispatch({...copied,request:{...copied.request,task_token:opened.task_token}});
 }
 const body={schema_version:1,kind:'private_task_result',request_hash:requestHash,call:copied,result,session_id:sessionId,source_heads:heads};
 if(Buffer.byteLength(stableJson(body))>512*1024)fail('session_journal_limit');
 await assertCurrent(heads);
 const persisted=await persistSealedState({api,base,branch,name:'task-result.json',body,proof,assertCurrent:()=>assertCurrent(heads)});
 return {state:'completed',request_hash:requestHash,commit:persisted.commit,reused:persisted.reused};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 Promise.resolve().then(async()=>{
  // The workflow grants OIDC only to this bounded main-only worker job.
  if(process.env.PRIVATE_RESEARCH_WORKER_ENABLED!=='true'||process.env.GITHUB_REPOSITORY!==PROOF_REPOSITORY
   ||process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_EVENT_NAME!=='workflow_dispatch'
   ||process.env.GITHUB_WORKFLOW_REF!==PROOF_REPOSITORY+'/.github/workflows/learning-finalize.yml@refs/heads/main'
   ||process.argv.length!==2)fail('private_task_access_held');
  verifyEngineManifest(process.cwd());
  // Read GitHub's private event file, not an Actions env declaration whose
  // automatic step header would print the private query into workflow logs.
  const eventFile=process.env.GITHUB_EVENT_PATH;
  if(typeof eventFile!=='string')fail('invalid_task_call');
  const stat=fs.lstatSync(eventFile);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>128*1024)fail('invalid_task_call');
  const raw=fs.readFileSync(eventFile),eventText=raw.toString('utf8');
  if(!Buffer.from(eventText,'utf8').equals(raw))fail('invalid_task_call');
  const event=JSON.parse(eventText),text=event?.inputs?.task_request??'';
  if(typeof text!=='string'||Buffer.byteLength(text)>16384)fail('invalid_task_call');
  let call;try{call=JSON.parse(text);}catch{fail('invalid_task_call');}
  validateWorkerCall(call);
  const api=new GitHub(PROOF_REPOSITORY,process.env.GH_TOKEN,{writable:true,cacheImmutable:true}),publicApis=Object.fromEntries(GENRES.map(g=>[g,new GitHub(`Lewdcifer666/wtf-${g}-stremio`,process.env.GH_TOKEN,{cacheImmutable:true})]));
  const proof=githubObservationProof({assertTriggerAncestor:(trigger,executed)=>requireTrustedAncestor(api,trigger,executed)});
  const result=await executeResearchWorker({api,publicApis,trustedRevision:process.env.LEARNING_TRUSTED_SHA,proof,call,
   searchProvider:createPublicSearchProvider(),taskAccessAllowed:async()=>true});
  // No query, context, task token, feedback, proof or result in Actions logs.
  console.log(JSON.stringify({state:result.state,reused:result.reused}));
 }).catch(error=>{console.error(JSON.stringify({state:'pending',code:privateTaskErrorCode(error)}));process.exitCode=1;});
}
