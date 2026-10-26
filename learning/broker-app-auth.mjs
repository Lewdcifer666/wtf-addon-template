// API authentication only, NOT observation provenance. Evidence continues to
// require the private main workflow's GitHub OIDC. No App/key is created here.
import {createPrivateKey,sign} from 'node:crypto';
import {LearningError} from './git-artifacts.mjs';
const fail=()=>{throw new LearningError('private_app_credentials_required');};
const privateRepositoryId=1343321761;
export function createBrokerAppTokenProvider({appId,installationId,privateKey,fetcher=fetch,clock=()=>new Date(),timeoutMs=10000}={}){
 if(!/^[1-9]\d{0,19}$/.test(appId??'')||!/^[1-9]\d{0,19}$/.test(installationId??'')||typeof privateKey!=='string'
  ||privateKey.length>16384||typeof fetcher!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<10||timeoutMs>20000)fail();
 let key;try{key=createPrivateKey(privateKey);}catch{fail();}
 if(key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails?.modulusLength<2048)fail();
 let cached=null,pending=null;
 const now=()=>{const time=+clock();if(!Number.isFinite(time))fail();return time;};
 async function mint(){
  const time=now(),second=Math.floor(time/1000),header=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
  const claims=Buffer.from(JSON.stringify({iat:second-60,exp:second+300,iss:appId})).toString('base64url');
  const unsigned=header+'.'+claims,jwt=unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),key).toString('base64url');
  const controller=new AbortController();let timer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new LearningError('private_app_credentials_required'));},timeoutMs);});
  try{
   const data=await Promise.race([(async()=>{
    const response=await fetcher(`https://api.github.com/app/installations/${installationId}/access_tokens`,{
     method:'POST',redirect:'manual',credentials:'omit',signal:controller.signal,
     headers:{Authorization:'Bearer '+jwt,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},
     body:JSON.stringify({repository_ids:[privateRepositoryId],permissions:{actions:'write',contents:'read'}})});
    if(response.status!==201||response.redirected||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??''))fail();
    const chunks=[];let size=0;
    for await(const chunk of response.body??[]){size+=chunk.length;if(size>128*1024)fail();chunks.push(chunk);}
    const bytes=Buffer.concat(chunks),text=bytes.toString('utf8');if(!Buffer.from(text).equals(bytes))fail();
    return JSON.parse(text);
   })(),deadline]);
   const expires=Date.parse(data.expires_at),permissions=data.permissions,repo=data.repositories?.[0];
   if(typeof data.token!=='string'||!/^[A-Za-z0-9_.-]{16,8192}$/.test(data.token)||!Number.isFinite(expires)
    ||expires<=now()+5*60*1000||expires>now()+65*60*1000||permissions?.actions!=='write'||permissions?.contents!=='read'
    ||Object.keys(permissions).some(k=>!['actions','contents','metadata'].includes(k))||(permissions.metadata!==undefined&&permissions.metadata!=='read')
    ||data.repository_selection!=='selected'||data.repositories?.length!==1||repo.id!==privateRepositoryId
    ||repo.full_name!=='Lewdcifer666/wtf-scifi-feedback'||repo.private!==true)fail();
   cached={token:data.token,expires};return cached.token;
  }catch{fail();}finally{clearTimeout(timer);controller.abort();}
 }
 return async()=>{
  if(cached&&cached.expires>now()+5*60*1000)return cached.token;
  if(!pending)pending=mint().finally(()=>{pending=null;});return pending;
 };
}
