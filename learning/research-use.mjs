import {buildReceipt,verifyReceipt,GENRES} from './receipt.mjs';
import {digest,stableJson} from './interpretation.mjs';

const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const validDate=value=>typeof value==='string'&&/^20\d\d-\d\d-\d\d$/.test(value)
  &&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;

// Read-only boundary. inputs must come from a freshly pinned complete private
// inventory and all six public policies, using the trusted loader. A task's
// declaration of a source tuple or a receipt's own hashes is not evidence of
// currentness: recompute the entire expected receipt and compare every byte.
// This module performs no network calls, writes, activation or timestamp refresh.
export function prepareResearchUse({inputs,artifact,genre,researchDate}) {
  if(!GENRES.includes(genre)||!validDate(researchDate))throw Error('Invalid research use identity');
  if(!inputs?.activation?.research_learning_enabled)throw Error('Private research learning is inactive');
  if(!artifact||!sha(artifact.commit))throw Error('Unpinned private receipt');
  const expected=buildReceipt(inputs);
  if(artifact.branch!==expected.branch)throw Error('Private learning receipt is stale');
  verifyReceipt(artifact.files,expected);
  const receipt=JSON.parse(expected.files['receipt.json']);
  if(receipt.research_learning_enabled!==true)throw Error('Private research learning is inactive');
  const contextBytes=expected.files[`research-context/${genre}.json`];
  const binding={schema_version:1,kind:'private_research_consumption',genre,research_date:researchDate,
    receipt_branch:expected.branch,receipt_commit:artifact.commit,state_digest:expected.state_digest,
    source_tuple_hash:digest(stableJson(receipt.sources)),context_hash:digest(contextBytes),
    context:JSON.parse(contextBytes)};
  return {...binding,use_id:digest(stableJson(binding))};
}

// Recheck immediately before use/staging with newly read trusted inputs.
// Supersession, retraction, policy, activation or receipt changes invalidate
// the old handoff. A matching receipt name or AI claim alone cannot pass.
export function verifyResearchUse({issued,inputs,artifact}) {
  if(!issued||typeof issued!=='object')throw Error('Missing private research handoff');
  const current=prepareResearchUse({inputs,artifact,genre:issued.genre,researchDate:issued.research_date});
  if(stableJson(issued)!==stableJson(current))throw Error('Private research handoff changed or is stale');
  return current;
}
