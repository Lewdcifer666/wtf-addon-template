import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import {spawnSync} from 'node:child_process';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createResearchMcpServer,startLocalResearchMcpHost} from '../research-mcp-host.mjs';
import {researchTaskCallSchema} from '../research-task-adapter.mjs';
const request={schema_version:1,genre:'scifi',research_date:'2026-10-15',private_revision:'a'.repeat(40),public_revision:'b'.repeat(40)};
async function memoryClient(adapter){
 const server=createResearchMcpServer(adapter),client=new Client({name:'synthetic-private-client',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();
 await server.connect(a);await client.connect(b);return {client,close:async()=>{await client.close();await server.close();}};
}
test('official MCP client initializes, discovers honest side effects and receives the default hold without any repository access',async()=>{
 const connection=await memoryClient();
 try{
  const {tools}=await connection.client.listTools();assert.equal(tools.length,4);
  assert.equal(tools.find(t=>t.name==='private_research_open').annotations.readOnlyHint,false);
  assert.equal(tools.find(t=>t.name==='private_research_search').annotations.readOnlyHint,false);
  assert.equal(tools.find(t=>t.name==='private_research_context').annotations.readOnlyHint,true);
  assert.equal(tools.find(t=>t.name==='private_research_verify').annotations.readOnlyHint,true);
  const result=await connection.client.callTool({name:'private_research_open',arguments:request});
  assert.equal(result.isError,true);assert.deepEqual(result.structuredContent,{schema_version:1,error:'private_task_access_held'});
 }finally{await connection.close();}
});
test('authenticated loopback HTTP completes actual MCP initialization and calls while rejecting unauthenticated and browser-origin traffic',async()=>{
 const token=randomBytes(32).toString('base64url'),calls=[];
 const host=await startLocalResearchMcpHost({bearerToken:token,adapter:{async dispatch(call){calls.push(call);return {schema_version:1,operation:call.operation};}}});
 const client=new Client({name:'synthetic-http-client',version:'1'});
 try{
  assert(host.url.startsWith('http://127.0.0.1:'));
  assert.equal((await fetch(host.url,{method:'POST'})).status,401);
  assert.equal((await fetch(host.url,{method:'POST',headers:{Authorization:'Bearer wrong'}})).status,401);
  assert.equal((await fetch(host.url,{method:'POST',headers:{Authorization:'Bearer '+token,Origin:'https://evil.invalid'}})).status,403);
  const hostileHost=await new Promise((resolve,reject)=>{
   const req=httpRequest(host.url,{method:'POST',headers:{Authorization:'Bearer '+token,Host:'evil.invalid'}},res=>{res.resume();resolve(res.statusCode);});
   req.on('error',reject);req.end();
  });assert.equal(hostileHost,403);
  assert.equal((await fetch(host.url.replace('/mcp','/healthz'),{headers:{Authorization:'Bearer '+token}})).status,200);
  await client.connect(new StreamableHTTPClientTransport(new URL(host.url),{requestInit:{headers:{Authorization:'Bearer '+token}}}));
  const result=await client.callTool({name:'private_research_open',arguments:request});
  assert.deepEqual(result.structuredContent,{schema_version:1,operation:'open'});assert.equal(calls.length,1);
  assert.deepEqual(calls[0],{schema_version:1,operation:'open',request});
 }finally{await client.close();await host.close();}
});
test('MCP rejects unknown tools, injected execution options and malformed arguments before dispatch',async()=>{
 let calls=0;const connection=await memoryClient({async dispatch(){calls++;return {schema_version:1};}});
 try{
  for(const call of [{name:'stage_interpretation',arguments:{content:'PRIVATE_SENTINEL'}},
   {name:'private_research_open',arguments:{...request,credentials:'PRIVATE_SENTINEL'}},
   {name:'private_research_open',arguments:{...request,taskAccessAllowed:true}},
   {name:'private_research_verify',arguments:{task_token:'not-an-opaque-token',research_commit:'c'.repeat(40)}}]){
   const result=await connection.client.callTool(call);assert.equal(result.isError,true);assert.equal(result.structuredContent.error,'invalid_task_call');
   assert(!JSON.stringify(result).includes('PRIVATE_SENTINEL'));
  }assert.equal(calls,0);
 }finally{await connection.close();}
});
test('HTTP rejects oversized, malformed, invalid UTF-8, batch and encoded bodies without task execution',async()=>{
 const token=randomBytes(32).toString('base64url');let calls=0;
 const host=await startLocalResearchMcpHost({bearerToken:token,adapter:{async dispatch(){calls++;return {};}}});
 const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
 try{
  for(const [body,status,extra] of [['{',400,{}],['[]',400,{}],[Buffer.from([123,34,113,34,58,34,255,34,125]),400,{}],
   ['x'.repeat(1024*1024+1),413,{}],['{}',415,{'Content-Encoding':'gzip'}]]){
   assert.equal((await fetch(host.url,{method:'POST',headers:{...headers,...extra},body})).status,status);
  }
  assert.equal((await fetch(host.url,{headers})).status,405);
  assert.equal((await fetch(host.url+'?secret=PRIVATE_SENTINEL',{method:'POST',headers,body:'{}'})).status,404);
  assert.equal(calls,0);
 }finally{await host.close();}
});
test('MCP uses closed error codes and bounded responses rather than echoing private host failures',async()=>{
 for(const mode of ['exception','oversized']){
  const connection=await memoryClient({async dispatch(){
   if(mode==='exception')throw Object.assign(Error('PRIVATE_SENTINEL stack and token'),{code:'PRIVATE_SENTINEL'});
   return {body:'PRIVATE_SENTINEL'.repeat(100000)};
  }});
  try{
   const result=await connection.client.callTool({name:'private_research_open',arguments:request});
   assert.equal(result.isError,true);assert.equal(result.structuredContent.error,'private_task_failed');assert(!JSON.stringify(result).includes('PRIVATE_SENTINEL'));
  }finally{await connection.close();}
 }
});
test('schema discovery cannot modify the authoritative closed contract',async()=>{
 const schema=researchTaskCallSchema();schema.oneOf[0].properties.request.additionalProperties=true;
 const connection=await memoryClient();
 try{assert.equal((await connection.client.listTools()).tools.find(t=>t.name==='private_research_open').inputSchema.additionalProperties,false);}
 finally{await connection.close();}
});
test('local host refuses absent credentials and CLI starts no listener with missing credentials or unknown options',async()=>{
 await assert.rejects(startLocalResearchMcpHost(),/private_host_credentials_required/);
 const env={...process.env};delete env.PRIVATE_RESEARCH_MCP_TOKEN;
 for(const args of [['--port','0'],['--enable-learning','true']]){
  const result=spawnSync(process.execPath,['learning/research-mcp-host.mjs',...args],{encoding:'utf8',env,windowsHide:true});
  assert.notEqual(result.status,0);assert(!result.stdout.includes('ready'));assert(!result.stderr.includes('Bearer'));
 }
});
