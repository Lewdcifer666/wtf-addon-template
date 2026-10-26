import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes} from 'node:crypto';
import {Client as LegacyClient} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {StreamableHTTPClientTransport as LegacyTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {Client as ModernClient,StreamableHTTPClientTransport as ModernTransport} from '@modelcontextprotocol/client';
import {createResearchMcpServer,startLocalResearchMcpHost} from '../research-mcp-host.mjs';
const expected={schema_version:1,transport:'ready',learning_activation:'not_asserted',publication_capability:false};

test('health is read-only and never dispatches, reads private context or accepts injected arguments',async()=>{
 let calls=0;
 const server=createResearchMcpServer({async dispatch(){calls++;throw Error('PRIVATE_SENTINEL');}});
 const client=new LegacyClient({name:'synthetic-health-client',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();
 await server.connect(a);await client.connect(b);
 try{
  const tool=(await client.listTools()).tools.find(t=>t.name==='private_research_health');
  assert.deepEqual(tool.inputSchema,{type:'object',properties:{},additionalProperties:false});
  assert.deepEqual(tool.annotations,{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false});
  for(const args of [{},undefined]){
   const result=await client.callTool({name:tool.name,...(args===undefined?{}:{arguments:args})});
   assert.deepEqual(result.structuredContent,expected);assert.equal(result.isError,undefined);
   assert.deepEqual(JSON.parse(result.content[0].text),expected);
  }
  for(const args of [{activate:true},{task_token:'PRIVATE_SENTINEL'},{credentials:'PRIVATE_SENTINEL'},{operation:'open'}]){
   const result=await client.callTool({name:tool.name,arguments:args});
   assert.equal(result.isError,true);assert.equal(result.structuredContent.error,'invalid_task_call');
   assert(!JSON.stringify(result).includes('PRIVATE_SENTINEL'));
  }
  // The SDK rejects a null argument before the closed tool handler runs.
  await assert.rejects(client.callTool({name:tool.name,arguments:null}),error=>error.code===-32602&&!error.message.includes('PRIVATE_SENTINEL'));
  assert.equal(calls,0);
 }finally{await client.close();await server.close();}
});

for(const modern of [false,true])test(`${modern?'modern':'legacy'} authenticated HTTP health matches the protected endpoint and leaves the adapter untouched`,async()=>{
 const token=randomBytes(32).toString('base64url');let calls=0;
 const host=await startLocalResearchMcpHost({bearerToken:token,adapter:{async dispatch(){calls++;throw Error('Private context must stay untouched');}}});
 const ClientType=modern?ModernClient:LegacyClient,TransportType=modern?ModernTransport:LegacyTransport;
 const client=new ClientType({name:'synthetic-http-health',version:'1'},modern?{versionNegotiation:{mode:{pin:'2026-07-28'}}}:{});
 const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
 try{
  const body=JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'private_research_health',arguments:{}}});
  assert.equal((await fetch(host.url,{method:'POST',headers:{'Content-Type':'application/json'},body})).status,401);
  assert.equal((await fetch(host.url,{method:'POST',headers:{...headers,Origin:'https://evil.invalid'},body})).status,403);
  await client.connect(new TransportType(new URL(host.url),{requestInit:{headers:{Authorization:'Bearer '+token}}}));
  if(modern)assert.equal(client.getProtocolEra(),'modern');
  assert.deepEqual((await client.callTool({name:'private_research_health',arguments:{}})).structuredContent,expected);
  const health=await fetch(host.url.replace('/mcp','/healthz'),{headers});
  assert.equal(health.status,200);assert.equal(health.headers.get('cache-control'),'no-store');
  assert.deepEqual(await health.json(),expected);assert.equal(calls,0);
 }finally{await client.close();await host.close();}
});
