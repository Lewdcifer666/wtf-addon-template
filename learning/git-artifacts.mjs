import {digest,stableJson,gitBlobOid} from './interpretation.mjs';

export class LearningError extends Error {
  constructor(code){super(code);this.code=code;}
}
export function requirePacketDiff(comparison,sourceRevision,packetPath){
  if(comparison?.merge_base_commit?.sha!==sourceRevision||comparison.status!=='ahead'
    ||!Array.isArray(comparison.files)||comparison.files.length!==1
    ||comparison.files[0].filename!==packetPath||comparison.files[0].status!=='added'
    ||comparison.files[0].previous_filename)throw new LearningError('unauthorized_packet_changes');
}

// The API capability is scoped by its caller to the verified PRIVATE repository.
// Creation is atomic and never updates an existing ref, commit or artifact.
function artifactNames(branch,files){
  if(!/^learning\/(?:request|receipt|failure|handoff)-[a-f0-9]{64}$/.test(branch))throw new LearningError('unsafe_artifact_branch');
  const names=Object.keys(files).sort();
  if(!names.length||names.some(name=>!name.endsWith('.json')||!/^[a-z0-9/-]+\.json$/.test(name)||name.includes('..')))throw new LearningError('unsafe_artifact_path');
  return names;
}
async function verifyImmutableRef(api,{base,branch,files},ref){
  const prefix='learning-output/';
  const names=artifactNames(branch,files);
  if(ref.ref!==`refs/heads/${branch}`||!/^[a-f0-9]{40}$/.test(ref.object?.sha||''))throw new LearningError('immutable_artifact_mismatch');
  const commit=await api.get(`/git/commits/${ref.object.sha}`),tree=await api.get(`/git/trees/${commit.tree.sha}?recursive=1`);
  if(commit.sha!==ref.object.sha||commit.parents?.length!==1||commit.parents[0].sha!==base.sha)throw new LearningError('immutable_artifact_mismatch');
  if(tree.truncated!==false||tree.sha!==commit.tree.sha||!Array.isArray(tree.tree))throw new LearningError('truncated_artifact_tree');
  const entries=tree.tree.filter(e=>e.path.startsWith(prefix)&&e.type!=='tree');
  if(entries.length!==names.length)throw new LearningError('immutable_artifact_mismatch');
  for(const name of names){
    const entry=entries.find(e=>e.path===prefix+name);
    if(!entry||entry.mode!=='100644'||entry.type!=='blob'||entry.sha!==gitBlobOid(files[name]))throw new LearningError('immutable_artifact_mismatch');
  }
  const comparison=await api.get(`/compare/${base.sha}...${ref.object.sha}`);
  if(comparison.status!=='ahead'||comparison.merge_base_commit?.sha!==base.sha||comparison.files?.length!==names.length
    ||comparison.files.some(file=>file.status!=='added'||!names.some(name=>prefix+name===file.filename)))throw new LearningError('immutable_artifact_mismatch');
  return {branch,commit:ref.object.sha,reused:true};
}
// Authenticated read only: verify ref -> commit -> parent -> complete tree and
// expected blob OIDs, plus the full changed-path set. Never creates a fallback.
export async function readImmutable(api,{base,branch,files}){
  artifactNames(branch,files);
  const ref=await api.optional(`/git/ref/heads/${branch}`);
  return ref?verifyImmutableRef(api,{base,branch,files},ref):null;
}
export async function persistImmutable(api,{base,branch,files,assertCurrent=async()=>{}}){
  const names=artifactNames(branch,files),prefix='learning-output/';
  const verify=ref=>verifyImmutableRef(api,{base,branch,files},ref);
  const existing=await api.optional(`/git/ref/heads/${branch}`);
  if(existing)return verify(existing);
  await assertCurrent();
  const entries=[];
  for(const name of names){
    const blob=await api.post('/git/blobs',{content:files[name],encoding:'utf-8'});
    if(blob.sha!==gitBlobOid(files[name]))throw new LearningError('artifact_blob_mismatch');
    entries.push({path:prefix+name,mode:'100644',type:'blob',sha:blob.sha});
  }
  const tree=await api.post('/git/trees',{base_tree:base.tree.sha,tree:entries});
  const commit=await api.post('/git/commits',{message:'Record immutable private learning state',tree:tree.sha,parents:[base.sha]});
  await assertCurrent();
  let ref;
  try{ref=await api.post('/git/refs',{ref:`refs/heads/${branch}`,sha:commit.sha});}
  catch(error){
    if(error.status!==422&&error.status!==409)throw error;
    ref=await api.optional(`/git/ref/heads/${branch}`);if(!ref)throw error;
    return verify(ref);
  }
  await assertCurrent(); // If heads moved, retain the artifact but do not call it current.
  return {branch,commit:ref.object.sha,reused:false};
}

export function failureArtifact({packetCommit,sourceRevision,evaluatedBase=sourceRevision,engineFingerprint,code}){
  // Never copy an exception message or raw GitHub payload into a durable log.
  const allowed=['unauthorized_packet_changes','invalid_interpretation','invalid_handoff','stale_input','invalid_source','invalid_public_policy','immutable_artifact_mismatch','transport_failure'];
  if(!allowed.includes(code))code='transport_failure';
  const state={schema_version:1,state:'finalization_failed',packet_commit:packetCommit,source_revision:sourceRevision,evaluated_base:evaluatedBase,engine_fingerprint:engineFingerprint,code};
  return {branch:`learning/failure-${digest(stableJson(state))}`,files:{'state.json':stableJson(state)}};
}
