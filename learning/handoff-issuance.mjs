import {stableJson} from './interpretation.mjs';
import {LearningError,readArtifactJson,readImmutable,persistSealedState,requireTrustedAncestor} from './git-artifacts.mjs';

const certificateBranch=issued=>`learning/issuance-${issued.use_id}`;
const expectedBinding=(base,issued,handoff)=>({schema_version:1,kind:'private_handoff_precedes_packet',source_revision:base.sha,
 use_id:issued.use_id,handoff_commit:handoff.commit,genre:issued.genre,research_date:issued.research_date,
 public_repository:`Lewdcifer666/wtf-${issued.genre}-stremio`,research_branch:`research/${issued.research_date}-${issued.genre}`,
 packet_path:`research-inbox/${issued.research_date}.json`,packet_absent_after_handoff:true});

export async function readHandoffIssuance({api,base,issued,handoff,proof,assertCurrent}){
 const branch=certificateBranch(issued),ref=await api.optional(`/git/ref/heads/${branch}`);
 if(!ref)throw new LearningError('handoff_issuance_missing');
 const raw=await readArtifactJson(api,ref,'issuance.json'),record=raw.value;
 const expected=expectedBinding(base,issued,handoff);
 if(raw.parent!==base.sha||Object.keys(record).sort().join()!=='body,proof'||stableJson(record.body)!==stableJson(expected))throw new LearningError('invalid_handoff_issuance');
 await proof.verify(record.proof,expected,base.sha);
 const verified=await readImmutable(api,{base,branch,files:{'issuance.json':stableJson(record)}});
 await assertCurrent();return verified;
}

// A matching packet parent is NOT ordering evidence. Check absence only AFTER
// the immutable handoff is visible, then seal that fact with a GitHub main-job
// identity. A later receipt can never certify an already staged packet.
export async function certifyHandoff({api,publicApi,base,issued,handoff,proof,assertCurrent}){
 const existing=await api.optional(`/git/ref/heads/${certificateBranch(issued)}`);
 if(existing)return readHandoffIssuance({api,base,issued,handoff,proof,assertCurrent});
 await assertCurrent();
 if((await api.get(`/git/ref/heads/${handoff.branch}`)).object?.sha!==handoff.commit)throw new LearningError('stale_input');
 const body=expectedBinding(base,issued,handoff),ref=await publicApi.optional(`/git/ref/heads/${body.research_branch}`);
 if(ref){
  const commit=await publicApi.get(`/git/commits/${ref.object.sha}`),tree=await publicApi.get(`/git/trees/${commit.tree.sha}?recursive=1`);
  if(commit.sha!==ref.object.sha||tree.sha!==commit.tree.sha||tree.truncated!==false||!Array.isArray(tree.tree))throw new LearningError('invalid_handoff_issuance');
  if(tree.tree.some(e=>e.path===body.packet_path))return {state:'research_already_staged'};
  await requireTrustedAncestor(publicApi,ref.object.sha,issued.source_heads.public[issued.genre]);
 }
 await assertCurrent();
 return persistSealedState({api,base,branch:certificateBranch(issued),name:'issuance.json',body,proof,assertCurrent});
}
