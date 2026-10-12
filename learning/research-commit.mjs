import {verifyResearchUse} from './research-use.mjs';
import {digest,gitBlobOid,stableJson} from './interpretation.mjs';
import {learningAdjustments} from './aggregate.mjs';
import {makePolicy,scoreItem} from '../engine/dna-score.mjs';
import {LearningError,requirePacketDiff} from './git-artifacts.mjs';

const fail=()=>{throw new LearningError('invalid_research_commit');};
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);

// Read-only post-staging boundary. The trusted caller supplies its own packet
// validator and fresh-head checks; never import code from the research branch.
// The resulting diagnostics stay PRIVATE and do not establish behavioral effect.
export async function authenticateResearchCommit({api,issued,inputs,artifact,researchDate,commit:revision,validatePacket,assertCurrent}){
 if(typeof validatePacket!=='function'||typeof assertCurrent!=='function'||!sha(revision))fail();
 const current=verifyResearchUse({issued,inputs,artifact,researchDate});
 const repository=`Lewdcifer666/wtf-${current.genre}-stremio`;
 const metadata=await api.get('/');
 if(api.repository!==repository||metadata.full_name!==repository||metadata.private!==false||metadata.default_branch!=='main')fail();
 await assertCurrent();
 const base=current.source_heads.public[current.genre],branch=`research/${researchDate}-${current.genre}`;
 if((await api.pinMain()).sha!==base)throw new LearningError('stale_input');
 const ref=await api.get(`/git/ref/heads/${branch}`);
 if(ref.ref!==`refs/heads/${branch}`||ref.object?.sha!==revision)fail();
 const packetPath=`research-inbox/${researchDate}.json`;
 const comparison=await api.get(`/compare/${base}...${revision}`);
 requirePacketDiff(comparison,base,packetPath);
 if(comparison.total_commits!==1)fail();
 const commit=await api.get(`/git/commits/${revision}`);
 if(commit.sha!==revision||commit.parents?.length!==1||commit.parents[0].sha!==base||!sha(commit.tree?.sha))fail();
 const tree=await api.get(`/git/trees/${commit.tree.sha}?recursive=1`);
 if(tree.sha!==commit.tree.sha||tree.truncated!==false||!Array.isArray(tree.tree))fail();
 const entry=tree.tree.find(e=>e.path===packetPath);
 if(entry?.type!=='blob'||entry.mode!=='100644'||!sha(entry.sha)||!Number.isSafeInteger(entry.size)||entry.size<1||entry.size>1024*1024)fail();
 const blob=await api.get(`/git/blobs/${entry.sha}`);
 if(blob.encoding!=='base64'||blob.size!==entry.size)fail();
 const bytes=Buffer.from(blob.content,'base64');
 if(bytes.length!==entry.size||gitBlobOid(bytes)!==entry.sha||!Buffer.from(bytes.toString('utf8')).equals(bytes))fail();
 let packet;
 try{
  packet=JSON.parse(bytes.toString('utf8'));
  const errors=await validatePacket(packet);
  if(!Array.isArray(errors)||errors.length||packet.genre!==current.genre||packet.research_date!==researchDate||!Array.isArray(packet.candidates))fail();
 }catch{fail();}
 const input=inputs.profiles[current.genre],policy=makePolicy(input.profile);
 const definition=input.catalogs.catalogs.find(d=>d.id==='dna-match');
 if(definition?.dna?.mode!=='baseline_profile')fail();
 const signals=JSON.parse(artifact.files[`signals/${current.genre}.json`]);
 const identities=new Set(),candidates=[];
 for(const candidate of packet.candidates){
  const identity=`${candidate.type}:${candidate.imdb_id}`;
  if(!/^tt\d+$/.test(candidate.imdb_id)||!['movie','series'].includes(candidate.type)||identities.has(identity))fail();
  identities.add(identity);
  const item={...candidate,status:'watch'},baseline=scoreItem(policy,definition,item,new Map());
  const adjustments=learningAdjustments({item,signals,profile:input.profile,adapter:input.adapter,executionEvidence:input.executionEvidence});
  candidates.push({imdb_id:candidate.imdb_id,type:candidate.type,baseline_score:baseline.score,baseline_reason:baseline.reason,...adjustments});
 }
 candidates.sort((a,b)=>`${a.type}:${a.imdb_id}`.localeCompare(`${b.type}:${b.imdb_id}`,'en'));
 await assertCurrent();
 if((await api.pinMain()).sha!==base)throw new LearningError('stale_input');
 if((await api.get(`/git/ref/heads/${branch}`)).object?.sha!==revision)throw new LearningError('stale_input');
 const trace={schema_version:1,kind:'private_research_commit_diagnostics',genre:current.genre,research_date:researchDate,
  use_id:current.use_id,receipt_commit:current.receipt_commit,state_digest:current.state_digest,
  repository,research_branch:branch,research_commit:revision,evaluated_base:base,packet_hash:digest(bytes),
  publication_scores_unchanged:true,effect_status:'candidate_diagnostics_only',candidates};
 return {...trace,trace_id:digest(stableJson(trace))};
}
