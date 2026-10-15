// Dormant private adapter capability. No CLI or workflow invokes this module.
// Only an already active authenticated session and a trusted-main proof signer
// can persist derived observations. This cannot stage AI interpretation, raw
// feedback, public packets, or replay any denied operation.
import {privateResearchSessionResponse,privateResearchSearchObservation,recheckResearchSession} from './research-session.mjs';
import {LearningError,persistSealedState} from './git-artifacts.mjs';
import {readSealedSessionRecord,sessionContextBody,sessionSearchBody,validateSessionSearch,loadSessionSearchRefs} from './session-journal.mjs';
import {stableJson} from './interpretation.mjs';

const fail=code=>{throw new LearningError(code);};
// The trusted workflow has one writer process and repository-wide non-canceling
// concurrency. Serialize its asynchronous calls as well: count + create must
// be one operation even when several task searches finish together. A service
// must queue to that writer, not mint a parallel writer outside the workflow.
const searchWrites=new Map();
async function serializeSearchWrite(sessionId,operation){
 const previous=searchWrites.get(sessionId)||Promise.resolve();let release;
 const current=new Promise(resolve=>{release=resolve;});searchWrites.set(sessionId,current);
 await previous;
 try{return await operation();}
 finally{release();if(searchWrites.get(sessionId)===current)searchWrites.delete(sessionId);}
}
const boundedProof=proof=>({
 async sign(body,revision){
  const token=await proof.sign(body,revision);
  if(Buffer.byteLength(stableJson({body,proof:token}),'utf8')>1024*1024)fail('session_journal_limit');
  return token;
 },
 async verify(token,body,revision){
  if(Buffer.byteLength(stableJson({body,proof:token}),'utf8')>1024*1024)fail('session_journal_limit');
  return proof.verify(token,body,revision);
 }
});
async function authority({api,session,proof}){
 if(typeof proof?.sign!=='function'||typeof proof?.verify!=='function')fail('proof_credentials_required');
 const response=await privateResearchSessionResponse(session);
 const assertPrivate=async()=>{
  const metadata=await api.get('/');
  if(api.repository!=='Lewdcifer666/wtf-scifi-feedback'||metadata.full_name!==api.repository||metadata.private!==true||metadata.default_branch!=='main')fail('private_repository_required');
 };
 await assertPrivate();
 const base=await api.pinMain();
 if(base.sha!==response.source_heads.private)fail('stale_input');
 const assertCurrent=async()=>{
  await assertPrivate();
  if((await api.pinMain()).sha!==base.sha)fail('stale_input');
  // This ends with the dated public ref check, after all other awaited heads.
  await recheckResearchSession(session);
 };
 await assertCurrent();
 return {response,base,assertCurrent,signer:boundedProof(proof)};
}

export async function persistResearchSessionContext({api,session,proof}){
 const {response,base,assertCurrent,signer}=await authority({api,session,proof});
 return persistSealedState({api,base,branch:`learning/session-${response.session_id}`,name:'session.json',
  body:sessionContextBody(response),proof:signer,assertCurrent});
}

export async function persistResearchSessionSearch({api,session,handle,proof}){
 const search=privateResearchSearchObservation({session,handle});
 return serializeSearchWrite(session.session_id,async()=>{
 const {response,base,assertCurrent,signer}=await authority({api,session,proof});
 validateSessionSearch(search.observation,response);
 const context=await readSealedSessionRecord({api,base,branch:`learning/session-${response.session_id}`,name:'session.json',
  expectedBody:sessionContextBody(response),proof:signer,assertCurrent});
 if(!context)fail('session_context_not_persisted');
 const branch=`learning/search-${response.session_id}-${search.search_id}`,refs=await loadSessionSearchRefs(api,response.session_id);
 if(refs.length>=100&&!refs.some(ref=>ref.ref===`refs/heads/${branch}`))fail('session_journal_limit');
 return persistSealedState({api,base,branch,name:'search.json',
  body:sessionSearchBody(search.search_id,search.observation),proof:signer,assertCurrent});
 });
}
