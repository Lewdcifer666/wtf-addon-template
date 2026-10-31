import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createBrokerRequestStore} from '../broker-request-store.mjs';
import {createResearchWorkerDispatch} from '../research-worker-dispatch.mjs';
import {createBrokerGitHub} from '../broker-github.mjs';
import {createResearchBrokerAdapter} from '../research-broker.mjs';
import {workerRequestHash} from '../research-worker.mjs';
import {startResearchBrokerHost} from '../research-broker-host.mjs';
import {createGitHubQuotaGate} from '../github-quota.mjs';
import {LearningError} from '../git-artifacts.mjs';
import {privateTaskErrorCode} from '../research-task-adapter.mjs';
const token='1'.repeat(43),uuid='12345678-1234-4234-8234-123456789abc';
const call={schema_version:1,operation:'search',request:{task_token:uuid,request_id:'same-search',query:'public fictional title',preference_indexes:[]}};
const open={schema_version:1,operation:'open',request:{schema_version:1,genre:'scifi',research_date:'2026-10-12',private_revision:'a'.repeat(40),public_revision:'b'.repeat(40)}};
function directory(){return fs.mkdtempSync(path.join(os.tmpdir(),'wtf-broker-synthetic-'));}
const remove=dir=>{assert(path.isAbsolute(dir)&&path.basename(dir).startsWith('wtf-broker-synthetic-'));fs.rmSync(dir,{recursive:true,force:true});};

test('quota reset survives a broker replacement without changing request identities',async()=>{
 const root=directory();try{
  const options={directory:root,privateDirectoryVerified:true},first=createBrokerRequestStore(options);await first.reserve(open);
  const gate=createGitHubQuotaGate({clock:()=>0,initialUntil:first.quotaDeadline(),onPause:t=>first.recordQuota(t)});
  gate.observe(new Response(null,{status:403,headers:{'x-ratelimit-remaining':'0','x-ratelimit-reset':'120'}}));
  const replacement=createBrokerRequestStore(options);assert.equal(replacement.quotaDeadline(),120000);assert.equal((await replacement.pending()).length,1);
  let now=60000;const renewed=createGitHubQuotaGate({clock:()=>now,initialUntil:replacement.quotaDeadline()});assert.throws(()=>renewed.assertAllowed(),{code:'github_rate_limited'});now=120000;renewed.assertAllowed();
  const name=fs.readdirSync(root).find(n=>n.endsWith('-quota.json'));fs.writeFileSync(path.join(root,name),'{}');await assert.rejects(replacement.pending(),{code:'invalid_task_journal'});
 }finally{remove(root);}
});

test('missing interpretation has a closed honest code while arbitrary private errors remain hidden',()=>{
 for(const code of ['interpretation_not_staged','invalid_interpretation_record'])assert.equal(privateTaskErrorCode(new LearningError(code)),code);
 assert.equal(privateTaskErrorCode(Error('PRIVATE_SENTINEL')),'private_task_failed');
});

test('request journal survives replacement, reserves before dispatch and rejects changed payloads under one identity',async()=>{
 const root=directory();try{
  const options={directory:root,privateDirectoryVerified:true},first=createBrokerRequestStore(options);
  const request=await first.reserve(call);assert.equal(request.request_hash,workerRequestHash(call));
  assert.deepEqual(await createBrokerRequestStore(options).reserve(call),request);
  await assert.rejects(first.reserve({...call,request:{...call.request,query:'changed'}}),{code:'task_request_conflict'});
  assert.equal(await first.reserveDispatch(request.request_hash,'2026-10-12T10:00:00.000Z'),true);
  assert.equal(await createBrokerRequestStore(options).reserveDispatch(request.request_hash,'2026-10-12T10:05:00.000Z'),false);
  for(const time of ['10:10','10:20'])assert.equal(await first.reserveDispatch(request.request_hash,`2026-10-12T${time}:00.000Z`),true);
  assert.equal(await first.reserveDispatch(request.request_hash,'2026-10-12T11:00:00.000Z'),false);
  assert.equal((await first.pending()).length,1);
  await first.complete(request.request_hash,'c'.repeat(40));assert.deepEqual(await first.pending(),[]);
  assert.deepEqual(await first.reserve(call),request); // completion metadata never deletes original work
  await assert.rejects(first.complete(request.request_hash,'d'.repeat(40)),{code:'invalid_task_journal'});
 }finally{remove(root);}
});

test('private journal refuses unverified paths and corruption; crash temporaries cannot become requests',async()=>{
 const root=directory();try{
  assert.throws(()=>createBrokerRequestStore({directory:root}),{code:'invalid_task_journal'});
  assert.throws(()=>createBrokerRequestStore({directory:'relative',privateDirectoryVerified:true}),{code:'invalid_task_journal'});
  const store=createBrokerRequestStore({directory:root,privateDirectoryVerified:true});await store.reserve(open);
  const name=fs.readdirSync(root).find(n=>n.endsWith('-request.json'));
  fs.writeFileSync(path.join(root,name+'.tmp-'+uuid),'{interrupted');assert.equal((await store.pending()).length,1);
  fs.writeFileSync(path.join(root,name),'{corrupt');await assert.rejects(store.pending(),{code:'invalid_task_journal'});
 }finally{remove(root);}
});

test('workflow dispatch is fixed to the private main worker and never retries uncertain outcomes',async()=>{
 for(const mode of ['success','redirect','exception','timeout']){
  let calls=0;const dispatch=createResearchWorkerDispatch({token,timeoutMs:20,fetcher:async(url,options)=>{
   calls++;assert.equal(url,'https://api.github.com/repos/Lewdcifer666/wtf-scifi-feedback/actions/workflows/learning-finalize.yml/dispatches');
   assert.equal(options.method,'POST');assert.equal(options.redirect,'manual');assert.equal(options.credentials,'omit');
   const body=JSON.parse(options.body);assert.equal(body.ref,'main');assert.equal(body.inputs.dry_run,false);
   assert.deepEqual(JSON.parse(body.inputs.task_request),open);assert.deepEqual(Object.keys(body.inputs).sort(),['dry_run','task_request']);
   if(mode==='exception')throw Error('PRIVATE_SENTINEL');
   if(mode==='timeout')return new Promise(()=>{});
   return new Response(null,{status:mode==='success'?204:302});
  }});
  if(mode==='success')assert.deepEqual(await dispatch(open),{accepted:true});
  else await assert.rejects(dispatch(open),e=>e.code==='private_task_pending'&&!String(e).includes('PRIVATE_SENTINEL'));
  assert.equal(calls,1);
 }
});

test('broker GitHub capability reads only metadata, owned refs and authenticated Git graphs',async()=>{
 let calls=0;const api=createBrokerGitHub({repository:'Lewdcifer666/wtf-scifi-feedback',token,fetcher:async(url,options)=>{
  calls++;assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');assert.equal(options.credentials,'omit');
  return new Response('{"ok":true}',{headers:{'content-type':'application/json'}});
 }});
 assert.equal(api.writable,false);assert.deepEqual(await api.get('/'),{ok:true});
 assert.deepEqual(await api.get('/git/ref/heads/main'),{ok:true});assert.equal(calls,2);
 for(const route of ['/contents/data/feedback','/actions/workflows','/git/ref/heads/interpretation/anything','/git/ref/heads/main?evil=1'])await assert.rejects(api.get(route));
 await assert.rejects(api.post('/git/refs',{}),{code:'unauthorized_write'});assert.equal(calls,2);
});

test('read credential cannot follow redirects or expose response content on failures',async()=>{
 for(const mode of ['redirect','oversize','body-timeout']){
  const api=createBrokerGitHub({repository:'Lewdcifer666/wtf-scifi-feedback',token,timeoutMs:20,fetcher:async()=>{
   if(mode==='redirect')return new Response('PRIVATE_SENTINEL',{status:302,headers:{Location:'https://evil.invalid'}});
   if(mode==='oversize')return new Response('PRIVATE_SENTINEL',{headers:{'content-type':'application/json','content-length':String(16*1024*1024+1)}});
   return new Response(new ReadableStream({start(){}}),{headers:{'content-type':'application/json'}});
  }});
  await assert.rejects(api.get('/'),e=>e.code==='transport_failure'&&!String(e).includes('PRIVATE_SENTINEL'));
 }
});

test('broker defaults to held before any journal, GitHub, workflow or proof access',async()=>{
 let touched=0;const proxy=new Proxy({},{get(){touched++;throw Error('PRIVATE_SENTINEL');}});
 const broker=createResearchBrokerAdapter({api:proxy,store:proxy,dispatchWorker:proxy,proof:proxy});
 await assert.rejects(broker.dispatch(open),{code:'private_task_access_held'});assert.equal(touched,0);
});

test('new PC entry point cannot accidentally enable active access through config or CLI arguments',async()=>{
 const root=directory(),config=path.join(root,'config.json'),access={issuer:'https://synthetic.cloudflareaccess.com',audience:'a'.repeat(64),subject:'synthetic',email:'owner@example.invalid'};
 try{
  fs.writeFileSync(config,JSON.stringify({schema_version:1,task_access_enabled:false,access,github_app:null,request_directory:null,private_directory_verified:false}));
  const host=await startResearchBrokerHost({configFile:config});await host.close();
  const active=JSON.parse(fs.readFileSync(config));active.task_access_enabled=true;fs.writeFileSync(config,JSON.stringify(active));
  await assert.rejects(startResearchBrokerHost({configFile:config,env:{}}),{code:'private_task_access_held'});
  const result=spawnSync(process.execPath,['learning/research-worker.mjs'],{encoding:'utf8',env:{},windowsHide:true});
  assert.equal(result.status,1);assert.equal(result.stdout,'');assert(result.stderr.includes('private_task_access_held'));
  assert(!result.stderr.includes(config));
 }finally{remove(root);}
});

test('one outstanding dispatch slot prevents a burst of queued workflows while retaining every request',async()=>{
 const root=directory();try{
  const store=createBrokerRequestStore({directory:root,privateDirectoryVerified:true}),first=await store.reserve(call);
  const other=await store.reserve({...call,request:{...call.request,request_id:'other'}});
  assert.equal(await store.reserveDispatch(first.request_hash,'2026-10-12T10:00:00.000Z'),true);
  assert.equal(await store.reserveDispatch(other.request_hash,'2026-10-12T10:00:01.000Z'),false);
  assert.equal((await store.pending()).length,2);
  await store.complete(first.request_hash,'c'.repeat(40));
  assert.equal(await store.reserveDispatch(other.request_hash,'2026-10-12T10:00:02.000Z'),true);
 }finally{remove(root);}
});

test('worker workflow remains opt-in, bounded and on trusted main; request text never enters shell or log headers',()=>{
 const workflow=fs.readFileSync(new URL('../workflows/learning-finalize.yml',import.meta.url),'utf8');
 const worker=workflow.slice(workflow.indexOf('  task-worker:'));
 for(const required of ["github.ref == 'refs/heads/main'","github.event_name == 'workflow_dispatch'",'!inputs.dry_run',
  "vars.PRIVATE_RESEARCH_WORKER_ENABLED == 'true'",'timeout-minutes: 5','ref: ${{ steps.trusted.outputs.sha }}',
  'persist-credentials: false','node learning/research-worker.mjs'])assert(worker.includes(required));
 assert(workflow.includes('group: private-learning-reconciliation'));assert(workflow.includes('cancel-in-progress: false'));
 assert(!worker.includes('${{ inputs.task_request }}'));assert(!worker.includes('PRIVATE_TASK_REQUEST:'));
 assert(!worker.includes('self-hosted'));assert(!worker.includes('head_sha'));assert(!/^\s+cache:/m.test(worker));
 const code=fs.readFileSync(new URL('../research-worker.mjs',import.meta.url),'utf8');
 assert(code.includes('GITHUB_EVENT_PATH'));assert(!code.includes('eval('));assert(!code.includes('execFile'));
});
