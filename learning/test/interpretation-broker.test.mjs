import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createBrokerRequestStore,brokerCallHash} from '../broker-request-store.mjs';
import {createInterpretationBrokerAdapter} from '../interpretation-broker.mjs';
import {createBrokerGitHub} from '../broker-github.mjs';
import {createResearchMcpServer} from '../research-mcp-host.mjs';
import {startResearchBrokerHost} from '../research-broker-host.mjs';
import {interpretationWorkerError} from '../interpretation-worker.mjs';
const revision='a'.repeat(40),request={schema_version:1,operation:'request',request:{source_revision:revision}};
const submit={schema_version:1,operation:'submit',request:{source_revision:revision,request_id:'b'.repeat(64),packet:{schema_version:1,source_revision:revision,request_id:'b'.repeat(64),interpretations:[{feedback_id:'synthetic',raw_blob_oid:'c'.repeat(40),status:'no_signal',statements:[]}]}}};
const research={schema_version:1,operation:'open',request:{schema_version:1,genre:'scifi',research_date:'2026-10-12',private_revision:revision,public_revision:'d'.repeat(40)}};
const directory=()=>fs.mkdtempSync(path.join(os.tmpdir(),'wtf-interpretation-journal-'));
const close=root=>{assert(path.isAbsolute(root)&&path.basename(root).startsWith('wtf-interpretation-journal-'));fs.rmSync(root,{recursive:true,force:true});};

test('permanent private journal conflicts and corruption stay distinguishable from pending work',()=>{
 for(const code of ['task_request_conflict','invalid_task_journal','immutable_artifact_mismatch'])assert.equal(interpretationWorkerError({code,message:'PRIVATE_SENTINEL'}),code);
 assert.equal(interpretationWorkerError(Error('PRIVATE_SENTINEL')),'private_interpretation_pending');
});

test('both task families share one durable dispatch slot and changed private submissions conflict rather than replacing the packet',async()=>{
 const root=directory();try{
  const store=createBrokerRequestStore({directory:root,privateDirectoryVerified:true}),a=await store.reserve(research),b=await store.reserve(submit);
  assert.equal(await store.reserveDispatch(a.request_hash,'2026-10-26T10:00:00.000Z'),true);
  assert.equal(await store.reserveDispatch(b.request_hash,'2026-10-26T10:00:01.000Z'),false);
  const changed=structuredClone(submit);changed.request.packet.interpretations[0].status='ambiguous';
  await assert.rejects(store.reserve(changed),/task_request_conflict/);assert.equal((await store.pending()).length,2);
  await store.complete(a.request_hash,'e'.repeat(40));assert.equal(await store.reserveDispatch(b.request_hash,'2026-10-26T10:00:02.000Z'),true);
  assert.equal((await createBrokerRequestStore({directory:root,privateDirectoryVerified:true}).pending())[0].request_hash,brokerCallHash(submit));
 }finally{close(root);}
});

test('bounded complete private submissions larger than the old research journal limit survive restart without truncation',async()=>{
 const root=directory();try{
  const large=structuredClone(submit);large.request.packet.interpretations=Array.from({length:250},(_,i)=>({...submit.request.packet.interpretations[0],feedback_id:'synthetic-feedback-'+i}));
  assert(Buffer.byteLength(JSON.stringify(large))>32768);
  const options={directory:root,privateDirectoryVerified:true},a=await createBrokerRequestStore(options).reserve(large);
  assert.deepEqual(await createBrokerRequestStore(options).reserve(large),a);
  assert.equal((await createBrokerRequestStore(options).pending())[0].call.request.packet.interpretations.length,250);
 }finally{close(root);}
});

test('interpretation broker independently defaults held before any journal, credentials, repository or proof access',async()=>{
 let reads=0;const proxy=new Proxy({},{get(){reads++;throw Error('PRIVATE_SENTINEL');}});
 await assert.rejects(createInterpretationBrokerAdapter({api:proxy,store:proxy,dispatchWorker:proxy,proof:proxy}).dispatch(request),/private_interpretation_access_held/);assert.equal(reads,0);
});

test('PC read capability adds only exact private interpretation refs and remains unable to write Git',async()=>{
 let calls=0;const api=createBrokerGitHub({repository:'Lewdcifer666/wtf-scifi-feedback',token:'synthetic',fetcher:async()=>{calls++;return new Response('{}',{headers:{'content-type':'application/json'}});}});
 await api.get('/git/ref/heads/learning/interpretation-result-'+'b'.repeat(64));await api.get('/git/ref/heads/interpretation/'+revision);assert.equal(calls,2);
 for(const route of ['/git/ref/heads/interpretation/main','/git/ref/heads/learning/interpretation-result-../main','/contents/data/feedback','/git/ref/heads/interpretation/'+revision+'?extra=true'])await assert.rejects(api.get(route));
 await assert.rejects(api.post('/git/refs',{}),/unauthorized_write/);assert.equal(calls,2);
});

test('interpretation MCP tools are opt-in, separately routed, honest about private bookkeeping and closed to injected arguments',async()=>{
 let interpreted=0,researchCalls=0;const server=createResearchMcpServer({async dispatch(){researchCalls++;return {};}},{interpretationAdapter:{persistsTaskBookkeeping:true,async dispatch(call){interpreted++;assert.equal(call.operation,'request');return {kind:'synthetic-request'};}}});
 const client=new Client({name:'synthetic-interpretation',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
 try{
  const tools=(await client.listTools()).tools;assert.equal(tools.length,9);assert.equal(tools.filter(t=>t.name.startsWith('private_interpretation_')).length,4);
  for(const tool of tools.filter(t=>t.name.startsWith('private_interpretation_')))assert.equal(tool.annotations.readOnlyHint,false);
  assert.equal((await client.callTool({name:'private_research_health',arguments:{}})).structuredContent.publication_capability,false);assert.equal(interpreted,0);
  assert.deepEqual((await client.callTool({name:'private_interpretation_request',arguments:request.request})).structuredContent,{kind:'synthetic-request'});
  const invalid=await client.callTool({name:'private_interpretation_request',arguments:{...request.request,activate:true}});assert.equal(invalid.isError,true);assert.equal(interpreted,1);assert.equal(researchCalls,0);
 }finally{await client.close();await server.close();}
});

test('interpretation host gate is separate from research and legacy held config exposes no new tools or credentials',async()=>{
 const root=directory(),configFile=path.join(root,'config.json'),access={issuer:'https://synthetic.cloudflareaccess.com',audience:'a'.repeat(64),subject:'synthetic',email:'owner@example.invalid'};
 try{
  const config={schema_version:1,task_access_enabled:false,interpretation_access_enabled:true,access,github_app:null,request_directory:null,private_directory_verified:false};
  fs.writeFileSync(configFile,JSON.stringify(config));await assert.rejects(startResearchBrokerHost({configFile,env:{PRIVATE_RESEARCH_BROKER_ALLOWED:'true'}}),/private_interpretation_access_held/);
  config.interpretation_access_enabled=false;fs.writeFileSync(configFile,JSON.stringify(config));const host=await startResearchBrokerHost({configFile,env:{}});await host.close();
 }finally{close(root);}
});

test('category/scope draft mistakes fail at MCP before journal, dispatch or adapter access while historical wire drafts remain retained',async()=>{
 const root=directory();let entered=0;const server=createResearchMcpServer(undefined,{interpretationAdapter:{async dispatch(){entered++;throw Error('MUST_NOT_ENTER');}}});
 const client=new Client({name:'synthetic-semantic-draft',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
 try{
  const bad=structuredClone(submit);bad.request.packet.interpretations[0]={...bad.request.packet.interpretations[0],status:'interpreted',statements:[{category:'concept',aspect:'experiments',meaning:'wanted_more',scope:'title_execution',quote:'PRIVATE_SYNTHETIC',confidence:'high'}]};
  const result=await client.callTool({name:'private_interpretation_submit',arguments:bad.request});assert.equal(result.isError,true);assert.equal(result.structuredContent.error,'invalid_task_call');assert.equal(entered,0);
  const store=createBrokerRequestStore({directory:root,privateDirectoryVerified:true}),saved=await store.reserve(bad);assert.equal((await store.pending())[0].request_hash,saved.request_hash);
  const altered=structuredClone(bad);altered.request.packet.interpretations[0].statements[0].scope='content_preference';await assert.rejects(store.reserve(altered),/task_request_conflict/);
 }finally{await client.close();await server.close();close(root);}
});
