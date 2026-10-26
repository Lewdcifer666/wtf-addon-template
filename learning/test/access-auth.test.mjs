import assert from 'node:assert/strict';
import {test,mock} from 'node:test';
import {request as httpRequest} from 'node:http';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createAccessAuthenticator} from '../access-auth.mjs';
import {startLocalResearchMcpHost} from '../research-mcp-host.mjs';

// Ephemeral caller-auth keys only; never evidence-provenance keys or live config.
const config={issuer:'https://synthetic-owner.cloudflareaccess.com',audience:'a'.repeat(64),
 subject:'synthetic-owner-id',email:'owner@example.invalid'};
const first=await generateKeyPair('RS256'),second=await generateKeyPair('RS256');
const jwk=async(key,kid)=>({...await exportJWK(key.publicKey),alg:'RS256',use:'sig',kid});
const keys=[await jwk(first,'first'),await jwk(second,'second')];
const baseTime=Date.now();
async function token({claims={},remove=[],header={},key=first.privateKey,time=baseTime}={}){
 const seconds=Math.floor(time/1000),payload={iss:config.issuer,aud:[config.audience],sub:config.subject,
  email:config.email,type:'app',iat:seconds,nbf:seconds,exp:seconds+3600,...claims};
 for(const name of remove)delete payload[name];
 return new SignJWT(payload).setProtectedHeader({alg:'RS256',typ:'JWT',kid:'first',...header}).sign(key);
}
const keyResponse=(value={keys:[keys[0]]})=>Response.json(value);

test('Access configuration pins one team, app and human identity and refuses incomplete or executable options',async()=>{
 for(const value of [undefined,null,[],{}, {...config,issuer:'https://cloudflareaccess.com'},
  {...config,issuer:'https://synthetic-owner.cloudflareaccess.com/'},
  {...config,issuer:'https://synthetic-owner.cloudflareaccess.com@evil.invalid'},
  {...config,issuer:'http://synthetic-owner.cloudflareaccess.com'},
  {...config,issuer:'https://synthetic-owner.cloudflareaccess.com:443'},
  {...config,audience:'*'},{...config,subject:''},{...config,email:'*'},
  {...config,keys},{...config,authorize:()=>true}])assert.throws(()=>createAccessAuthenticator(value),/invalid_private_access_config/);
 const callerConfig={...config};const verify=createAccessAuthenticator(callerConfig,{fetchImpl:async()=>keyResponse()});
 callerConfig.subject='different';assert.equal(await verify(await token()),true);
});

test('Access verifies signature, fixed issuer/audience/subject/email and fresh identity-based app claims',async()=>{
 let reads=0;
 const verify=createAccessAuthenticator(config,{now:()=>baseTime,fetchImpl:async(url,options)=>{
  reads++;assert.equal(url,config.issuer+'/cdn-cgi/access/certs');
  assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');assert.equal(options.credentials,'omit');
  assert.deepEqual(options.headers,{Accept:'application/json'});assert(options.signal instanceof AbortSignal);
  return keyResponse();
 }});
 assert.equal(await verify(await token()),true);
 const badClaims=[{iss:'https://other.cloudflareaccess.com'},{aud:['b'.repeat(64)]},{sub:'different'},
  {email:'other@example.invalid'},{type:'org'},{iat:Math.floor(baseTime/1000)+31},
  {exp:Math.floor(baseTime/1000)-31},{nbf:Math.floor(baseTime/1000)+31},
  {iat:'yesterday'},{iat:Math.floor(baseTime/1000)+.5},{exp:Math.floor(baseTime/1000)+.5},
  {iat:Math.floor(baseTime/1000),exp:Math.floor(baseTime/1000)},
  {sub:'',email:undefined,common_name:'service-identity'}];
 for(const claims of badClaims)assert.equal(await verify(await token({claims})),false,JSON.stringify(claims));
 for(const name of ['iss','aud','sub','email','type','iat','exp'])assert.equal(await verify(await token({remove:[name]})),false,name);
 assert.equal(await verify(await token({key:second.privateKey})),false);
 assert.equal(reads,1);
});

test('untrusted JWT headers cannot select endpoints, algorithms or inline keys',async()=>{
 let reads=0;const verify=createAccessAuthenticator(config,{fetchImpl:async()=>{reads++;return keyResponse();}});
 for(const header of [{typ:'not-jwt'},{kid:''},{kid:'x'.repeat(257)},{jku:'https://evil.invalid/keys'},
  {jwk:keys[0]},{x5u:'https://evil.invalid/cert'}])assert.equal(await verify(await token({header})),false);
 const unsigned=Buffer.from(JSON.stringify({alg:'none',kid:'first',typ:'JWT'})).toString('base64url')+'.e30.eA';
 const hmac=await new SignJWT({}).setProtectedHeader({alg:'HS256',typ:'JWT',kid:'first'}).sign(new Uint8Array(32));
 for(const value of [undefined,'',unsigned,hmac,'x'.repeat(6145),'e30.e30.eA, duplicate'])assert.equal(await verify(value),false);
 assert.equal(reads,0);
});

test('Cloudflare assertions without optional typ retain every signature, owner and app-claim check',async()=>{
 const header={typ:undefined};
 const verify=createAccessAuthenticator(config,{now:()=>baseTime,fetchImpl:async()=>keyResponse()});
 assert.equal(await verify(await token({header})),true);
 for(const claims of [{iss:'https://other.cloudflareaccess.com'},{aud:['b'.repeat(64)]},{sub:'other'},
  {email:'other@example.invalid'},{type:'org'},{exp:Math.floor(baseTime/1000)-31},
  {nbf:Math.floor(baseTime/1000)+31},{iat:Math.floor(baseTime/1000)+31}]){
  assert.equal(await verify(await token({header,claims})),false);
 }
 for(const name of ['iss','aud','sub','email','type','iat','exp'])assert.equal(await verify(await token({header,remove:[name]})),false,name);
 assert.equal(await verify(await token({header,key:second.privateKey})),false);
 for(const typ of ['not-jwt','at+jwt','org',null,1])assert.equal(await verify(await token({header:{typ}})),false);
});

test('key fetch is shared, bounded and cached; rotation and expiry never reuse stale or unavailable keys',async()=>{
 let time=baseTime,reads=0,available=0,broken=false;
 const verify=createAccessAuthenticator(config,{now:()=>time,fetchImpl:async()=>{
  reads++;await new Promise(resolve=>setTimeout(resolve,5));
  if(broken)throw Error('PRIVATE_SENTINEL');return keyResponse({keys:[keys[available]]});
 }});
 const old=await token(),rotated=await token({header:{kid:'second'},key:second.privateKey});
 assert.deepEqual(await Promise.all(Array.from({length:12},()=>verify(old))),Array(12).fill(true));assert.equal(reads,1);
 available=1;assert.equal(await verify(rotated),false);assert.equal(reads,1);
 time+=30001;assert.equal(await verify(rotated),true);assert.equal(reads,2);
 assert.equal(await verify(old),false);assert.equal(reads,2);
 time+=300001;broken=true;
 assert.equal(await verify(rotated),false);assert.equal(reads,3);
 assert.equal(await verify(rotated),false);assert.equal(reads,3);
 time+=30001;broken=false;assert.equal(await verify(rotated),true);assert.equal(reads,4);
});

test('unavailable and malformed key responses fail closed, including initial failure cooldown',async()=>{
 const responses=[()=>new Response('',{status:302,headers:{Location:'https://evil.invalid'}}),
  ()=>new Response('',{status:503}),()=>new Response('{'),()=>Response.json({keys:[]}),
  ()=>Response.json({keys:Array(33).fill(keys[0])}),()=>Response.json({keys:[keys[0],keys[0]]}),
  ()=>Response.json({keys:[{...keys[0],d:'PRIVATE_SENTINEL'}]}),
  ()=>Response.json({keys:[{...keys[0],use:'enc'}]}),
  ()=>new Response('x',{headers:{'Content-Length':'65537'}}),()=>new Response('x'.repeat(65537)),
  ()=>new Response(new Uint8Array([255,254]))];
 const valid=await token();
 for(const response of responses){
  let reads=0;const verify=createAccessAuthenticator(config,{fetchImpl:async()=>{reads++;return response();}});
  assert.equal(await verify(valid),false);assert.equal(await verify(valid),false);assert.equal(reads,1);
 }
});

test('key-fetch timeout covers the response body as well as headers',async()=>{
 let aborted=false;
 const verify=createAccessAuthenticator(config,{fetchImpl:async(_,options)=>new Response(new ReadableStream({
  start(controller){options.signal.addEventListener('abort',()=>{aborted=true;controller.error(Error('aborted'));},{once:true});}
 }))});
 const start=Date.now();assert.equal(await verify(await token()),false);
 assert.equal(aborted,true);assert(Date.now()-start<7000);
});

test('loopback Access mode authenticates MCP initialization, discovery and health; valid identity leaves adapter held',async()=>{
 const originalFetch=globalThis.fetch;let certReads=0;
 const fetchMock=mock.method(globalThis,'fetch',async(url,options)=>{
  if(url===config.issuer+'/cdn-cgi/access/certs'){certReads++;return keyResponse();}
  return originalFetch(url,options);
 });
 const host=await startLocalResearchMcpHost({access:config}),client=new Client({name:'synthetic-access-client',version:'1'});
 const valid=await token({header:{typ:undefined}}),headers={'Cf-Access-Jwt-Assertion':valid};
 try{
  assert.equal((await originalFetch(host.url,{method:'POST'})).status,401);
  assert.equal((await originalFetch(host.url,{method:'POST',headers:{Authorization:'Bearer '+'x'.repeat(43)}})).status,401);
  assert.equal((await originalFetch(host.url,{method:'POST',headers:{...headers,Origin:'https://evil.invalid'}})).status,403);
  assert.equal((await originalFetch(host.url.replace('/mcp','/healthz'))).status,401);
  const health=await originalFetch(host.url.replace('/mcp','/healthz'),{headers});
  assert.equal(health.status,200);assert.equal((await health.json()).publication_capability,false);
  await client.connect(new StreamableHTTPClientTransport(new URL(host.url),{requestInit:{headers}}));
  assert.equal((await client.listTools()).tools.length,5);
  const result=await client.callTool({name:'private_research_open',arguments:{schema_version:1,genre:'scifi',research_date:'2026-10-25',private_revision:'a'.repeat(40),public_revision:'b'.repeat(40)}});
  assert.equal(result.structuredContent.error,'private_task_access_held');assert.equal(certReads,1);
 }finally{await client.close();await host.close();fetchMock.mock.restore();}
});

test('Access rejects duplicate assertions and forged forwarded identities before dispatch, with closed errors',async()=>{
 const originalFetch=globalThis.fetch;
 const fetchMock=mock.method(globalThis,'fetch',async(url,options)=>url===config.issuer+'/cdn-cgi/access/certs'?keyResponse():originalFetch(url,options));
 let calls=0;const host=await startLocalResearchMcpHost({access:config,adapter:{async dispatch(){calls++;return {};}}});
 try{
  const valid=await token(),other=await token({claims:{sub:'other'}});
  const duplicate=await new Promise((resolve,reject)=>{
   const req=httpRequest(host.url,{method:'POST',headers:['Host',new URL(host.url).host,'Cf-Access-Jwt-Assertion',valid,'Cf-Access-Jwt-Assertion',valid]},res=>{res.resume();resolve(res.statusCode);});
   req.on('error',reject);req.end();
  });assert.equal(duplicate,401);
  for(const headers of [{'Cf-Access-Jwt-Assertion':other,'Cf-Access-Authenticated-User-Email':config.email},
   {'Cf-Access-Jwt-Assertion':'PRIVATE_SENTINEL','Cf-Access-Authenticated-User-Email':config.email}]){
   const response=await originalFetch(host.url,{method:'POST',headers});assert.equal(response.status,401);
   assert.deepEqual(await response.json(),{error:'private_host_unauthorized'});
  }
  assert.equal(calls,0);
 }finally{await host.close();fetchMock.mock.restore();}
});

test('host refuses ambiguous auth and invalid Access config before opening a listener',async()=>{
 await assert.rejects(startLocalResearchMcpHost({access:config,bearerToken:'x'.repeat(43)}),/ambiguous_private_host_auth/);
 await assert.rejects(startLocalResearchMcpHost({access:{...config,subject:''}}),/invalid_private_access_config/);
});
