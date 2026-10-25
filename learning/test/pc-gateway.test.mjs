import assert from 'node:assert/strict';
import {test,mock} from 'node:test';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import worker,{createPrivatePcGateway} from '../pc-gateway.mjs';
import {startLocalResearchMcpHost} from '../research-mcp-host.mjs';

const access={issuer:'https://synthetic-gateway.cloudflareaccess.com',audience:'b'.repeat(64),subject:'synthetic-owner',email:'owner@example.invalid'};
const origin='https://wtf-private-research-gateway.synthetic.workers.dev';
const pair=await generateKeyPair('RS256'),key={...await exportJWK(pair.publicKey),alg:'RS256',use:'sig',kid:'synthetic'};
async function token(claims={},header={}){
 const seconds=Math.floor(Date.now()/1000);
 return new SignJWT({iss:access.issuer,aud:[access.audience],sub:access.subject,email:access.email,type:'app',iat:seconds,exp:seconds+3600,...claims})
  .setProtectedHeader({alg:'RS256',typ:'JWT',kid:'synthetic',...header}).sign(pair.privateKey);
}
const jwt=await token(),headers={'Cf-Access-Jwt-Assertion':jwt,'Content-Type':'application/json'};
const rpc={jsonrpc:'2.0',id:'stable-request-id',method:'tools/list'};
const request=(body=JSON.stringify(rpc),extra={})=>new Request(origin+'/mcp',{method:'POST',headers,body,...extra});
const answer=()=>Response.json({jsonrpc:'2.0',id:rpc.id,result:{tools:[]}});
function gateway(binding,other={}){return createPrivatePcGateway({access,publicOrigin:origin,port:6505,binding,...other},
 {fetchImpl:async()=>Response.json({keys:[key]})});}

test('gateway deployment is held by default and configuration cannot enable arbitrary destinations',async()=>{
 let calls=0;const binding={fetch(){calls++;return answer();}};
 assert.equal((await worker.fetch(request(),{PRIVATE_RESEARCH:binding})).status,503);
 assert.equal((await worker.fetch(request(),{PRIVATE_GATEWAY_ENABLED:'true',PRIVATE_RESEARCH:binding})).status,503);
 assert.equal(calls,0);
 for(const extra of [{publicOrigin:'https://evil.invalid'},{publicOrigin:origin+'/'},{port:0},{port:65536},{binding:{}}])
  assert.throws(()=>gateway(binding,extra),/invalid_private_gateway_config/);
});

test('origin verifies Access owner identity before any VPC request, without bearer fallback',async()=>{
 let calls=0;const connection=gateway({async fetch(){calls++;return answer();}});
 for(const input of [new Request(origin+'/mcp',{method:'POST'}),request('{}',{headers:{Authorization:'Bearer '+jwt}}),
  request('{}',{headers:{...headers,'Cf-Access-Jwt-Assertion':await token({sub:'other'})}}),
  request('{}',{headers:{...headers,'Cf-Access-Jwt-Assertion':jwt+', '+jwt}}),
  request('{}',{headers:{...headers,'Cf-Access-Jwt-Assertion':'PRIVATE_SENTINEL','Cf-Access-Authenticated-User-Email':access.email}})]){
  const response=await connection.fetch(input);assert.equal(response.status,401);
  assert.deepEqual(await response.json(),{error:'private_gateway_unauthorized'});
 }assert.equal(calls,0);
});

test('gateway accepts absent optional typ only with valid signed owner app claims',async()=>{
 let calls=0;const connection=gateway({async fetch(){calls++;return answer();}});
 const assertion=await token({},{typ:undefined});
 assert.equal((await connection.fetch(request(undefined,{headers:{...headers,'Cf-Access-Jwt-Assertion':assertion}}))).status,200);
 for(const claims of [{sub:'other'},{email:'other@example.invalid'},{type:'org'}]){
  const denied=await token(claims,{typ:undefined});
  assert.equal((await connection.fetch(request(undefined,{headers:{...headers,'Cf-Access-Jwt-Assertion':denied}}))).status,401);
 }
 assert.equal(calls,1);
});

test('gateway rejects browser origins, alternate routes, encoded, malformed and oversized requests before forwarding',async()=>{
 let calls=0;const connection=gateway({async fetch(){calls++;return answer();}});
 const cases=[[request('{}',{headers:{...headers,Origin:origin}}),403],
  [request('{}',{headers:{...headers,Upgrade:'websocket'}}),403],
  [new Request('https://other.synthetic.workers.dev/mcp',{method:'POST',headers,body:'{}'}),403],
  [new Request(origin+'/mcp?target=https://evil.invalid',{method:'POST',headers,body:'{}'}),403],
  [new Request(origin+'/private-history',{headers}),405],
  [request('{}',{headers:{...headers,'Content-Encoding':'gzip'}}),415],
  [request('{}',{headers:{...headers,'Content-Type':'text/plain'}}),415],
  [request('[]'),400],[request('{'),400],[request(Buffer.from([255,254])),400],
  [request(JSON.stringify({...rpc,id:'x'.repeat(129)})),400],
  [request('x'.repeat(1024*1024+1)),413],
  [request('{}',{headers:{...headers,'Content-Length':'1048577'}}),413],
  [request(JSON.stringify(rpc),{headers:{...headers,'MCP-Protocol-Version':'PRIVATE_SENTINEL'}}),400]];
 for(const [input,status] of cases)assert.equal((await connection.fetch(input)).status,status);
 assert.equal(calls,0);
});

test('gateway preserves RPC bytes/identity and forwards only the signed identity to one configured service',async()=>{
 const calls=[];const connection=gateway({async fetch(url,options){calls.push({url,options});return answer();}});
 const bytes=JSON.stringify(rpc,null,2),response=await connection.fetch(request(bytes,{headers:{...headers,
  Cookie:'PRIVATE_SENTINEL',Authorization:'Bearer PRIVATE_SENTINEL',Host:'evil.invalid',
  'X-Forwarded-Host':'evil.invalid','MCP-Protocol-Version':'2025-06-18'}}));
 assert.equal(response.status,200);assert.equal(calls.length,1);
 assert.equal(calls[0].url,'http://127.0.0.1:6505/mcp');assert.equal(calls[0].options.body.toString(),bytes);
 assert.deepEqual(calls[0].options.headers,{'Cf-Access-Jwt-Assertion':jwt,Accept:'application/json, text/event-stream',
  'Content-Type':'application/json','MCP-Protocol-Version':'2025-06-18'});
 assert.equal(calls[0].options.redirect,'manual');assert(calls[0].options.signal instanceof AbortSignal);
 assert.equal((await response.json()).id,rpc.id);assert.equal(response.headers.get('cache-control'),'no-store');
});

test('uncertain, redirected or corrupt backend outcomes never replay or leak backend content',async()=>{
 const bad=[()=>{throw Error('PRIVATE_SENTINEL');},()=>new Response('PRIVATE_SENTINEL',{status:302,headers:{Location:'https://evil.invalid'}}),
  ()=>new Response('PRIVATE_SENTINEL',{status:500}),()=>new Response('PRIVATE_SENTINEL'),
  ()=>Response.json({...rpc,id:'different',result:{}}),()=>Response.json({private:'PRIVATE_SENTINEL'}),
  ()=>new Response('x'.repeat(1024*1024+1),{headers:{'Content-Type':'application/json'}}),
  ()=>new Response('{}',{headers:{'Content-Type':'application/json','Content-Length':'1048577'}})];
 for(const make of bad){
  let calls=0;const connection=gateway({async fetch(){calls++;return make();}});
  const response=await connection.fetch(request());assert.equal(response.status,502);assert.equal(calls,1);
  assert.deepEqual(await response.json(),{error:'private_gateway_upstream_pending'});
 }
});

test('health reports transport only and notifications preserve empty 202 responses',async()=>{
 const connection=gateway({async fetch(url){
  if(url.endsWith('/healthz'))return Response.json({schema_version:1,transport:'ready',learning_activation:'not_asserted',publication_capability:false,private:'PRIVATE_SENTINEL'});
  return new Response(null,{status:202,headers:{'Set-Cookie':'PRIVATE_SENTINEL'}});
 }});
 const health=await connection.fetch(new Request(origin+'/healthz',{headers}));assert.equal(health.status,200);
 assert.deepEqual(await health.json(),{schema_version:1,transport:'ready',learning_activation:'not_asserted',publication_capability:false});
 const notice=await connection.fetch(request(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})));
 assert.equal(notice.status,202);assert.equal(await notice.text(),'');assert.equal(notice.headers.get('set-cookie'),null);
 assert.equal((await connection.fetch(request())).status,502);
});

test('aborted request bodies cannot reach the private service',async()=>{
 const abort=new AbortController();let calls=0;
 const connection=gateway({async fetch(){calls++;return answer();}});
 const result=connection.fetch(request(new ReadableStream({start(){}}),{signal:abort.signal,duplex:'half'}));
 await new Promise(resolve=>setImmediate(resolve));abort.abort();
 assert.equal((await result).status,504);assert.equal(calls,0);
});

test('deadline covers stalled backend response bodies and preserves ambiguous outcome as pending',async context=>{
 context.mock.timers.enable({apis:['setTimeout']});let calls=0,entered;
 const reached=new Promise(resolve=>{entered=resolve;}),abort=new AbortController();
 try{
  const connection=gateway({async fetch(){calls++;entered();return new Response(new ReadableStream({start(){}}),{headers:{'Content-Type':'application/json'}});}});
  const result=connection.fetch(request(JSON.stringify(rpc),{signal:abort.signal}));await reached;assert.equal(calls,1);
  context.mock.timers.tick(30001);const response=await result;assert.equal(response.status,504);assert.equal(calls,1);
  assert.deepEqual(await response.json(),{error:'private_gateway_upstream_pending'});
 }finally{abort.abort();context.mock.timers.reset();}
});

test('official MCP client crosses the gateway into real loopback HTTP while learning remains held',async()=>{
 const originalFetch=globalThis.fetch;
 const fetchMock=mock.method(globalThis,'fetch',async(url,options)=>url===access.issuer+'/cdn-cgi/access/certs'?Response.json({keys:[key]}):originalFetch(url,options));
 const host=await startLocalResearchMcpHost({access}),port=Number(new URL(host.url).port);let forwards=0;
 const connection=gateway({async fetch(url,options){forwards++;assert.equal(new URL(url).origin,`http://127.0.0.1:${port}`);return originalFetch(url,options);}},{port});
 const client=new Client({name:'synthetic-gateway-client',version:'1'});
 try{
  await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{
   requestInit:{headers:{'Cf-Access-Jwt-Assertion':jwt}},fetch:async(url,options)=>connection.fetch(new Request(url,options))}));
  assert.equal((await client.listTools()).tools.length,4);
  const result=await client.callTool({name:'private_research_open',arguments:{schema_version:1,genre:'scifi',research_date:'2026-10-25',private_revision:'a'.repeat(40),public_revision:'b'.repeat(40)}});
  assert.equal(result.isError,true);assert.equal(result.structuredContent.error,'private_task_access_held');assert(forwards>=4);
 }finally{await client.close();await host.close();fetchMock.mock.restore();}
});
