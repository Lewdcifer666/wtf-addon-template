import {createPublicKey,verify} from 'node:crypto';
import {digest,stableJson} from './interpretation.mjs';
import {LearningError} from './git-artifacts.mjs';

export const PROOF_ISSUER='https://token.actions.githubusercontent.com';
export const PROOF_REPOSITORY='Lewdcifer666/wtf-scifi-feedback';
export const proofAudience=(body,revision)=>'urn:wtf-private-learning:'+digest(stableJson({body,executed_revision:revision}));
const fail=code=>{throw new LearningError(code||'invalid_observation_proof');};
const decode=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9_-]+$/.test(value))fail();return Buffer.from(value,'base64url');};

// An expired token can authenticate immutable HISTORICAL queue/issuance
// evidence; it can never authorize a current action or renew taste evidence.
// Trust keys come only from GitHub's fixed HTTPS issuer, never from the record.
export function verifyObservationProof(token,body,revision,keys,{now=Date.now(),fresh=false}={}){
 if(!Number.isFinite(now)||typeof token!=='string'||token.length>32768||!/^[a-f0-9]{40}$/.test(revision))fail();
 const parts=token.split('.');if(parts.length!==3)fail();
 let header,claims;try{header=JSON.parse(decode(parts[0]));claims=JSON.parse(decode(parts[1]));}catch{fail();}
 if(header.alg!=='RS256'||header.typ!=='JWT'||typeof header.kid!=='string'||header.jku||header.jwk||header.x5u||header.crit)fail();
 if(!Array.isArray(keys)||keys.length>64)fail();
 const matching=keys.filter(k=>k.kid===header.kid);if(matching.length!==1)fail(matching.length===0?'proof_key_unavailable':null);
 const key=matching[0];if(key.kty!=='RSA'||key.use!=='sig'||(key.alg&&key.alg!=='RS256'))fail();
 try{if(!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key,format:'jwk'}),decode(parts[2])))fail();}catch{fail();}
 if(claims.iss!==PROOF_ISSUER||claims.aud!==proofAudience(body,revision)||claims.repository!==PROOF_REPOSITORY||claims.repository_id!=='1343321761'||claims.repository_owner_id!=='147663657'||claims.repository_visibility!=='private'
   ||claims.ref!=='refs/heads/main'||!/^[a-f0-9]{40}$/.test(claims.sha||'')||claims.workflow_ref!==PROOF_REPOSITORY+'/.github/workflows/learning-finalize.yml@refs/heads/main'
   ||!['schedule','push','workflow_run','workflow_dispatch'].includes(claims.event_name)||!/^\d+$/.test(claims.run_id||''))fail();
 const second=Math.floor(now/1000);
 if(![claims.iat,claims.nbf,claims.exp].every(Number.isSafeInteger)||claims.nbf>claims.iat||claims.exp<=claims.iat||claims.exp-claims.iat>1800||claims.iat>second+300||claims.nbf>second+300||(fresh&&claims.exp<=second))fail();
 return claims;
}

export function githubObservationProof({env=process.env,fetcher=fetch,clock=()=>new Date(),assertTriggerAncestor,timeoutMs=10000}={}){
 if(!Number.isInteger(timeoutMs)||timeoutMs<10||timeoutMs>20000)fail();
 let keys,keysAt=0,refreshing=null,lastForced=-Infinity;
 const json=async(url,options={})=>{
  const controller=new AbortController();let timer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new LearningError('proof_transport_failure'));},timeoutMs);});
  try{return await Promise.race([(async()=>{
   let response,text;
   try{response=await fetcher(url,{...options,redirect:'error',signal:controller.signal});}catch{fail('proof_transport_failure');}
   if(!response.ok){
    if([401,403].includes(response.status))fail('proof_credentials_required');
    fail([408,429].includes(response.status)||response.status>=500?'proof_transport_failure':'invalid_observation_proof');
   }
   if(response.body){
    const chunks=[];let size=0;
    try{for await(const chunk of response.body){size+=chunk.length;if(size>256*1024)fail();chunks.push(chunk);}}
    catch(error){if(error instanceof LearningError)throw error;fail('proof_transport_failure');}
    const raw=Buffer.concat(chunks);text=raw.toString('utf8');if(!Buffer.from(text).equals(raw))fail();
   }else try{text=await response.text();}catch{fail('proof_transport_failure');}
   if(Buffer.byteLength(text)>256*1024)fail();
   try{return JSON.parse(text);}catch{fail();}
  })(),deadline]);}finally{clearTimeout(timer);controller.abort();}
 };
 const trustedKeys=async(force=false)=>{
  const now=+clock();if(!Number.isFinite(now))fail();
  if(force&&now-lastForced>=5000){keysAt=0;lastForced=now;}
  if(keys&&now>=keysAt&&now-keysAt<5*60*1000&&keysAt!==0)return keys;
  if(!refreshing)refreshing=(async()=>{
   const document=await json(PROOF_ISSUER+'/.well-known/jwks');if(!Array.isArray(document.keys)||document.keys.length>64)fail();
   keys=document.keys;keysAt=now;return keys;
  })().finally(()=>{refreshing=null;});
  return refreshing;
 };
 const verifyToken=async(token,body,revision,fresh=false)=>{
  for(let attempt=0;attempt<2;attempt++){
   try{return verifyObservationProof(token,body,revision,await trustedKeys(attempt===1),{now:+clock(),fresh});}
   catch(error){if(error.code!=='proof_key_unavailable'||attempt===1)throw error;}
  }
 };
 const checkTrigger=async(claims,revision)=>{
  if(claims.sha!==revision){if(typeof assertTriggerAncestor!=='function')fail();await assertTriggerAncestor(claims.sha,revision);}
  return claims;
 };
 return {
  async verify(token,body,revision){return checkTrigger(await verifyToken(token,body,revision),revision);},
  async sign(body,revision){
   if(!env.ACTIONS_ID_TOKEN_REQUEST_URL||!env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)fail('proof_credentials_required');
   const url=new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
   if(url.protocol!=='https:'||url.username||url.password||!url.hostname.endsWith('.actions.githubusercontent.com'))fail();
   url.searchParams.set('audience',proofAudience(body,revision));
   const result=await json(url,{headers:{Authorization:'Bearer '+env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}});
   await checkTrigger(await verifyToken(result.value,body,revision,true),revision);return result.value;
  }
 };
}
