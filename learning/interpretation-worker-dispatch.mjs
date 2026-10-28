import {LearningError} from './git-artifacts.mjs';
import {validateInterpretationWireCall,interpretationDispatchBody} from './interpretation-transport.mjs';
import {createGitHubQuotaGate,isGitHubQuotaGate} from './github-quota.mjs';
// One exact private-main workflow dispatch. No Git writer, source selector,
// alternate repository, API route, provider or arbitrary signing capability.
export function createInterpretationWorkerDispatch({token,getToken,fetcher=fetch,timeoutMs=10000,quotaGate=createGitHubQuotaGate()}={}){
 if(!isGitHubQuotaGate(quotaGate))throw new LearningError('missing_credentials');
 if((getToken!==undefined&&(typeof getToken!=='function'||token!==undefined))
  ||getToken===undefined&&(typeof token!=='string'||!token.trim()||/[\r\n]/.test(token)||token.length>8192)
  ||typeof fetcher!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<10||timeoutMs>20000)throw new LearningError('missing_credentials');
 return async input=>{
  quotaGate.assertAllowed();
  const call=validateInterpretationWireCall(input),body=interpretationDispatchBody(call);
  if(Buffer.byteLength(body)>60000)throw new LearningError('interpretation_submission_limit');
  const controller=new AbortController();let timer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new LearningError('private_interpretation_pending'));},timeoutMs);});
  try{
   const operation=async()=>{
    const credential=getToken?await getToken():token;
    if(controller.signal.aborted||typeof credential!=='string'||!credential.trim()||/[\r\n]/.test(credential)||credential.length>8192)throw new LearningError('private_interpretation_pending');
    return fetcher('https://api.github.com/repos/Lewdcifer666/wtf-scifi-feedback/actions/workflows/learning-finalize.yml/dispatches',{
     method:'POST',redirect:'manual',credentials:'omit',signal:controller.signal,
     headers:{Authorization:'Bearer '+credential,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},body});
   };
   const response=await Promise.race([operation(),deadline]);
   if(quotaGate.observe(response))quotaGate.reject();
   if(response.status!==204||response.redirected)throw new LearningError('private_interpretation_pending');
   await response.body?.cancel();return {accepted:true};
  }catch(error){if(error?.code==='github_rate_limited')throw error;throw new LearningError('private_interpretation_pending');}
  finally{clearTimeout(timer);controller.abort();}
 };
}
