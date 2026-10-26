import assert from 'node:assert/strict';
import {test} from 'node:test';
import {generateKeyPairSync,verify} from 'node:crypto';
import {createBrokerAppTokenProvider} from '../broker-app-auth.mjs';
import {createBrokerGitHub} from '../broker-github.mjs';
import {createResearchWorkerDispatch} from '../research-worker-dispatch.mjs';
const keys=generateKeyPairSync('rsa',{modulusLength:2048}),privateKey=keys.privateKey.export({type:'pkcs8',format:'pem'});
const clock=()=>new Date('2026-10-26T10:00:00Z');
const data=now=>({token:'ghs_SYNTHETIC_APPID_JWT.only.for_tests',expires_at:new Date(+now+3600000).toISOString(),permissions:{actions:'write',contents:'read',metadata:'read'},repository_selection:'selected',
 repositories:[{id:1343321761,full_name:'Lewdcifer666/wtf-scifi-feedback',private:true}]});
const response=value=>new Response(JSON.stringify(value),{status:201,headers:{'content-type':'application/json'}});
const options={appId:'12345',installationId:'67890',privateKey,clock};

test('broker App JWT authenticates only token minting with fixed least-privilege private scope',async()=>{
 let calls=0;const getToken=createBrokerAppTokenProvider({...options,fetcher:async(url,request)=>{
  calls++;assert.equal(url,'https://api.github.com/app/installations/67890/access_tokens');assert.equal(request.method,'POST');
  assert.equal(request.redirect,'manual');assert.equal(request.credentials,'omit');
  assert.deepEqual(JSON.parse(request.body),{repository_ids:[1343321761],permissions:{actions:'write',contents:'read'}});
  const jwt=request.headers.Authorization.slice(7),[head,body,signature]=jwt.split('.'),claims=JSON.parse(Buffer.from(body,'base64url'));
  assert.deepEqual(JSON.parse(Buffer.from(head,'base64url')),{alg:'RS256',typ:'JWT'});
  assert.equal(claims.iss,'12345');assert.equal(claims.iat,+clock()/1000-60);assert.equal(claims.exp,+clock()/1000+300);
  assert.deepEqual(Object.keys(claims).sort(),['exp','iat','iss']);
  assert(verify('RSA-SHA256',Buffer.from(head+'.'+body),keys.publicKey,Buffer.from(signature,'base64url')));
  return response(data(clock()));
 }});
 assert.equal(await getToken(),data(clock()).token);assert.equal(await getToken(),data(clock()).token);assert.equal(calls,1);
});

test('single-flight installation-token refresh renews scoped API authentication without a PAT',async()=>{
 let now=clock(),calls=0;
 const getToken=createBrokerAppTokenProvider({...options,clock:()=>now,fetcher:async()=>{calls++;await new Promise(r=>setTimeout(r,10));return response({...data(now),token:'ghs_SYNTHETIC_TOKEN_'+calls});}});
 assert.deepEqual(await Promise.all([getToken(),getToken(),getToken()]),Array(3).fill('ghs_SYNTHETIC_TOKEN_1'));
 now=new Date(+now+56*60*1000);
 assert.deepEqual(await Promise.all([getToken(),getToken()]),Array(2).fill('ghs_SYNTHETIC_TOKEN_2'));assert.equal(calls,2);
});

test('excess permissions, another repository, unbounded lifetime and malformed credentials fail closed',async()=>{
 for(const mutate of [v=>{v.permissions.contents='write';},v=>{v.permissions.issues='write';},v=>{v.permissions.actions='read';},
  v=>{v.repositories[0].private=false;},v=>{v.repositories[0].id=1;},v=>{v.repositories.push(v.repositories[0]);},v=>{v.repository_selection='all';},
  v=>{v.expires_at=new Date(+clock()+7200000).toISOString();},v=>{v.token='PRIVATE_SENTINEL\n';}]){
  let calls=0;const value=data(clock());mutate(value);
  const getToken=createBrokerAppTokenProvider({...options,fetcher:async()=>{calls++;return response(value);}});
  await assert.rejects(getToken(),e=>e.code==='private_app_credentials_required'&&!String(e).includes('PRIVATE_SENTINEL'));assert.equal(calls,1);
 }
 assert.throws(()=>createBrokerAppTokenProvider({...options,privateKey:'PRIVATE_SENTINEL'}),e=>e.code==='private_app_credentials_required'&&!String(e).includes('PRIVATE_SENTINEL'));
});

test('minting does not retry redirects, errors, oversized bodies or uncertain transport',async()=>{
 for(const mode of ['redirect','error','oversize','timeout']){
  let calls=0;const getToken=createBrokerAppTokenProvider({...options,timeoutMs:20,fetcher:async()=>{
   calls++;if(mode==='timeout')return new Promise(()=>{});
   return new Response(mode==='oversize'?'x'.repeat(128*1024+1):'PRIVATE_SENTINEL',{status:mode==='redirect'?302:mode==='error'?503:201,headers:{'content-type':'application/json'}});
  }});
  await assert.rejects(getToken(),e=>e.code==='private_app_credentials_required'&&!String(e).includes('PRIVATE_SENTINEL'));assert.equal(calls,1);
 }
});

test('managed credentials reach only fixed GitHub reads/dispatch; no placeholder or expired token fallback',async()=>{
 const credential='ghs_SYNTHETIC_MANAGED_TOKEN';let minted=0,reads=0,dispatches=0;
 const getToken=async()=>{minted++;return credential;};
 const api=createBrokerGitHub({repository:'Lewdcifer666/wtf-scifi-feedback',getToken,fetcher:async(url,options)=>{
  reads++;assert.equal(options.headers.Authorization,'Bearer '+credential);return new Response('{}',{headers:{'content-type':'application/json'}});
 }});
 await api.get('/');assert.equal(api.token,'managed-private-installation-token');
 const call={schema_version:1,operation:'open',request:{schema_version:1,genre:'scifi',research_date:'2026-10-26',private_revision:'a'.repeat(40),public_revision:'b'.repeat(40)}};
 const dispatch=createResearchWorkerDispatch({getToken,fetcher:async(url,options)=>{dispatches++;assert.equal(options.headers.Authorization,'Bearer '+credential);return new Response(null,{status:204});}});
 await dispatch(call);assert.equal(reads,1);assert.equal(dispatches,1);assert.equal(minted,2);
 const unavailable=createBrokerGitHub({repository:'Lewdcifer666/wtf-scifi-feedback',getToken:async()=>{throw Error('PRIVATE_SENTINEL');},fetcher:async()=>{throw Error('must not call');}});
 await assert.rejects(unavailable.get('/'),e=>e.code==='transport_failure'&&!String(e).includes('PRIVATE_SENTINEL'));
});
