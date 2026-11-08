// Observational verification of an ORIGINAL session after public publication.
// Private main/date remain current. This never issues context, opens a session,
// searches, or treats a historical public tuple as current recommendation input.
import {LearningError,readArtifactJson} from './git-artifacts.mjs';
import {stableJson} from './interpretation.mjs';
import {buildReceipt,GENRES} from './receipt.mjs';
import {loadObservationInputs} from './reconcile.mjs';
import {loadVerifiedReceipt} from './receipt-loader.mjs';
import {readDailyHandoff} from './handoff.mjs';
import {authenticateResearchCommit} from './research-commit.mjs';
import {createResearchValidator} from './research-contract.mjs';
import {readSealedSessionRecord,describeResearchSession,readResearchSessionJournal,assertSessionTaskIntentsResolved} from './session-journal.mjs';

const fail=()=>{throw new LearningError('invalid_task_record');};
export async function verifyOriginalResearchSession({api,publicApis,base,ticket,researchCommit,proof,assertCurrent}){
 const request=ticket.body.open_request,sessionId=ticket.body.session_id;
 await assertCurrent();
 const context=await readSealedSessionRecord({api,base,branch:`learning/session-${sessionId}`,name:'session.json',proof,assertCurrent});
 if(!context)throw new LearningError('session_context_not_persisted');
 const response=context.body?.response;
 if(context.body.kind!=='private_research_context_prepared'||context.body.packet_absence_checked!==true
  ||response?.session_id!==sessionId||stableJson(response.source_heads)!==stableJson(ticket.body.source_heads)
  ||!/^[a-f0-9]{64}$/.test(response.use_id??''))fail();
 const raw=await readArtifactJson(api,await api.get(`/git/ref/heads/learning/handoff-${response.use_id}`),'handoff.json'),issued=raw.value;
 if(raw.parent!==base.sha||issued?.use_id!==response.use_id||issued.genre!==request.genre||issued.research_date!==request.research_date
  ||stableJson(issued.source_heads)!==stableJson(ticket.body.source_heads)||!/^learning\/receipt-[a-f0-9]{64}$/.test(issued.receipt_branch??''))fail();
 const receiptRef=await api.get(`/git/ref/heads/${issued.receipt_branch}`);
 if(receiptRef?.object?.sha!==issued.receipt_commit)fail();
 const receipt=await readArtifactJson(api,receiptRef,'receipt.json');
 if(receipt.parent!==base.sha)fail();
 const currentProfiles=Object.fromEntries(await Promise.all(GENRES.map(async genre=>[genre,{revision:(await publicApis[genre].pinMain()).sha}])));
 const inputs=await loadObservationInputs({api,publicApis,base,receipt:receipt.value,currentProfiles,assertCurrent});
 const artifact=await loadVerifiedReceipt({api,base,expected:buildReceipt(inputs),assertCurrent});
 const handoff=await readDailyHandoff({api,proof,base,inputs,genre:request.genre,researchDate:request.research_date,assertCurrent});
 if(handoff.commit!==raw.commit.sha||stableJson(handoff.issued)!==stableJson(issued))fail();
 const described=describeResearchSession({issued,handoffCommit:handoff.commit,issuanceCommit:handoff.issuance_commit});
 if(described.session_id!==sessionId||stableJson(described.response)!==stableJson(response))fail();
 const trace=await authenticateResearchCommit({api:publicApis[request.genre],issued,inputs,artifact,researchDate:request.research_date,commit:researchCommit,
  validatePacket:createResearchValidator(inputs.profiles[request.genre]),assertCurrent,historical:true});
 const journal=await readResearchSessionJournal({api,base,issued,handoffCommit:handoff.commit,issuanceCommit:handoff.issuance_commit,proof,assertCurrent});
 if(!journal)throw new LearningError('session_context_not_persisted');
 await assertSessionTaskIntentsResolved({api,base,response:described.response,journal,proof,assertCurrent});
 await assertCurrent();
 return {schema_version:1,kind:'private_task_research_verification',session_id:sessionId,research_commit:trace.research_commit,
  verification_mode:'historical_observation',current_evidence:false,
  search_adapter_invocations_observed:journal.search_adapter_invocations_observed,actual_context_use_verified:false,behavioral_effect_observed:false};
}
