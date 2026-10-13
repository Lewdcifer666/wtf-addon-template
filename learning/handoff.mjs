import {buildReceipt,GENRES} from './receipt.mjs';
import {loadVerifiedReceipt} from './receipt-loader.mjs';
import {prepareResearchUse} from './research-use.mjs';
import {LearningError,persistImmutable,readImmutable,persistArtifactAlias} from './git-artifacts.mjs';
import {stableJson} from './interpretation.mjs';
import {certifyHandoff,readHandoffIssuance} from './handoff-issuance.mjs';

export function berlinResearchDate(now=new Date()){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
const handoffArtifact=issued=>({branch:`learning/handoff-${issued.use_id}`,files:{'handoff.json':stableJson(issued)}});

// Only code-owned derived briefs are written. This path cannot create or retry
// an interpretation packet; it requires an already completed active receipt.
export async function issueDailyHandoffs({api,publicApis,proof,base,inputs,researchDate,assertCurrent}){
  if(inputs.activation.research_learning_enabled!==true)throw new LearningError('learning_inactive');
  const expected=buildReceipt(inputs),artifact=await loadVerifiedReceipt({api,base,expected,assertCurrent});
  const handoffs=[];
  for(const genre of GENRES){
    const issued=prepareResearchUse({inputs,artifact,genre,researchDate});
    const result=await persistImmutable(api,{base,...handoffArtifact(issued),assertCurrent});
    await persistArtifactAlias(api,{base,original:result,branch:`learning/queue-${researchDate.slice(0,7)}-${issued.use_id}`,files:handoffArtifact(issued).files,assertCurrent});
    await certifyHandoff({api,publicApi:publicApis[genre],proof,base,issued,handoff:result,assertCurrent});
    await assertCurrent();
    // Brief contents and personal signals never enter workflow logs.
    handoffs.push({genre,branch:result.branch,commit:result.commit});
  }
  return handoffs;
}

// Authenticated consumption recomputes current inputs and checks both the
// receipt and daily handoff graphs. It performs no writes or fallback staging.
export async function readDailyHandoff({api,proof,base,inputs,genre,researchDate,assertCurrent}){
  const expected=buildReceipt(inputs),artifact=await loadVerifiedReceipt({api,base,expected,assertCurrent});
  const issued=prepareResearchUse({inputs,artifact,genre,researchDate});
  const record=await readImmutable(api,{base,...handoffArtifact(issued)});
  if(!record)throw new LearningError('handoff_not_persisted');
  const issuance=await readHandoffIssuance({api,proof,base,issued,handoff:record,assertCurrent});
  await assertCurrent();
  return {branch:record.branch,commit:record.commit,issued,issuance_commit:issuance.commit};
}
