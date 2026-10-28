import {GitHub} from './github.mjs';
import {LearningError} from './git-artifacts.mjs';
const fail=()=>{throw new LearningError('transport_failure');};
// PC read capability: exact metadata, pinned Git objects, ancestry and owned
// result/ticket refs. Never arbitrary content paths, API routes or writes.
export function createBrokerGitHub({repository,token,getToken,fetcher=fetch,timeoutMs=10000,quotaGate}={}){
 if((getToken!==undefined&&(typeof getToken!=='function'||token!==undefined))||getToken===undefined&&(typeof token!=='string'||!token.trim()||/[\r\n]/.test(token)||token.length>8192)
  ||!Number.isInteger(timeoutMs)||timeoutMs<10||timeoutMs>20000)throw new LearningError('missing_credentials');
 const scopedFetch=async(url,options)=>{
  const link=new URL(url),prefix=`/repos/${repository}`;
  if(link.origin!=='https://api.github.com'||link.username||link.password||link.hash||options.method!=='GET'
   ||!link.pathname.startsWith(prefix)||options.body!==undefined)fail();
  const route=link.pathname.slice(prefix.length)+link.search;
  if(!/^(?:|\/git\/ref\/heads\/(?:main|learning\/(?:interpretation-(?:result-[a-f0-9]{64}|part-[a-f0-9]{40}-[a-f0-9]{64}-\d{2})|task-(?:result-[a-f0-9]{64}|token-[a-f0-9-]{36}))|interpretation\/[a-f0-9]{40}|research\/20\d\d-\d\d-\d\d-(?:action|anime|fantasy|mystery|scifi|thriller))|\/git\/commits\/[a-f0-9]{40}|\/git\/trees\/[a-f0-9]{40}\?recursive=1|\/git\/blobs\/[a-f0-9]{40}|\/compare\/[a-f0-9]{40}\.\.\.[a-f0-9]{40})$/.test(route))fail();
  const controller=new AbortController();let timer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new LearningError('transport_failure'));},timeoutMs);});
  try{
   return await Promise.race([(async()=>{
    const credential=getToken?await getToken():token;
    if(controller.signal.aborted||typeof credential!=='string'||!credential.trim()||/[\r\n]/.test(credential)||credential.length>8192)fail();
    const response=await fetcher(url,{...options,headers:{...options.headers,Authorization:'Bearer '+credential},redirect:'manual',credentials:'omit',signal:controller.signal});
    if(response.redirected||response.status>=300&&response.status<400)fail();
    const quotaHeaders={};for(const name of ['x-ratelimit-remaining','x-ratelimit-reset','retry-after']){const value=response.headers.get(name);if(value!==null)quotaHeaders[name]=value;}
    if(response.status!==200){await response.body?.cancel();return new Response(null,{status:response.status,headers:quotaHeaders});}
    const max=16*1024*1024,length=response.headers.get('content-length');
    if(length!==null&&(!/^\d+$/.test(length)||Number(length)>max)||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??''))fail();
    const chunks=[];let size=0;
    for await(const chunk of response.body??[]){size+=chunk.length;if(size>max)fail();chunks.push(chunk);}
    const bytes=Buffer.concat(chunks),text=bytes.toString('utf8');if(!Buffer.from(text).equals(bytes))fail();
    return new Response(bytes,{headers:{'Content-Type':'application/json',...quotaHeaders}});
   })(),deadline]);
  }catch{fail();}finally{clearTimeout(timer);controller.abort();}
 };
 return new GitHub(repository,getToken?'managed-private-installation-token':token,{writable:false,fetcher:scopedFetch,cacheImmutable:true,quotaGate});
}
