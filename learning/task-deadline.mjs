// One PC request budget, including queueing, authentication, reads and waiting.
// Aborting a caller never grants permission to repeat an uncertain operation.
import {AsyncLocalStorage} from 'node:async_hooks';
import {LearningError} from './git-artifacts.mjs';
const scopes=new AsyncLocalStorage();
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
export function withPrivateTaskDeadline(operation,{code='private_task_pending',timeoutMs=22000}={}){
 if(typeof operation!=='function'||!['private_task_pending','private_interpretation_pending'].includes(code)
  ||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>22000)throw new LearningError('invalid_task_call');
 if(scopes.getStore()){assertPrivateTaskDeadline();return operation();}
 const scope={code,until:Date.now()+timeoutMs,controller:new AbortController()};
 return scopes.run(scope,async()=>{
  let timer;const expires=new Promise((_,reject)=>{timer=setTimeout(()=>{scope.controller.abort();reject(new LearningError(code));},timeoutMs);});
  try{return await Promise.race([Promise.resolve().then(()=>{assertPrivateTaskDeadline();return operation();}),expires]);}
  finally{clearTimeout(timer);}
 });
}
