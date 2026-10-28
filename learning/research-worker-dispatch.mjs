import {LearningError} from './git-artifacts.mjs';
import {stableJson} from './interpretation.mjs';
import {validateWorkerCall} from './research-worker.mjs';
import {createGitHubQuotaGate,isGitHubQuotaGate} from './github-quota.mjs';
// Separate capability: one private main workflow dispatch, never a Git write,
// caller-selected repository/ref/URL/workflow or arbitrary signing request.
export function createResearchWorkerDispatch({token,getToken,fetcher=fetch,timeoutMs=10000,quotaGate=createGitHubQuotaGate()}={}){
 if(!isGitHubQuotaGate(quotaGate))throw new LearningError('missing_credentials');
 if((getToken!==undefined&&(typeof getToken!=='function'||token!==undefined))||getToken===undefined&&(typeof token!=='string'||!token.trim()||/[\r\n]/.test(token)||token.length>8192)||typeof fetcher!=='function'
  ||!Number.isInteger(timeoutMs)||timeoutMs<10||timeoutMs>20000)throw new LearningError('missing_credentials');
 return async input=>{
  quotaGate.assertAllowed();
  const call=validateWorkerCall(input),controller=new AbortController();let timer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new LearningError('private_task_pending'));},timeoutMs);});
  try{
   const operation=async()=>{
    const credential=getToken?await getToken():token;
    if(controller.signal.aborted||typeof credential!=='string'||!credential.trim()||/[\r\n]/.test(credential)||credential.length>8192)throw new LearningError('private_task_pending');
    return fetcher('https://api.github.com/repos/Lewdcifer666/wtf-scifi-feedback/actions/workflows/learning-finalize.yml/dispatches',{
    method:'POST',redirect:'manual',credentials:'omit',signal:controller.signal,headers:{Authorization:'Bearer '+credential,
     Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},
    body:JSON.stringify({ref:'main',inputs:{dry_run:false,task_request:stableJson(call)}})});
   };
   const response=await Promise.race([operation(),deadline]);
   if(quotaGate.observe(response))quotaGate.reject();
   // Even an ambiguous accepted dispatch stays pending under the same identity.
   // No response body, token, request or provider result escapes into an error.
   if(response.status!==204||response.redirected)throw new LearningError('private_task_pending');
   await response.body?.cancel();return {accepted:true};
  }catch(error){if(error?.code==='github_rate_limited')throw error;throw new LearningError('private_task_pending');}
  finally{clearTimeout(timer);controller.abort();}
 };
}
