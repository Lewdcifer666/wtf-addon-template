import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes} from 'node:crypto';
import {startLocalResearchMcpHost} from '../research-mcp-host.mjs';
const version='2026-07-28';
const meta={'io.modelcontextprotocol/protocolVersion':version,
 'io.modelcontextprotocol/clientInfo':{name:'synthetic-modern-probe',version:'1'},
 'io.modelcontextprotocol/clientCapabilities':{}};
test('modern discovery and listing work without initialization and never enter the private dispatcher',async()=>{
 const token=randomBytes(32).toString('base64url');let calls=0;
 const host=await startLocalResearchMcpHost({bearerToken:token,adapter:{async dispatch(){calls++;throw Error('PRIVATE_SENTINEL');}}});
 const headers={Authorization:'Bearer '+token,'Content-Type':'application/json','MCP-Protocol-Version':version};
 const rpc=(method,extra={})=>fetch(host.url,{method:'POST',headers:{...headers,'Mcp-Method':method,...extra},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:{_meta:meta}})});
 try{
  assert.equal((await rpc('server/discover',{Authorization:'Bearer wrong'})).status,401);
  assert.equal((await rpc('server/discover',{Origin:'https://evil.invalid'})).status,403);
  const discovery=await rpc('server/discover');assert.equal(discovery.status,200);
  const found=await discovery.json();assert.equal(found.id,1);assert.equal(found.result.resultType,'complete');
  assert(found.result.supportedVersions.includes(version));assert.deepEqual(found.result.capabilities,{tools:{}});
  assert.equal(found.result._meta['io.modelcontextprotocol/serverInfo'].name,'wtf-private-research');
  const listing=await rpc('tools/list');assert.equal(listing.status,200);
  const result=await listing.json();assert.equal(result.result.resultType,'complete');assert.equal(result.result.tools.length,4);
  assert.equal(calls,0);
 }finally{await host.close();}
});
test('modern version mismatches fail before tool dispatch with a bounded protocol response',async()=>{
 const token=randomBytes(32).toString('base64url');let calls=0;
 const host=await startLocalResearchMcpHost({bearerToken:token,adapter:{async dispatch(){calls++;return {};}}});
 try{
  const response=await fetch(host.url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','MCP-Protocol-Version':'2025-11-25','Mcp-Method':'tools/call','Mcp-Name':'private_research_open'},
   body:JSON.stringify({jsonrpc:'2.0',id:'mismatch',method:'tools/call',params:{_meta:meta,name:'private_research_open',arguments:{}}})});
  assert.equal(response.status,400);const body=await response.json();assert.equal(body.error.code,-32020);assert.equal(calls,0);
 }finally{await host.close();}
});
