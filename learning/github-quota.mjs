import {LearningError} from './git-artifacts.mjs';
const gates=new WeakSet();
export function createGitHubQuotaGate({clock=()=>Date.now(),initialUntil=0,onPause=()=>{}}={}){
 if(typeof clock!=='function'||typeof onPause!=='function'||!Number.isSafeInteger(initialUntil)||initialUntil<0||initialUntil>clock()+86400000)throw new LearningError('invalid_api_cache');
 let until=initialUntil;
 const pause=deadline=>{if(deadline>until){until=deadline;onPause(until);}};
 const limited=()=>{const e=new LearningError('github_rate_limited');e.retry_at=until;return e;};
 const gate=Object.freeze({
  assertAllowed(){if(clock()<until)throw limited();},
  observe(response){
   const now=clock(),remaining=response?.headers?.get('x-ratelimit-remaining'),reset=response?.headers?.get('x-ratelimit-reset'),retry=response?.headers?.get('retry-after');
   if(remaining==='0'){
    const deadline=/^\d{1,13}$/.test(reset??'')?Number(reset)*1000:now+60000;
    pause(deadline>now&&deadline<=now+86400000?deadline:now+60000);
   }
   if(response?.status===429)pause(now+60000);
   if([403,429].includes(response?.status)&&/^\d{1,6}$/.test(retry??''))pause(now+Math.min(86400,Math.max(60,Number(retry)))*1000);
   return [403,429].includes(response?.status)&&now<until;
  },
  reject(){pause(clock()+60000);throw limited();}
 });gates.add(gate);return gate;
}
export const isGitHubQuotaGate=value=>gates.has(value);
