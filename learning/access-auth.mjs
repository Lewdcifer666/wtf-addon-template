// Caller identity only. This is never a replacement for GitHub OIDC provenance.
import {createLocalJWKSet,decodeProtectedHeader,jwtVerify,errors} from 'jose';
import {Buffer} from 'node:buffer';

const keyLimit=64*1024,cacheMs=5*60*1000,cooldownMs=30000;
const invalid=()=>Error('invalid_private_access_config');
export function createAccessAuthenticator(config,{fetchImpl=globalThis.fetch,now=Date.now}={}){
 if(!config||typeof config!=='object'||Array.isArray(config)||
  Object.keys(config).sort().join(',')!=='audience,email,issuer,subject')throw invalid();
 const {issuer,audience,subject,email}=config;
 if(typeof issuer!=='string'||!/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(issuer)||
  typeof audience!=='string'||!/^[a-f0-9]{64}$/.test(audience)||
  typeof subject!=='string'||!subject.length||subject.length>256||/[\s\x00-\x1f\x7f]/.test(subject)||
  typeof email!=='string'||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw invalid();
 const certs=issuer+'/cdn-cgi/access/certs';
 let local,loadedAt=-Infinity,lastAttempt=-Infinity,pending;
 async function reload(){
  if(pending)return pending;
  const time=now();
  // Failed fetches also cool down. Unknown kids cannot cause a request storm.
  if(time-lastAttempt<cooldownMs)throw Error('access_keys_pending');
  lastAttempt=time;
  pending=(async()=>{
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
   let response;
   try{
    // Workers supports manual/follow, not error. Manual plus the status check
    // below refuses redirects without following them to another destination.
    response=await fetchImpl(certs,{method:'GET',redirect:'manual',credentials:'omit',
     headers:{Accept:'application/json'},signal:controller.signal});
    if(response.status!==200||response.redirected||Number(response.headers.get('content-length'))>keyLimit)throw Error('access_keys_unavailable');
    const chunks=[];let bytes=0;
    for await(const chunk of response.body){bytes+=chunk.length;if(bytes>keyLimit)throw Error('access_keys_limit');chunks.push(chunk);}
    const raw=Buffer.concat(chunks),text=raw.toString('utf8');
    if(!Buffer.from(text,'utf8').equals(raw))throw Error('access_keys_invalid');
    const jwks=JSON.parse(text);
    if(!jwks||!Array.isArray(jwks.keys)||!jwks.keys.length||jwks.keys.length>32)throw Error('access_keys_invalid');
    // Only public RSA signing keys from the fixed issuer endpoint are usable.
    const keys=jwks.keys.filter(key=>key&&key.kty==='RSA'&&key.use==='sig'&&key.alg==='RS256'&&
     typeof key.kid==='string'&&key.kid.length>0&&key.kid.length<=256&&
     !['d','p','q','dp','dq','qi','oth','k'].some(name=>name in key));
    if(!keys.length||new Set(keys.map(key=>key.kid)).size!==keys.length)throw Error('access_keys_invalid');
    local=createLocalJWKSet({keys});loadedAt=now();
   }finally{
    clearTimeout(timer);controller.abort();
    try{await response?.body?.cancel();}catch{}
   }
  })();
  try{await pending;}finally{pending=undefined;}
 }
 async function resolveKey(header,token){
  const time=now();
  if(!local||time<loadedAt||time-loadedAt>=cacheMs)await reload();
  try{return await local(header,token);}
  catch(error){
   if(!(error instanceof errors.JWKSNoMatchingKey))throw error;
   await reload();return local(header,token);
  }
 }
 return async token=>{
  try{
   if(typeof token!=='string'||token.length>6144||! /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))return false;
   const header=decodeProtectedHeader(token);
   if(header.alg!=='RS256'||typeof header.kid!=='string'||!header.kid.length||header.kid.length>256||
    Object.keys(header).some(name=>!['alg','typ','kid'].includes(name))||header.typ!==undefined&&header.typ!=='JWT')return false;
   // Cloudflare's live Access assertions can omit RFC 7519's optional typ.
   // Explicit alternate types stay denied; signed app/owner claims remain required.
   const {payload}=await jwtVerify(token,resolveKey,{algorithms:['RS256'],issuer,audience,subject,
    requiredClaims:['exp','iat','email','type'],clockTolerance:30,currentDate:new Date(now())});
   const seconds=now()/1000;
   return payload.email===email&&payload.type==='app'&&Number.isSafeInteger(payload.iat)&&Number.isSafeInteger(payload.exp)&&
    payload.iat<=seconds+30&&payload.iat<payload.exp;
  }catch{return false;}
 };
}
