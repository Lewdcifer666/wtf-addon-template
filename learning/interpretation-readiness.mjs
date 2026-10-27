// Read-only task readiness. No journal, dispatch, writer, signer or raw-feedback
// inventory. A frozen signed submission, not a branch name, proves acceptance.
import {LearningError,requirePacketDiff} from './git-artifacts.mjs';
import {gitBlobOid} from './interpretation.mjs';
import {PROOF_REPOSITORY} from './observation-proof.mjs';
import {validateInterpretationWorkerCall,readInterpretationWorkerResult} from './interpretation-worker.mjs';
const fail=code=>{throw new LearningError(code);};
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
export async function readPrivateInterpretationStatus({api,proof,interpretationAccessAllowed=async()=>false}={}){
 const current=async expected=>{
  if(typeof interpretationAccessAllowed!=='function'||await interpretationAccessAllowed()!==true)fail('private_interpretation_access_held');
  if(api?.writable!==false)fail('private_interpretation_access_held');
  const metadata=await api.get('/');
  if(api.repository!==PROOF_REPOSITORY||metadata?.full_name!==PROOF_REPOSITORY||metadata.private!==true||metadata.default_branch!=='main')fail('private_repository_required');
  const base=await api.pinMain();if(!sha(base?.sha)||!sha(base.tree?.sha)||expected!==null&&base.sha!==expected)fail('stale_input');
  if(await interpretationAccessAllowed()!==true)fail('private_interpretation_access_held');return base;
 };
 const base=await current(null),assertCurrent=()=>current(base.sha),branch=`interpretation/${base.sha}`,ref=await api.optional(`/git/ref/heads/${branch}`);
 const result=(state,extra={})=>({schema_version:1,kind:'private_interpretation_status',source_revision:base.sha,state,learning_activation:'not_asserted',...extra});
 if(!ref){await assertCurrent();return result('interpretation_needed');}
 if(ref.ref!==`refs/heads/${branch}`||!sha(ref.object?.sha))fail('invalid_interpretation_record');
 const commit=await api.get(`/git/commits/${ref.object.sha}`);
 if(commit?.sha!==ref.object.sha||!sha(commit.tree?.sha))fail('invalid_interpretation_record');
 const comparison=await api.get(`/compare/${base.sha}...${commit.sha}`),packetPath=comparison.files?.[0]?.filename;
 const match=typeof packetPath==='string'?packetPath.match(new RegExp(`^learning-inbox/${base.sha}/([a-f0-9]{64})\\.json$`)):null;
 if(!match)fail('unauthorized_packet_changes');requirePacketDiff(comparison,base.sha,packetPath);
 const tree=await api.get(`/git/trees/${commit.tree.sha}?recursive=1`);
 if(tree?.sha!==commit.tree.sha||tree.truncated!==false||!Array.isArray(tree.tree))fail('invalid_interpretation_record');
 const entry=tree.tree.find(value=>value.path===packetPath);
 if(entry?.type!=='blob'||entry.mode!=='100644'||!sha(entry.sha)||!Number.isSafeInteger(entry.size)||entry.size<1||entry.size>1024*1024)fail('invalid_interpretation_record');
 const blob=await api.get(`/git/blobs/${entry.sha}`);
 if(blob?.encoding!=='base64'||blob.size!==entry.size||typeof blob.content!=='string'||blob.content.length>2*1024*1024)fail('invalid_interpretation_record');
 const bytes=Buffer.from(blob.content,'base64'),text=bytes.toString('utf8');
 if(bytes.length!==entry.size||gitBlobOid(bytes)!==entry.sha||!Buffer.from(text).equals(bytes))fail('invalid_interpretation_record');
 let packet;try{packet=JSON.parse(text);}catch{fail('invalid_interpretation_record');}
 const call=validateInterpretationWorkerCall({schema_version:1,operation:'submit',request:{source_revision:base.sha,request_id:match[1],packet}});
 const sealed=await readInterpretationWorkerResult({api,base,call,proof,assertCurrent});await assertCurrent();
 if(!sealed)return result('unverified_staged',{request_id:match[1]});
 return result('interpretation_staged',{request_id:match[1],interpretation_commit:commit.sha,packet_hash:sealed.body.result.packet_hash});
}
