// One PC request budget, including queueing, authentication, reads and waiting.
// Aborting a caller never grants permission to repeat an uncertain operation.
import {AsyncLocalStorage} from 'node:async_hooks';
import {LearningError} from './git-artifacts.mjs';
import {PRIVATE_REQUEST_MS,RESEARCH_REQUEST_MS} from './request-budgets.mjs';
const scopes=new AsyncLocalStorage();
const activeScopes=new Set();
// Local lifecycle only. This stops waits/linked IO, never the persisted worker,
// provider intent or an immutable attempt. No HTTP/tool cancellation endpoint.
export function cancelPrivateTaskWaits(){for(const scope of activeScopes)scope.controller.abort();}
export function assertPrivateTaskDeadline(){
 const scope=scopes.getStore();
 if(scope&&(scope.controller.signal.aborted||Date.now()>=scope.until))throw new LearningError(scope.code);
}
export function linkPrivateTaskDeadline(controller){
 assertPrivateTaskDeadline();const scope=scopes.getStore();if(!scope)return ()=>{};
 const abort=()=>controller.abort();scope.controller.signal.addEventListener('abort',abort,{once:true});
 return ()=>scope.controller.signal.removeEventListener('abort',abort);
}
export async function privateTaskDelay(ms,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))){
 assertPrivateTaskDeadline();const scope=scopes.getStore();if(!scope)return sleep(ms);
 let abort;
 try{return await Promise.race([Promise.resolve().then(()=>sleep(ms)),new Promise((_,reject)=>{
  abort=()=>reject(new LearningError(scope.code));scope.controller.signal.addEventListener('abort',abort,{once:true});
 })]);}finally{if(abort)scope.controller.signal.removeEventListener('abort',abort);}
}
export function withPrivateTaskDeadline(operation,{code='private_task_pending',timeoutMs=PRIVATE_REQUEST_MS,signal}={}){
 if(typeof operation!=='function'||!['private_task_pending','private_interpretation_pending'].includes(code)
  ||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>(code==='private_interpretation_pending'?PRIVATE_REQUEST_MS:RESEARCH_REQUEST_MS)
  ||signal!==undefined&&!(signal instanceof AbortSignal))throw new LearningError('invalid_task_call');
 if(scopes.getStore()){assertPrivateTaskDeadline();return operation();}
 const scope={code,until:Date.now()+timeoutMs,controller:new AbortController()};
 return scopes.run(scope,async()=>{
  activeScopes.add(scope);let timer,abort;
  const externalAbort=()=>scope.controller.abort();
  const expires=new Promise((_,reject)=>{abort=()=>reject(new LearningError(code));scope.controller.signal.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>scope.controller.abort(),timeoutMs);
   signal?.addEventListener('abort',externalAbort,{once:true});if(signal?.aborted)externalAbort();});
  try{return await Promise.race([Promise.resolve().then(()=>{assertPrivateTaskDeadline();return operation();}),expires]);}
  finally{clearTimeout(timer);activeScopes.delete(scope);signal?.removeEventListener('abort',externalAbort);scope.controller.signal.removeEventListener('abort',abort);scope.controller.abort();}
 });
}
