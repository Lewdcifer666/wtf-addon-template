import {digest,stableJson} from './interpretation.mjs';
import {LearningError,readArtifactJson,readImmutable,persistSealedState,requireTrustedAncestor} from './git-artifacts.mjs';
import {GENRES} from './receipt.mjs';

const fail=()=>{throw new LearningError('invalid_observation_index');};
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const validEntry=e=>e&&Object.keys(e).sort().join()==='branch,commit,genre,handoff_commit,research_commit,research_date,state'
 &&GENRES.includes(e.genre)&&/^20\d\d-\d\d-\d\d$/.test(e.research_date)&&sha(e.handoff_commit)&&sha(e.research_commit)
 &&((e.state==='diagnostics_recorded'&&/^learning\/observation-[a-f0-9]{64}$/.test(e.branch)&&sha(e.commit))||(e.state==='ordering_unproven'&&e.branch===null&&e.commit===null));
const id=e=>e.handoff_commit+':'+e.research_commit;
export const emptyObservationIndex=(period='legacy')=>({schema_version:1,kind:'private_historical_observation_index',period,sequence:0,cursor:null,known_handoffs:[],completed:[]});
function validateIndex(index){
 if(!index||Object.keys(index).sort().join()!=='completed,cursor,kind,known_handoffs,period,schema_version,sequence'||index.schema_version!==1||index.kind!=='private_historical_observation_index'||!/^20\d\d-(0[1-9]|1[0-2])$|^legacy$/.test(index.period)
   ||!Number.isSafeInteger(index.sequence)||index.sequence<1||index.sequence>9999999999||(index.cursor!==null&&!sha(index.cursor))
   ||!Array.isArray(index.known_handoffs)||index.known_handoffs.length>10000||!index.known_handoffs.every(sha)||new Set(index.known_handoffs).size!==index.known_handoffs.length
   ||!Array.isArray(index.completed)||index.completed.length>20000||!index.completed.every(validEntry)||new Set(index.completed.map(id)).size!==index.completed.length)fail();
}

// A self-declared checksum/AI marker cannot suppress pending work. Only a
// signed statement by the trusted PRIVATE main workflow can seal this index.
export async function loadObservationIndex({api,base,proof,assertCurrent,period='legacy'}){
 if(!/^20\d\d-(0[1-9]|1[0-2])$|^legacy$/.test(period))fail();
 const refs=await api.get(`/git/matching-refs/heads/learning/observation-index-${period}-`);
 if(!Array.isArray(refs))fail();
 const sorted=refs.map(ref=>{const m=new RegExp(`^refs/heads/learning/observation-index-${period}-(\\d{10})-([a-f0-9]{64})$`).exec(ref.ref);if(!m)fail();return {ref,sequence:Number(m[1]),hash:m[2]};}).sort((a,b)=>b.sequence-a.sequence||a.ref.ref.localeCompare(b.ref.ref,'en'));
 // Bounded lookup. Rotated-away issuer keys do NOT authenticate an index;
 // restart bounded data verification, retaining every old ref and artifact.
 const candidates=sorted.slice(0,4);let unavailable=0;
 for(const {ref,sequence,hash} of candidates){
  const raw=await readArtifactJson(api,ref,'index.json'),record=raw.value,index=record.body;
  validateIndex(index);
  if(Object.keys(record).sort().join()!=='body,proof'||index.period!==period||index.sequence!==sequence||digest(stableJson(index))!==hash)fail();
  await requireTrustedAncestor(api,raw.parent,base.sha);
  try{await proof.verify(record.proof,index,raw.parent);}catch(error){if(error.code==='proof_key_unavailable'){unavailable++;continue;}throw error;}
  await readImmutable(api,{base:await api.get(`/git/commits/${raw.parent}`),branch:ref.ref.slice('refs/heads/'.length),files:{'index.json':stableJson(record)}});
  await assertCurrent();return {index,largest_sequence:sorted[0]?.sequence||0,key_reverification_required:false};
 }
 return {index:emptyObservationIndex(period),largest_sequence:sorted[0]?.sequence||0,key_reverification_required:unavailable>0};
}

export async function saveObservationIndex({api,base,proof,previous,index,assertCurrent}){
 const normalized={...index,known_handoffs:[...index.known_handoffs].sort(),completed:[...index.completed].sort((a,b)=>id(a).localeCompare(id(b),'en'))};
 const withoutSequence=x=>({...x,sequence:0});
 if(stableJson(withoutSequence(normalized))===stableJson(withoutSequence(previous.index)))return;
 const body={...normalized,sequence:previous.largest_sequence+1};validateIndex(body);
 await assertCurrent();
 const branch=`learning/observation-index-${body.period}-${String(body.sequence).padStart(10,'0')}-${digest(stableJson(body))}`;
 await persistSealedState({api,base,branch,name:'index.json',body,proof,assertCurrent});
}

export function selectObservationBatch(refs,index,{budget=6,clock=()=>new Date(),rebuilding=false}={}){
 if(!Number.isSafeInteger(budget)||budget<1||budget>24)fail();
 const ordered=[...refs].sort((a,b)=>a.object.sha.localeCompare(b.object.sha,'en'));
 if(rebuilding&&ordered.length){const start=Math.floor(+clock()/3600000)*budget%ordered.length;return [...ordered.slice(start),...ordered.slice(0,start)].slice(0,budget);}
 const known=new Set(index.known_handoffs),fresh=ordered.filter(r=>!known.has(r.object.sha));
 const old=ordered.filter(r=>known.has(r.object.sha));
 const offset=rebuilding&&old.length?Math.floor(+clock()/3600000)*budget%old.length:Math.max(0,old.findIndex(r=>r.object.sha>(index.cursor||'')));
 const rotated=[...old.slice(offset),...old.slice(0,offset)];
 return [...fresh,...rotated].slice(0,budget);
}
