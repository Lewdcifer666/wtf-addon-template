import {test} from 'node:test';import assert from 'node:assert/strict';
import {startLocalResearchMcpHost} from '../research-mcp-host.mjs';
import {withPrivateTaskDeadline} from '../task-deadline.mjs';
test('planned rollover rejects new requests while a bounded original call drains',async()=>{
 let release,entered;const began=new Promise(r=>{entered=r;});let calls=0;
 const host=await startLocalResearchMcpHost({bearerToken:'x'.repeat(43),adapter:{dispatch:async()=>{calls++;entered();await new Promise(r=>{release=r;});return {kind:'synthetic-completed'};}}});
 const invoke=()=>fetch(host.url,{method:'POST',headers:{Authorization:'Bearer '+'x'.repeat(43),'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'private_research_open',arguments:{schema_version:1,genre:'scifi',research_date:'2026-11-04',private_revision:'a'.repeat(40),public_revision:'b'.repeat(40)}}})});
 try{
  const original=invoke();await began;let finished=false;const drain=host.drain().then(()=>{finished=true;});
  const refused=await invoke();assert.equal(refused.status,200);assert.equal((await refused.json()).result.structuredContent.error,'private_task_pending');assert.equal(finished,false);
  release();const completed=await original;assert.equal(completed.status,200);await completed.text();await drain;assert.equal(calls,1);
 }finally{release?.();await host.close();}
});

test('rollover cancels a long original wait into a protocol result before connection cleanup',async()=>{
 let entered,calls=0;const began=new Promise(resolve=>{entered=resolve;});
 const host=await startLocalResearchMcpHost({bearerToken:'x'.repeat(43),adapter:{dispatch:()=>withPrivateTaskDeadline(async()=>{calls++;entered();await new Promise(()=>{});},{timeoutMs:330000})}});
 try{
  const pending=fetch(host.url,{method:'POST',headers:{Authorization:'Bearer '+'x'.repeat(43),'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'private_research_open',arguments:{schema_version:1,genre:'scifi',research_date:'2026-11-04',private_revision:'a'.repeat(40),public_revision:'b'.repeat(40)}}})});
  await began;await host.drain({timeoutMs:15});const response=await pending;assert.equal(response.status,200);assert.equal((await response.json()).result.structuredContent.error,'private_task_pending');assert.equal(calls,1);
 }finally{await host.close();}
});
