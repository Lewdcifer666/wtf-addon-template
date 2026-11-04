// Synthetic transport regression. No private data, real endpoint or credential.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {createPrivatePcGateway} from '../pc-gateway.mjs';
import {createResearchBrokerAdapter} from '../research-broker.mjs';
import {workerRequestHash} from '../research-worker.mjs';

test('one end-to-end broker budget returns closed pending before the gateway deadline',async context=>{
 const access={issuer:'https://synthetic-budget.cloudflareaccess.com',audience:'a'.repeat(64),subject:'synthetic-owner',email:'owner@example.invalid'},origin='https://synthetic-budget.example.workers.dev';
 const pair=await generateKeyPair('RS256'),key={...await exportJWK(pair.publicKey),alg:'RS256',use:'sig',kid:'budget'};
 const second=Math.floor(Date.now()/1000),jwt=await new SignJWT({iss:access.issuer,aud:[access.audience],sub:access.subject,email:access.email,type:'app',iat:second,exp:second+3600}).setProtectedHeader({alg:'RS256',kid:'budget'}).sign(pair.privateKey);
 let entered,dispatched;const began=new Promise(r=>{entered=r;}),submitted=new Promise(r=>{dispatched=r;});let now=0,first=true,dispatches=0;
 const call={schema_version:1,operation:'open',request:{schema_version:1,genre:'scifi',research_date:'2026-11-04',private_revision:'a'.repeat(40),public_revision:'b'.repeat(40)}};
 const api={repository:'Lewdcifer666/wtf-scifi-feedback',writable:false,async get(){if(first){first=false;entered();await new Promise(r=>setTimeout(r,5000));}return {full_name:this.repository,private:true,default_branch:'main'};},pinMain:async()=>({sha:'a'.repeat(40)}),optional:async route=>route.includes('/interpretation/')?{ref:'refs/heads/interpretation/'+'a'.repeat(40),object:{sha:'c'.repeat(40)}}:null};
 const publicApis=Object.fromEntries(['action','anime','fantasy','mystery','scifi','thriller'].map(g=>[g,{repository:`Lewdcifer666/wtf-${g}-stremio`,pinMain:async()=>({sha:'b'.repeat(40)}),optional:async()=>null}]));
 let reserved=false;const store={pending:async()=>[],reserve:async c=>({call:c,request_hash:workerRequestHash(c)}),reserveDispatch:async()=>{if(reserved)return false;reserved=true;return true;},complete:async()=>{},completed:async()=>null};
 const broker=createResearchBrokerAdapter({api,publicApis,proof:{verify:async()=>{}},store,taskAccessAllowed:async()=>true,resultWaitMs:30000,monotonic:()=>now,clock:()=>new Date('2026-11-04T12:00:00Z'),dispatchWorker:async()=>{dispatches++;dispatched();}});
 const gateway=createPrivatePcGateway({access,publicOrigin:origin,port:6505,binding:{fetch:async(_url,options)=>{
  const result=broker.dispatch(call).then(value=>({value}),error=>({error:error.code}));
  return Promise.race([result.then(result=>Response.json({jsonrpc:'2.0',id:'budget',result})),new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Error('synthetic_abort')),{once:true}))]);
 }}},{fetchImpl:async()=>Response.json({keys:[key]})});
 context.mock.timers.enable({apis:['setTimeout']});
 const flush=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));};
 try{
  const pending=gateway.fetch(new Request(origin+'/mcp',{method:'POST',headers:{'Content-Type':'application/json','Cf-Access-Jwt-Assertion':jwt},body:JSON.stringify({jsonrpc:'2.0',id:'budget',method:'tools/call',params:{name:'private_research_open',arguments:call.request}})}));
  await began;now=5000;context.mock.timers.tick(5000);await submitted;await flush();
  now=22000;context.mock.timers.tick(17000);await flush();
  const response=await pending;assert.equal(response.status,200);assert.equal((await response.json()).result.error,'private_task_pending');assert.equal(dispatches,1);
  now=60000;context.mock.timers.tick(38000);await flush();assert.equal(dispatches,1);
 }finally{context.mock.timers.reset();}
});
