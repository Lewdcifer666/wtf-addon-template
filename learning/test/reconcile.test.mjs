import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {reconcile,loadPublicProfile,engineFingerprintAt} from '../reconcile.mjs';
import {GitHub} from '../github.mjs';
import {digest,gitBlobOid,stableJson,interpretationRequest} from '../interpretation.mjs';
import {inventoryFeedback} from '../inventory.mjs';
import {GENRES} from '../receipt.mjs';
import {fixtureObservationProof} from './fixtures/observation-proof.mjs';
import {githubObservationProof} from '../observation-proof.mjs';
import {buildReceipt} from '../receipt.mjs';
import {loadVerifiedReceipt} from '../receipt-loader.mjs';
import {prepareResearchUse} from '../research-use.mjs';
import {persistImmutable,persistSealedState} from '../git-artifacts.mjs';
import {loadObservationIndex} from '../observation-index.mjs';
import {openResearchSession,privateResearchSessionResponse,recheckResearchSession,observeResearchSessionSearch,verifyResearchSessionCommit} from '../research-session.mjs';
import {persistResearchSessionContext,persistResearchSessionSearch,persistResearchSessionTaskIntent} from '../session-journal-writer.mjs';
import {loadSessionSearchRefs,sessionSearchBody} from '../session-journal.mjs';
import {createPrivateResearchTaskAdapter} from '../research-task-adapter.mjs';
import {startLocalResearchMcpHost} from '../research-mcp-host.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {executeResearchWorker,readWorkerRecord,workerRequestHash} from '../research-worker.mjs';
import {createPublicSearchProvider} from '../public-search.mjs';
import {recoverResearchSessionForVerification,restoreResearchSessionSearches} from '../research-session.mjs';
import {createResearchBrokerAdapter} from '../research-broker.mjs';
import {createBrokerRequestStore} from '../broker-request-store.mjs';

function memoryRepo(name,initial){
 let serial=0;const commits=new Map(),trees=new Map(),blobs=new Map(),refs=new Map(),writes=[];
 const oid=()=>digest(`${name}:${++serial}`).slice(0,40);
 const blob=content=>{const bytes=Buffer.from(content),sha=gitBlobOid(bytes);blobs.set(sha,bytes);return {sha,size:bytes.length};};
 const addTree=files=>{const sha=oid(),tree=Object.entries(files).map(([path,content])=>({path,type:'blob',mode:'100644',...blob(content)}));trees.set(sha,{sha,truncated:false,tree});return sha;};
 const addCommit=(tree,parents=[])=>{const sha=oid();commits.set(sha,{sha,tree:{sha:tree},parents:parents.map(sha=>({sha}))});return sha;};
 const initialSha=addCommit(addTree(initial));refs.set('refs/heads/main',{ref:'refs/heads/main',object:{sha:initialSha}});
 const filesAt=sha=>Object.fromEntries(trees.get(commits.get(sha).tree.sha).tree.map(e=>[e.path,blobs.get(e.sha).toString('utf8')]));
 const api={
  repository:name,
  async pinMain(){return commits.get(refs.get('refs/heads/main').object.sha);},
  async optional(route){return refs.get(`refs/${route.replace('/git/ref/','')}`)||null;},
  async get(route){
   if(route==='/')return {full_name:name,private:name.endsWith('-feedback'),default_branch:'main'};
   if(route.startsWith('/git/trees/'))return trees.get(route.slice('/git/trees/'.length).split('?')[0]);
   if(route.startsWith('/git/commits/'))return commits.get(route.split('/').at(-1));
   if(route.startsWith('/git/blobs/')){const sha=route.split('/').at(-1),bytes=blobs.get(sha);return {sha,size:bytes.length,encoding:'base64',content:bytes.toString('base64')};}
   if(route.startsWith('/git/matching-refs/'))return [...refs.values()].filter(r=>r.ref.startsWith(`refs/${route.slice('/git/matching-refs/'.length)}`));
   if(route.startsWith('/git/ref/'))return refs.get(`refs/${route.slice('/git/ref/'.length)}`);
   if(route.startsWith('/compare/')){
    const [base,head]=route.slice('/compare/'.length).split('...'),before=filesAt(base),after=filesAt(head);
    return {merge_base_commit:{sha:base},status:'ahead',total_commits:head===base?0:1,files:[...new Set([...Object.keys(before),...Object.keys(after)])].filter(p=>before[p]!==after[p]).map(filename=>({filename,status:before[filename]===undefined?'added':after[filename]===undefined?'removed':'modified'}))};
   }
   throw Error('unexpected mock read');
  },
  async post(route,body){
   writes.push({route,body});
   if(route==='/git/blobs')return blob(body.content);
   if(route==='/git/trees'){
    const files=Object.fromEntries(trees.get(body.base_tree).tree.map(e=>[e.path,blobs.get(e.sha).toString('utf8')]));
    for(const e of body.tree)files[e.path]=blobs.get(e.sha).toString('utf8');return {sha:addTree(files)};
   }
   if(route==='/git/commits')return {sha:addCommit(body.tree,body.parents)};
   if(route==='/git/refs'){
    if(refs.has(body.ref)){const error=Error('ref exists');error.status=422;throw error;}
    const ref={ref:body.ref,object:{sha:body.sha}};refs.set(body.ref,ref);return ref;
   }
   throw Error('unexpected mock write');
  }
 };
 return {api,refs,trees,blobs,writes,filesAt,initialSha,branch(name,additions){
  const parent=refs.get('refs/heads/main').object.sha;
  const sha=addCommit(addTree({...filesAt(parent),...additions}),[parent]);refs.set(`refs/heads/${name}`,{ref:`refs/heads/${name}`,object:{sha}});return sha;
 }};
}
function scenario(){
 const event={schema_version:3,feedback_id:'synthetic',supersedes:null,imdb_id:'tt999999991',source_id:null,rated_at:'2026-10-01T10:00:00Z',profile_context:null,status:'seen',rating:4,premise_interest:null,liked:[],disliked:[],feedback:'PRIVATE_SENTINEL I want more mystery.'};
 const privateRepo=memoryRepo('Lewdcifer666/wtf-scifi-feedback',{'data/feedback/2026-10-01/synthetic.json':stableJson(event),'engine/identity.mjs':'// existing synthetic identity helper\n','learning/reconcile.mjs':'// trusted fixture, never imported from API\n','learning/config/activation.json':stableJson({schema_version:1,research_learning_enabled:false,public_catalog_personalization_enabled:false})}),publicApis={},publicRepos={};
 for(const genre of GENRES){
  const policy=JSON.parse(fs.readFileSync(new URL(`./fixtures/${genre}-policy.json`,import.meta.url),'utf8')),dimension=genre==='mystery'?'central_mystery':'mystery';
  policy.automation_rules={minimum_match_score:0};policy.dna_baseline={weights:{[dimension]:1},completeness_defaults:{min_known_dimensions:1,min_confidence:0,required_known_dimensions:[dimension]},archetypes:[]};policy.dna_guardrails={hard_exclusion:[],combination:[]};
  const files={'data/taste-profile.json':stableJson(policy),'data/library.json':stableJson({items:[{imdb_id:event.imdb_id,status:'watch',type:'movie',dna:{[dimension]:8},dna_confidence:1}]}),
   'data/rejections.json':'{"items":[]}','config/catalogs.json':stableJson({catalogs:[{id:'dna-match',min_score:0,dna:{mode:'baseline_profile',archetype_bonus_max:0}}]}),'config/research.json':'{}','scripts/registry.mjs':'// data hash only; never executed'};
  publicRepos[genre]=memoryRepo(`Lewdcifer666/wtf-${genre}-stremio`,files);publicApis[genre]=publicRepos[genre].api;
 }
 return {privateRepo,publicApis,publicRepos,event,args:{api:privateRepo.api,publicApis,trustedRevision:privateRepo.initialSha}};
}
async function stage(s,extra={}){
 const commit=await s.privateRepo.api.pinMain(),tree=s.privateRepo.trees.get(commit.tree.sha),source=inventoryFeedback({commit,tree,blobs:s.privateRepo.blobs}),request=interpretationRequest(source);
 const packet={schema_version:1,source_revision:source.source_revision,request_id:request.request_id,interpretations:[{feedback_id:s.event.feedback_id,raw_blob_oid:source.records[0].blob_oid,status:'interpreted',statements:[{category:'concept',aspect:'mystery',meaning:'wanted_more',scope:'content_preference',quote:'I want more mystery',confidence:'high'}]}]};
 s.privateRepo.branch(`interpretation/${commit.sha}`,{[`learning-inbox/${commit.sha}/${request.request_id}.json`]:stableJson(packet),...extra});
}
test('persisted queue resumes from a staged packet, creates inactive receipt, and reuses unchanged retry',async()=>{
 const s=scenario(),before=stableJson(s.privateRepo.filesAt(s.privateRepo.initialSha));
 const pending=await reconcile(s.args);assert.equal(pending.state,'awaiting_interpretation');assert.equal(pending.required_interpretations,1);
 assert.equal(s.privateRepo.refs.size,2);await stage(s);
 const finished=await reconcile(s.args);assert.equal(finished.state,'computed_inactive');const writes=s.privateRepo.writes.length;
 const retry=await reconcile(s.args);assert.equal(retry.receipt,finished.receipt);assert.equal(s.privateRepo.writes.length,writes);
 assert.equal(stableJson(s.privateRepo.filesAt(s.privateRepo.initialSha)),before);
 assert.equal(s.privateRepo.refs.get('refs/heads/main').object.sha,s.privateRepo.initialSha);
 assert(!JSON.stringify([pending,finished,retry]).includes('PRIVATE_SENTINEL'));
});
test('malicious branch code/cache changes persist failure, never execute, and never produce a receipt',async()=>{
 const s=scenario();await stage(s,{'learning/reconcile.mjs':'throw Error("EXECUTED_UNTRUSTED")','node_modules/cache':'malicious'});
 await assert.rejects(reconcile(s.args),/unauthorized_packet_changes/);
 assert([...s.privateRepo.refs.keys()].some(r=>r.includes('/failure-')));
 assert(![...s.privateRepo.refs.keys()].some(r=>r.includes('/receipt-')));
});
test('dry run has no writes; stale source and missing credentials fail closed',async()=>{
 const s=scenario();await stage(s);assert.equal((await reconcile({...s.args,dryRun:true})).state,'computed_inactive');assert.equal(s.privateRepo.writes.length,0);
 await assert.rejects(reconcile({...s.args,trustedRevision:'a'.repeat(40)}),/stale_input/);
 assert.throws(()=>new GitHub('Lewdcifer666/wtf-scifi-feedback',''),/missing_credentials/);
});
test('old-source packets are preserved with durable stale markers, not silently discarded',async()=>{
 const s=scenario();const old=s.privateRepo.branch(`interpretation/${'d'.repeat(40)}`,{'learning-inbox/old.json':'{}'});
 const result=await reconcile(s.args);assert.equal(result.state,'awaiting_interpretation');
 assert.equal(s.privateRepo.refs.get(`refs/heads/interpretation/${'d'.repeat(40)}`).object.sha,old);
 assert([...s.privateRepo.refs.keys()].some(r=>r.includes('/failure-')));
});

test('retained stale refs remain reconcilable across three feedback revisions with unchanged engine',async()=>{
 const s=scenario();await stage(s);
 const original=s.privateRepo.refs.get(`refs/heads/interpretation/${s.privateRepo.initialSha}`).object.sha;
 await reconcile(s.args);
 for(const rating of [3,2,1]){
  const head=s.privateRepo.branch('main',{'data/feedback/2026-10-01/synthetic.json':stableJson({...s.event,rating})});
  const args={...s.args,trustedRevision:head};await reconcile(args);await stage(s);
  const next=await reconcile(args);assert.equal(next.state,'computed_inactive');
  const writes=s.privateRepo.writes.length;assert.deepEqual(await reconcile(args),next);assert.equal(s.privateRepo.writes.length,writes);
 }
 assert.equal(s.privateRepo.refs.get(`refs/heads/interpretation/${s.privateRepo.initialSha}`).object.sha,original);
 assert.equal([...s.privateRepo.refs.keys()].filter(r=>r.includes('/receipt-')).length,4);
});
test('changed public base recomputes a new pinned receipt and preserves the old immutable result',async()=>{
 const s=scenario();await stage(s);const old=await reconcile(s.args),ref=s.privateRepo.refs.get(`refs/heads/${old.receipt}`).object.sha;
 s.publicRepos.anime.branch('main',{'config/research.json':'{"synthetic_policy_revision":2}'});
 const next=await reconcile(s.args);assert.notEqual(next.receipt,old.receipt);
 assert.equal(s.privateRepo.refs.get(`refs/heads/${old.receipt}`).object.sha,ref);
 assert.equal([...s.privateRepo.refs.keys()].filter(r=>r.includes('/receipt-')).length,2);
});

test('optional candidate execution evidence is loaded from pinned public blobs and included in inventory',async()=>{
 const s=scenario(),a=JSON.parse(fs.readFileSync(new URL('../config/scifi.json',import.meta.url),'utf8'));
 const before=await loadPublicProfile(s.publicApis.scifi,'scifi',a);assert.deepEqual(before.executionEvidence,{});
 const evidence={[s.event.imdb_id]:{acting:1}};
 const head=s.publicRepos.scifi.branch('main',{'data/execution-evidence.json':stableJson(evidence)});
 const after=await loadPublicProfile(s.publicApis.scifi,'scifi',a);
 assert.equal(after.revision,head);assert.deepEqual(after.executionEvidence,evidence);assert.notEqual(before.inventory_hash,after.inventory_hash);
});

test('invalid public execution evidence fails before request staging and never blames interpretation',async()=>{
 const s=scenario();s.publicRepos.scifi.branch('main',{'data/execution-evidence.json':'{"tt123":{"acting":0}}'});
 await assert.rejects(reconcile(s.args),/invalid_public_policy/);
 assert(![...s.privateRepo.refs.keys()].some(ref=>/\/(request|receipt)-/.test(ref)));
 const ref=[...s.privateRepo.refs.values()].find(ref=>ref.ref.includes('/failure-'));
 assert.equal(JSON.parse(s.privateRepo.filesAt(ref.object.sha)['learning-output/state.json']).code,'invalid_public_policy');
});
test('invalid complete raw input persists a closed failure and cannot produce a fresh receipt',async()=>{
 const s=scenario(),head=s.privateRepo.branch('main',{'data/feedback/2026-10-01/synthetic.json':stableJson({...s.event,schema_version:99})});
 await assert.rejects(reconcile({...s.args,trustedRevision:head}),/invalid_source/);
 assert([...s.privateRepo.refs.keys()].some(r=>r.includes('/failure-')));
 assert(![...s.privateRepo.refs.keys()].some(r=>r.includes('/receipt-')));
});
test('public repositories cannot receive private learning writes',async()=>{
 const s=scenario(),api={...s.privateRepo.api,get:async route=>route==='/'?{private:false,full_name:'Lewdcifer666/wtf-scifi-feedback',default_branch:'main'}:s.privateRepo.api.get(route)};
 await assert.rejects(reconcile({...s.args,api}),/private_repository_required/);assert.equal(s.privateRepo.writes.length,0);
 const publicClient=new GitHub('Lewdcifer666/wtf-scifi-stremio','synthetic-token',{writable:true});
 await assert.rejects(publicClient.post('/git/refs',{ref:'refs/heads/example'}),/unauthorized_write/);
});
test('privileged workflow pins main, has no cache, and read-only intake never checks out the packet branch',()=>{
 const read=name=>fs.readFileSync(new URL(`../workflows/${name}`,import.meta.url),'utf8'),final=read('learning-finalize.yml'),intake=read('learning-intake.yml');
 assert(final.includes('ref: ${{ steps.trusted.outputs.sha }}'));assert(final.includes('git/ref/heads/main'));assert(final.includes('cancel-in-progress: false'));
 assert(!final.includes('workflow_run.head_sha'));assert(!final.includes('actions/cache'));assert(final.includes('npm ci --ignore-scripts'));
 assert(intake.includes('contents: read'));assert(!intake.includes('actions/checkout'));assert(!intake.includes('npm '));
});

async function activeScenario(){
 const s=scenario();
 const head=s.privateRepo.branch('main',{'learning/config/activation.json':stableJson({schema_version:1,research_learning_enabled:true,public_catalog_personalization_enabled:false})});
 s.args={...s.args,trustedRevision:head,clock:()=>new Date('2026-10-11T22:30:00Z'),proof:fixtureObservationProof(),observationBudget:24};
 await stage(s);return s;
}
test('activated reconciliation issues six immutable Berlin-day handoffs; read-only use verifies their full Git provenance',async()=>{
 const s=await activeScenario(),before=stableJson(s.privateRepo.filesAt(s.args.trustedRevision));
 const result=await reconcile(s.args);assert.equal(result.state,'computed_active');assert.equal(result.handoffs.length,6);
 const writes=s.privateRepo.writes.length;assert.deepEqual(await reconcile(s.args),result);assert.equal(s.privateRepo.writes.length,writes);
 const use=await reconcile({...s.args,dryRun:true,consumeGenre:'scifi'});
 assert.equal(use.state,'research_ready');assert.equal(use.handoff.issued.research_date,'2026-10-12');
 assert.equal(use.handoff.issued.source_heads.private,s.args.trustedRevision);
 assert.equal(use.handoff.branch,result.handoffs.find(h=>h.genre==='scifi').branch);
 assert.equal(s.privateRepo.writes.length,writes);assert.equal(stableJson(s.privateRepo.filesAt(s.args.trustedRevision)),before);
 assert(!JSON.stringify(result).includes('PRIVATE_SENTINEL'));assert(!JSON.stringify(use).includes('PRIVATE_SENTINEL'));
 assert(!JSON.stringify(use).includes('tt999999991'));
 const tomorrow=await reconcile({...s.args,clock:()=>new Date('2026-10-12T22:30:00Z')});
 assert.equal(tomorrow.receipt,result.receipt);assert.notEqual(tomorrow.handoffs[0].branch,result.handoffs[0].branch);
 assert.equal([...s.privateRepo.refs.keys()].filter(r=>r.includes('/handoff-')).length,12);
});
test('inactive, unstaged, tampered and stale handoffs cannot be consumed or trigger fallback writes',async()=>{
 const inactive=scenario();await stage(inactive);await reconcile(inactive.args);const before=inactive.privateRepo.writes.length;
 await assert.rejects(reconcile({...inactive.args,dryRun:true,consumeGenre:'scifi'}),/learning_inactive/);assert.equal(inactive.privateRepo.writes.length,before);
 const missing=await activeScenario();await assert.rejects(reconcile({...missing.args,dryRun:true,consumeGenre:'scifi'}),/invalid_handoff/);assert.equal(missing.privateRepo.writes.length,0);
 const s=await activeScenario(),issued=await reconcile(s.args),writes=s.privateRepo.writes.length;
 const handoff=issued.handoffs.find(h=>h.genre==='scifi'),ref=s.privateRepo.refs.get(`refs/heads/${handoff.branch}`),files=s.privateRepo.filesAt(ref.object.sha);
 const body=JSON.parse(files['learning-output/handoff.json']);body.context.preferences=[];
 s.privateRepo.branch(handoff.branch,{'learning-output/handoff.json':stableJson(body)});
 await assert.rejects(reconcile({...s.args,dryRun:true,consumeGenre:'scifi'}),/immutable_artifact_mismatch/);assert.equal(s.privateRepo.writes.length,writes);
 s.publicRepos.anime.branch('main',{'config/research.json':'{"changed":true}'});
 await assert.rejects(reconcile({...s.args,dryRun:true,consumeGenre:'action'}),/invalid_handoff/);assert.equal(s.privateRepo.writes.length,writes);
 await assert.rejects(reconcile({...s.args,consumeGenre:'action'}),/invalid_consumer_request/);
});
test('interrupted handoff fanout resumes without overwriting its existing private briefs',async()=>{
 const s=await activeScenario(),original=s.privateRepo.api.post;let held=0;
 s.privateRepo.api.post=async(route,body)=>{
  if(route==='/git/refs'&&body.ref.startsWith('refs/heads/learning/handoff-')&&++held===3)throw Error('synthetic interruption');
  return original(route,body);
 };
 await assert.rejects(reconcile(s.args),/invalid_handoff/);
 const old=new Map([...s.privateRepo.refs].filter(([ref])=>ref.includes('/handoff-')).map(([name,ref])=>[name,ref.object.sha]));assert.equal(old.size,2);
 s.privateRepo.api.post=original;const resumed=await reconcile(s.args);assert.equal(resumed.handoffs.length,6);
 for(const [name,sha] of old)assert.equal(s.privateRepo.refs.get(name).object.sha,sha);
 const writes=s.privateRepo.writes.length;await reconcile(s.args);assert.equal(s.privateRepo.writes.length,writes);
});

test('a policy head moving during authenticated consumption invalidates the handoff without writes',async()=>{
 const s=await activeScenario(),result=await reconcile(s.args),receiptRef=s.privateRepo.refs.get(`refs/heads/${result.receipt}`),get=s.privateRepo.api.get;
 const writes=s.privateRepo.writes.length;let moved=false;
 s.privateRepo.api.get=async route=>{
  const value=await get(route);
  if(!moved&&route===`/git/commits/${receiptRef.object.sha}`){moved=true;s.publicRepos.thriller.branch('main',{'config/research.json':'{"changed_during_read":true}'});}
  return value;
 };
 await assert.rejects(reconcile({...s.args,dryRun:true,consumeGenre:'scifi'}),/stale_input/);
 assert(moved);assert.equal(s.privateRepo.writes.length,writes);
});
async function verificationScenario({issueBeforePacket=true,onReady=async()=>{}}={}){
 const s=await activeScenario(),profile=JSON.parse(fs.readFileSync(new URL('./fixtures/contracts/scifi-profile.json',import.meta.url))),dimensions=profile.dna_dimensions.dimensions.map(d=>d.id);
 const registry=`export const CANONICAL_DIMENSIONS = ${JSON.stringify(dimensions)};\nexport const CANONICAL_DNA_TAGS = ${JSON.stringify(profile.dna_dimensions.tag_registry)};\nexport const SLOW_TO_FAST_DIMENSION = "pace_speed";\n`;
 s.publicRepos.scifi.branch('main',{'data/taste-profile.json':stableJson(profile),'scripts/registry.mjs':registry,
  'schemas/research-packet.schema.json':fs.readFileSync(new URL('../schemas/research-packet.schema.json',import.meta.url),'utf8'),
  'config/research.json':stableJson({schema_version:1,genre:'scifi',run_prefix:'s',timezone:'Europe/Berlin',minimum_sources:1,require_all_known:false})});
 if(issueBeforePacket)await reconcile(s.args);
 await onReady(s);
 const candidate={imdb_id:'tt11111111',type:'movie',title:'Synthetic verified candidate',year:2020,reason:'Public-source fixture.',
  dna:Object.fromEntries(dimensions.map(d=>[d,5])),dna_confidence:1,dna_tags:[],sources:[{url:'https://example.org/review',purpose:'review'}]};
 const packet={schema_version:1,genre:'scifi',research_date:'2026-10-12',candidates:[candidate,{...candidate}],research_rejections:[]};
 const researchCommit=s.publicRepos.scifi.branch('research/2026-10-12-scifi',{'research-inbox/2026-10-12.json':stableJson(packet)});
 return {s,packet,researchCommit};
}
test('read-only processor authenticates staged research using pinned contracts, including duplicates',async()=>{
 const {s,researchCommit}=await verificationScenario(),before=stableJson(s.privateRepo.filesAt(s.args.trustedRevision)),writes=s.privateRepo.writes.length;
 const verified=await reconcile({...s.args,dryRun:true,consumeGenre:'scifi',researchCommit});
 assert.equal(verified.state,'research_verified');assert.equal(verified.trace.research_commit,researchCommit);
 assert.equal(verified.trace.candidates.length,2);assert.equal(verified.trace.candidates[1].diagnostic_status,'duplicate_in_packet');
 assert.equal(verified.trace.effect_status,'candidate_diagnostics_only');assert.equal(s.privateRepo.writes.length,writes);
 assert.equal(stableJson(s.privateRepo.filesAt(s.args.trustedRevision)),before);assert.equal(s.publicRepos.scifi.writes.length,0);
 assert(!JSON.stringify(verified).includes('PRIVATE_SENTINEL'));
});
test('actual processor rejects packet policy violations and code changes without a fallback writer',async()=>{
 for(const malicious of [false,true]){
  const {s,packet}=await verificationScenario(),writes=s.privateRepo.writes.length;
  if(!malicious)packet.final_score=100;
  const researchCommit=s.publicRepos.scifi.branch('research/2026-10-12-scifi',{'research-inbox/2026-10-12.json':stableJson(packet),...(malicious?{'scripts/cache.mjs':'throw Error("EXECUTED_UNTRUSTED")'}:{})});
  await assert.rejects(reconcile({...s.args,dryRun:true,consumeGenre:'scifi',researchCommit}),/invalid_handoff/);
  assert.equal(s.privateRepo.writes.length,writes);assert.equal(s.publicRepos.scifi.writes.length,0);
 }
});
test('consumer refuses missing interpretation and verifies only explicit read-only requests',async()=>{
 const s=await activeScenario();s.privateRepo.refs.delete(`refs/heads/interpretation/${s.args.trustedRevision}`);
 await assert.rejects(reconcile({...s.args,dryRun:true,consumeGenre:'scifi'}),/interpretation_not_staged/);
 await assert.rejects(reconcile({...s.args,researchCommit:'a'.repeat(40)}),/invalid_consumer_request/);
 assert.equal(s.privateRepo.writes.length,0);
});
test('delayed verification selects the original dated handoff; daily consumption cannot select a past day',async()=>{
 const {s,researchCommit}=await verificationScenario(),writes=s.privateRepo.writes.length;
 const clock=()=>new Date('2026-10-12T22:30:00Z'); // October 13 in Berlin
 const verified=await reconcile({...s.args,dryRun:true,consumeGenre:'scifi',researchCommit,researchDate:'2026-10-12',clock});
 assert.equal(verified.trace.research_date,'2026-10-12');assert.equal(verified.state,'research_verified');assert.equal(s.privateRepo.writes.length,writes);
 await assert.rejects(reconcile({...s.args,dryRun:true,consumeGenre:'scifi',researchCommit,clock}),/invalid_handoff/);
 for(const researchDate of ['2026-02-30','2026-10-14'])await assert.rejects(reconcile({...s.args,dryRun:true,consumeGenre:'scifi',researchCommit,researchDate,clock}));
 await assert.rejects(reconcile({...s.args,dryRun:true,consumeGenre:'scifi',researchDate:'2026-10-12',clock}),/invalid_consumer_request/);
});

const recordedObservation=(s,result)=>{
 const recorded=result.observations.observations.find(o=>o.state==='diagnostics_recorded');assert(recorded);
 return {recorded,body:JSON.parse(s.privateRepo.filesAt(recorded.commit)['learning-output/observation.json'])};
};

test('automatic private observation transport persists diagnostics, reuses retries, and never asserts actual use/effect',async()=>{
 const {s,researchCommit}=await verificationScenario(),before=stableJson(s.privateRepo.filesAt(s.args.trustedRevision));
 const result=await reconcile(s.args),{recorded,body}=recordedObservation(s,result);
 assert.equal(body.trace.research_commit,researchCommit);assert.equal(body.current_evidence,false);assert.equal(body.actual_context_use_verified,false);assert.equal(body.behavioral_effect_observed,false);
 assert.equal(body.trace.verification_mode,'historical_observation');assert.equal(body.trace.effect_status,'candidate_diagnostics_only');
 assert.equal(body.trace.candidates[1].diagnostic_status,'duplicate_in_packet');
 const writes=s.privateRepo.writes.length;assert.deepEqual(await reconcile(s.args),result);assert.equal(s.privateRepo.writes.length,writes);
 assert.equal(stableJson(s.privateRepo.filesAt(s.args.trustedRevision)),before);assert(s.publicRepos.scifi.writes.length===0);
 assert(!stableJson(result).includes('PRIVATE_SENTINEL'));assert(!stableJson(result).includes('tt11111111'));
 assert.equal(s.privateRepo.refs.get('refs/heads/'+recorded.branch).object.sha,recorded.commit);
});

test('delayed collector recovers original handoff after publication advances main without refreshing its date or receipt',async()=>{
 const {s,researchCommit}=await verificationScenario();
 s.publicRepos.scifi.branch('main',{'README.md':'Trusted publication advanced main; original packet ref retained.\n'});
 const result=await reconcile({...s.args,clock:()=>new Date('2026-10-13T08:00:00Z')}),{body}=recordedObservation(s,result);
 assert.equal(body.trace.research_commit,researchCommit);assert.equal(body.trace.research_date,'2026-10-12');
 assert.notEqual(body.trace.evaluated_base,(await s.publicApis.scifi.pinMain()).sha);assert.equal(body.current_evidence,false);
 const writes=s.privateRepo.writes.length;await reconcile({...s.args,clock:()=>new Date('2026-10-13T08:00:00Z')});assert.equal(s.privateRepo.writes.length,writes);
});

test('new receipts issued after a same-day packet do not relabel it as using the new taste context',async()=>{
 const {s}=await verificationScenario();s.publicRepos.scifi.branch('main',{'README.md':'Later publication\n'});
 const result=await reconcile(s.args),records=result.observations.observations;
 assert.equal(records.filter(o=>o.state==='diagnostics_recorded').length,1);assert.equal(records.filter(o=>o.state==='research_not_bound_to_handoff').length,1);
 assert.equal([...s.privateRepo.refs.keys()].filter(r=>/^refs\/heads\/learning\/observation-[a-f0-9]{64}$/.test(r)).length,1);
});

test('feedback retraction preserves historical diagnostics but prevents them from becoming current research evidence',async()=>{
 const {s,researchCommit}=await verificationScenario();
 const head=s.privateRepo.branch('main',{'data/feedback/2026-10-01/tomb.json':stableJson({...s.event,feedback_id:'tomb',supersedes:s.event.feedback_id,status:'retracted',rating:null,feedback:null})});
 const result=await reconcile({...s.args,trustedRevision:head}),{body}=recordedObservation(s,result);
 assert.equal(result.state,'awaiting_interpretation');assert.equal(body.trace.research_commit,researchCommit);assert.equal(body.current_evidence,false);
 assert.equal(body.actual_context_use_verified,false);assert.equal(body.behavioral_effect_observed,false);
 assert.equal(JSON.parse(s.privateRepo.filesAt(head)['data/feedback/2026-10-01/tomb.json']).status,'retracted');
 const writes=s.privateRepo.writes.length;await reconcile({...s.args,trustedRevision:head});assert.equal(s.privateRepo.writes.length,writes);
});

test('interrupted observation persistence resumes from the same queue without changing artifacts or public branches',async()=>{
 const {s}=await verificationScenario(),post=s.privateRepo.api.post;let interrupted=false;
 s.privateRepo.api.post=async(route,body)=>{if(route==='/git/refs'&&body.ref.startsWith('refs/heads/learning/observation-')&&!interrupted){interrupted=true;throw Error('synthetic interruption');}return post(route,body);};
 await assert.rejects(reconcile(s.args),/invalid_research_observation/);assert(![...s.privateRepo.refs.keys()].some(r=>/^refs\/heads\/learning\/observation-[a-f0-9]{64}$/.test(r)));
 s.privateRepo.api.post=post;const result=await reconcile(s.args),{recorded}=recordedObservation(s,result);
 assert.equal([...s.privateRepo.refs.keys()].filter(r=>/^refs\/heads\/learning\/observation-[a-f0-9]{64}$/.test(r)).length,1);const writes=s.privateRepo.writes.length;
 await reconcile(s.args);assert.equal(s.privateRepo.writes.length,writes);assert.equal(s.privateRepo.refs.get('refs/heads/'+recorded.branch).object.sha,recorded.commit);
 assert.equal(s.publicRepos.scifi.writes.length,0);
});

test('forged handoffs and malicious research code produce private failures without copying data into workflow results',async()=>{
 for(const attack of ['handoff','code']){
  const {s,packet}=await verificationScenario();
  if(attack==='code')s.publicRepos.scifi.branch('research/2026-10-12-scifi',{'research-inbox/2026-10-12.json':stableJson(packet),'scripts/evil.mjs':'throw Error("EXECUTED_PRIVATE_SENTINEL")'});
  else{
   const ref=[...s.privateRepo.refs.values()].find(r=>r.ref.includes('/handoff-'));
   const body=JSON.parse(s.privateRepo.filesAt(ref.object.sha)['learning-output/handoff.json']);body.context={untrusted:'PRIVATE_SENTINEL'};
   s.privateRepo.branch(ref.ref.slice('refs/heads/'.length),{'learning-output/handoff.json':stableJson(body)});
  }
  await assert.rejects(reconcile(s.args),attack==='handoff'?/immutable_artifact_mismatch/:/invalid_research_observation/);assert(![...s.privateRepo.refs.keys()].some(r=>/^refs\/heads\/learning\/observation-[a-f0-9]{64}$/.test(r)));
  const failures=[...s.privateRepo.refs.values()].filter(r=>r.ref.includes('/failure-'));assert(failures.length);
  for(const ref of failures){const body=s.privateRepo.filesAt(ref.object.sha)['learning-output/state.json'];assert(!body.includes('PRIVATE_SENTINEL'));}
 }
});

test('collector never runs during inactive reconciliation or read-only consumption',async()=>{
 const inactive=scenario();await stage(inactive);await reconcile(inactive.args);assert(![...inactive.privateRepo.refs.keys()].some(r=>/^refs\/heads\/learning\/observation-[a-f0-9]{64}$/.test(r)));
 const {s,researchCommit}=await verificationScenario(),writes=s.privateRepo.writes.length;
 await reconcile({...s.args,dryRun:true,consumeGenre:'scifi',researchCommit});assert.equal(s.privateRepo.writes.length,writes);
 assert(![...s.privateRepo.refs.keys()].some(r=>/^refs\/heads\/learning\/observation-[a-f0-9]{64}$/.test(r)));
});

test('changed public heads during observation creation retain artifacts but cannot claim a completed current job',async()=>{
 const {s}=await verificationScenario(),post=s.privateRepo.api.post;let moved=false;
 s.privateRepo.api.post=async(route,body)=>{
  const result=await post(route,body);
  if(!moved&&route==='/git/refs'&&body.ref.startsWith('refs/heads/learning/observation-')){moved=true;s.publicRepos.scifi.branch('main',{'README.md':'Main moved during recording\n'});}
  return result;
 };
 await assert.rejects(reconcile(s.args),/stale_input/);assert(moved);
 const preserved=[...s.privateRepo.refs].find(([name])=>/^refs\/heads\/learning\/observation-[a-f0-9]{64}$/.test(name));assert(preserved);
 s.privateRepo.api.post=post;await reconcile(s.args);assert.equal(s.privateRepo.refs.get(preserved[0]).object.sha,preserved[1].object.sha);
});

test('untrusted historical public ancestry is rejected, not accepted from a claimed source tuple',async()=>{
 const {s}=await verificationScenario(),oldBase=(await s.publicApis.scifi.pinMain()).sha;
 const newHead=s.publicRepos.scifi.branch('main',{'README.md':'Synthetic incompatible ancestry\n'}),get=s.publicApis.scifi.get;
 s.publicApis.scifi.get=async route=>route===`/compare/${oldBase}...${newHead}`?{status:'diverged',merge_base_commit:{sha:'d'.repeat(40)}}:get(route);
 await assert.rejects(reconcile(s.args),/invalid_research_observation/);
 assert(![...s.privateRepo.refs.keys()].some(r=>/^refs\/heads\/learning\/observation-[a-f0-9]{64}$/.test(r)));
});

test('a packet staged before an uncertified handoff with the SAME parent is never attributed to the later context',async()=>{
 const {s,researchCommit}=await verificationScenario({issueBeforePacket:false});
 // Re-issuing the same day after packet staging cannot manufacture ordering.
 const result=await reconcile(s.args);
 assert.equal(result.observations.observations.filter(o=>o.state==='ordering_unproven').length,1);
 assert(![...s.privateRepo.refs.keys()].some(r=>/^refs\/heads\/learning\/observation-[a-f0-9]{64}$/.test(r)));
 const writes=s.privateRepo.writes.length;await reconcile(s.args);assert.equal(s.privateRepo.writes.length,writes);
 assert(Object.values(s.publicRepos).every(repo=>repo.writes.length===0));assert.equal((await s.publicApis.scifi.get('/git/ref/heads/research/2026-10-12-scifi')).object.sha,researchCommit);
});

test('sealed completed index skips historical receipt/profile reads; spoofing its proof cannot suppress pending work',async()=>{
 const {s,researchCommit}=await verificationScenario();await reconcile(s.args);
 const researchTree=s.publicRepos.scifi.trees.get((await s.publicApis.scifi.get(`/git/commits/${researchCommit}`)).tree.sha);
 const packetOid=researchTree.tree.find(e=>e.path==='research-inbox/2026-10-12.json').sha;
 const privateGet=s.privateRepo.api.get,publicGet=s.publicApis.scifi.get;
 let packetBlobReads=0;
 s.publicApis.scifi.get=async route=>{if(route===`/git/blobs/${packetOid}`)packetBlobReads++;return publicGet(route);};
 await reconcile(s.args);assert.equal(packetBlobReads,0,'Completed diagnostics must not be re-authenticated every hour');
 const ref=[...s.privateRepo.refs.values()].filter(r=>r.ref.includes('/observation-index-')).at(-1);
 const record=JSON.parse(s.privateRepo.filesAt(ref.object.sha)['learning-output/index.json']);record.proof=record.proof.slice(0,-8)+'forgedxx';
 const malicious=s.privateRepo.branch(ref.ref.slice('refs/heads/'.length),{'learning-output/index.json':stableJson(record)});
 await assert.rejects(reconcile(s.args),/invalid_observation_proof/);
 assert.equal(s.privateRepo.refs.get(ref.ref).object.sha,malicious,'Unresolved forged index must not be overwritten');
 s.privateRepo.api.get=privateGet;
});

test('an hourly run processes a bounded batch even after many days of permanently missing research',async()=>{
 const s=await activeScenario();
 for(let day=12;day<=24;day++)await reconcile({...s.args,observationBudget:4,clock:()=>new Date(`2026-10-${day}T08:00:00Z`)});
 let reads=0;
 for(const repo of [s.privateRepo,...Object.values(s.publicRepos)]){const get=repo.api.get;repo.api.get=async route=>{reads++;return get(route);};}
 const result=await reconcile({...s.args,observationBudget:4,clock:()=>new Date('2026-10-24T09:00:00Z')});
 assert.equal(result.observations.observations.length,4);assert(result.observations.deferred>=70);assert(reads<600,`Bounded reconciliation used ${reads} reads`);
 const before=[...s.privateRepo.refs].map(([name,ref])=>[name,ref.object.sha]);await reconcile({...s.args,observationBudget:4,clock:()=>new Date('2026-10-24T10:00:00Z')});
 for(const [name,sha] of before)assert.equal(s.privateRepo.refs.get(name).object.sha,sha);
});

test('legacy receipts with the already-existing identity helper recover without fingerprint rewrites or fabricated ordering',async()=>{
 const {s}=await verificationScenario(),base=await s.privateRepo.api.pinMain(),tree=s.privateRepo.trees.get(base.tree.sha);
 const source=inventoryFeedback({commit:base,tree,blobs:s.privateRepo.blobs}),request=interpretationRequest(source);
 const packetCommit=s.privateRepo.refs.get(`refs/heads/interpretation/${base.sha}`).object.sha;
 const packet=JSON.parse(s.privateRepo.filesAt(packetCommit)[`learning-inbox/${base.sha}/${request.request_id}.json`]),profiles={};
 for(const genre of GENRES)profiles[genre]=await loadPublicProfile(s.publicApis[genre],genre,JSON.parse(fs.readFileSync(new URL(`../config/${genre}.json`,import.meta.url))));
 const legacy=engineFingerprintAt(tree,{legacy:true});assert.notEqual(legacy,engineFingerprintAt(tree));
 const inputs={source,packet,packetCommit,trustedRevision:base.sha,engineFingerprint:legacy,profiles,activation:{schema_version:1,research_learning_enabled:true,public_catalog_personalization_enabled:false}};
 const expected=buildReceipt(inputs),saved=await persistImmutable(s.privateRepo.api,{base,...expected});
 const artifact=await loadVerifiedReceipt({api:s.privateRepo.api,base,expected,assertCurrent:async()=>{}});
 const issued=prepareResearchUse({inputs,artifact,genre:'scifi',researchDate:'2026-10-12'});
 const handoff=await persistImmutable(s.privateRepo.api,{base,branch:`learning/handoff-${issued.use_id}`,files:{'handoff.json':stableJson(issued)}});
 const result=await reconcile(s.args);assert.equal(result.state,'computed_active');
 assert.equal(result.observations.observations.find(o=>o.handoff_commit===handoff.commit).state,'ordering_unproven');
 assert.equal(s.privateRepo.refs.get('refs/heads/'+expected.branch).object.sha,saved.commit);
 assert.equal(JSON.parse(s.privateRepo.filesAt(saved.commit)['learning-output/receipt.json']).sources.engine_fingerprint,legacy);
});

test('sealed-state creation races reuse a verified statement despite different JWTs, while payload changes fail',async()=>{
 const s=await activeScenario(),base=await s.privateRepo.api.pinMain(),body={schema_version:1,kind:'synthetic_sealed_state'},branch='learning/issuance-'+digest(stableJson(body));
 let serial=0;const proof={...s.args.proof,sign:(body,revision)=>s.args.proof.sign(body,revision,{jti:String(++serial)})};
 const options={api:s.privateRepo.api,base,branch,name:'issuance.json',body,proof,assertCurrent:async()=>{}};
 const [first,second]=await Promise.all([persistSealedState(options),persistSealedState(options)]);
 assert.equal(first.commit,second.commit);assert(serial>=2);
 const writes=s.privateRepo.writes.length;assert.equal((await persistSealedState(options)).commit,first.commit);assert.equal(s.privateRepo.writes.length,writes);
 await assert.rejects(persistSealedState({...options,body:{...body,forged:true}}),/immutable_artifact_mismatch/);
 assert.equal(s.privateRepo.refs.get('refs/heads/'+branch).object.sha,first.commit);
});

test('monthly index lookup tolerates more than 10000 archived cursor refs while reading bounded payloads',async()=>{
 const s=await activeScenario();await reconcile(s.args);const base=await s.privateRepo.api.pinMain();
 const existing=[...s.privateRepo.refs.values()].find(r=>r.ref.includes('/observation-index-2026-10-'));
 const old=JSON.parse(s.privateRepo.filesAt(existing.object.sha)['learning-output/index.json']),body={...old.body,sequence:20000};
 const branch=`learning/observation-index-2026-10-0000020000-${digest(stableJson(body))}`;
 const stored=await persistSealedState({api:s.privateRepo.api,base,branch,name:'index.json',body,proof:s.args.proof,assertCurrent:async()=>{}});
 const get=s.privateRepo.api.get;let reads=0;
 s.privateRepo.api.get=async route=>{reads++;const result=await get(route);if(route==='/git/matching-refs/heads/learning/observation-index-2026-10-')return [...result,...Array.from({length:10001},(_,i)=>({ref:`refs/heads/learning/observation-index-2026-10-${String(i).padStart(10,'0')}-${'f'.repeat(64)}`,object:{sha:existing.object.sha}}))];return result;};
 const loaded=await loadObservationIndex({api:s.privateRepo.api,base,proof:s.args.proof,period:'2026-10',assertCurrent:async()=>{}});
 assert.equal(loaded.index.sequence,20000);assert(reads<20,`Archive lookup fetched ${reads} payloads`);assert.equal(s.privateRepo.refs.get('refs/heads/'+branch).object.sha,stored.commit);
});

test('calendar-period recovery retains older pending work while bounding the total handoff batch',async()=>{
 const s=await activeScenario();for(const date of ['2026-10-12','2026-11-12','2026-12-12'])await reconcile({...s.args,observationBudget:6,clock:()=>new Date(date+'T08:00:00Z')});
 const before=[...s.privateRepo.refs].map(([name,ref])=>[name,ref.object.sha]);
 const result=await reconcile({...s.args,observationBudget:6,clock:()=>new Date('2026-12-12T09:00:00Z')});
 assert(result.observations.observations.length<=6);assert(result.observations.deferred>=12);
 assert([...s.privateRepo.refs.keys()].some(name=>name.includes('/observation-index-2026-10-')));assert([...s.privateRepo.refs.keys()].some(name=>name.includes('/observation-index-2026-12-')));
 for(const [name,sha] of before)assert.equal(s.privateRepo.refs.get(name).object.sha,sha);
});

test('explicit provenance probe is metadata-only and the ordinary consumer cannot mint statements',()=>{
 const workflow=fs.readFileSync(new URL('../workflows/learning-finalize.yml',import.meta.url),'utf8');
 const consumer=workflow.slice(workflow.indexOf('  consume:'),workflow.indexOf('  provenance-probe:'));
 assert(!consumer.includes('id-token: write'));assert(workflow.includes("inputs.consume_genre == 'none' && !inputs.provenance_probe"));
 const probe=workflow.slice(workflow.indexOf('  provenance-probe:'),workflow.indexOf('  task-worker:'));assert(probe.includes('contents: read'));assert(!probe.includes('contents: write'));assert(probe.includes('id-token: write'));assert(probe.includes('node learning/reconcile.mjs --probe-proof'));
 const cli=fs.readFileSync(new URL('../reconcile.mjs',import.meta.url),'utf8'),body=cli.slice(cli.indexOf('  if(probe){'),cli.indexOf('  const publicApis=',cli.indexOf('  if(probe){')));
 assert(!body.includes('inventoryFeedback'));assert(!body.includes('.post('));assert(body.includes('feedback_read:false,git_writes:false'));
});

async function sessionRequest(s){
 return {schema_version:1,genre:'scifi',research_date:'2026-10-12',private_revision:s.args.trustedRevision,
  public_revision:(await s.publicApis.scifi.pinMain()).sha};
}

test('private session request recomputes a complete current context without writes or automatic log disclosure',async()=>{
 const s=await activeScenario();await reconcile(s.args);
 const request=await sessionRequest(s),before=stableJson(s.privateRepo.filesAt(s.args.trustedRevision)),writes=s.privateRepo.writes.length;
 const session=await openResearchSession({...s.args,request}),response=await privateResearchSessionResponse(session);
 assert.equal((await openResearchSession({...s.args,request})).session_id,session.session_id);
 assert.equal((await openResearchSession({...s.args,request:Object.fromEntries(Object.entries(request).reverse())})).session_id,session.session_id);
 assert.equal(await recheckResearchSession(session),session);
 assert.equal(response.genre,'scifi');assert(response.context.preferences.length>0);
 assert.equal(response.context_hash,digest(stableJson(response.context)));
 assert.equal(response.source_heads.private,s.args.trustedRevision);
 assert(!stableJson(session).includes('preferences'));assert(!stableJson(response).includes('PRIVATE_SENTINEL'));
 assert(!stableJson(response).includes('tt999999991'));assert(!stableJson(response).includes('feedback_id'));
 assert.throws(()=>{response.context.preferences.length=0;},TypeError);
 await assert.rejects(privateResearchSessionResponse(structuredClone(session)),/unauthenticated_research_session/);
 assert.equal(s.privateRepo.writes.length,writes);assert.equal(stableJson(s.privateRepo.filesAt(s.args.trustedRevision)),before);
 for(const repo of Object.values(s.publicRepos))assert.equal(repo.writes.length,0);
});

test('closed session requests reject arbitrary revisions, invalid dates, caller briefs and activation fields',async()=>{
 const s=await activeScenario();await reconcile(s.args);const writes=s.privateRepo.writes.length,request=await sessionRequest(s);
 for(const invalid of [null,{}, {...request,genre:'unknown'}, {...request,private_revision:'a'.repeat(40)},
  {...request,research_date:'2026-02-30'}, {...request,research_date:'2026-10-11'}, {...request,research_date:'2026-10-13'},
  {...request,context:{preferences:[]}}, {...request,research_learning_enabled:true}]){
  await assert.rejects(openResearchSession({...s.args,request:invalid}),/invalid_consumer_request/);
 }
 await assert.rejects(openResearchSession({...s.args,request:{...request,public_revision:'b'.repeat(40)}}),/stale_input/);
 assert.equal(s.privateRepo.writes.length,writes);
});

const taskCall=(operation,request)=>({schema_version:1,operation,request});
const taskSearch=(context,request_id='search-1',query='science mystery public reviews')=>taskCall('search',{
 task_token:context.task_token,request_id,query,preference_indexes:[0]});

test('task adapter defaults to held before repository reads, and active host access cannot override inactive policy',async()=>{
 const s=await activeScenario();await reconcile(s.args);const request=await sessionRequest(s),writes=s.privateRepo.writes.length;
 let reads=0;const get=s.privateRepo.api.get;s.privateRepo.api.get=async route=>{reads++;return get(route);};
 const held=createPrivateResearchTaskAdapter(s.args);
 await assert.rejects(held.dispatch(taskCall('open',request)),/private_task_access_held/);
 assert.equal(reads,0);assert.equal(s.privateRepo.writes.length,writes);
 await assert.rejects(held.dispatch(taskCall('open',{...request,taskAccessAllowed:true})),/invalid_task_call/);
 const inactive=scenario();await stage(inactive);await reconcile(inactive.args);
 const adapter=createPrivateResearchTaskAdapter({...inactive.args,clock:()=>new Date('2026-10-11T22:30:00Z'),taskAccessAllowed:async()=>true});
 const before=inactive.privateRepo.writes.length;
 await assert.rejects(adapter.dispatch(taskCall('open',await sessionRequest(inactive))),/learning_inactive/);
 assert.equal(inactive.privateRepo.writes.length,before);
});

test('task adapter connects private context, durable searches and the actual packet while unchanged calls reuse records',async()=>{
 let adapter,context,result;let calls=0;
 const {s,researchCommit}=await verificationScenario({onReady:async s=>{
  adapter=createPrivateResearchTaskAdapter({...s.args,taskAccessAllowed:async()=>true,searchProvider:{id:'synthetic-task-search',
   async search(){calls++;return {request_id:null,sources:[{url:'https://example.org/review',title:'Public fixture review'}]};}}});
  context=await adapter.dispatch(taskCall('open',await sessionRequest(s)));
  assert.equal(s.privateRepo.refs.get('refs/heads/learning/session-'+context.response.session_id).object.sha,context.context_commit);
  assert.deepEqual(await adapter.dispatch(taskCall('open',await sessionRequest(s))),context);
  [result]=await Promise.all([adapter.dispatch(taskSearch(context)),adapter.dispatch(taskSearch(context))]);
  assert.equal(calls,1);assert(result.observation_commit);
  const branch=`refs/heads/learning/search-${result.session_id}-${result.search_id}`;
  assert.equal(s.privateRepo.refs.get(branch).object.sha,result.observation_commit);
  await assert.rejects(adapter.dispatch(taskSearch(context,'search-1','different public query')),/task_request_conflict/);
  assert.equal(calls,1);
 }});
 const verified=await adapter.dispatch(taskCall('verify',{task_token:context.task_token,research_commit:researchCommit}));
 assert.equal(verified.research_commit,researchCommit);assert.equal(verified.search_adapter_invocations_observed,1);
 assert.equal(verified.actual_context_use_verified,false);assert.equal(verified.behavioral_effect_observed,false);
 await assert.rejects(adapter.dispatch(taskSearch(context,'after-packet')),/research_already_staged/);
 assert.equal(s.publicRepos.scifi.writes.length,0);assert(!stableJson([context,result,verified]).includes('PRIVATE_SENTINEL'));
 assert(!stableJson(context).includes('tt999999991'));
});

test('task adapter resumes a transient journal failure with the original search and blocks unrelated work until recovery',async()=>{
 const s=await activeScenario();await reconcile(s.args);let calls=0;
 const adapter=createPrivateResearchTaskAdapter({...s.args,taskAccessAllowed:async()=>true,
  searchProvider:{id:'synthetic-task-search',async search(){calls++;return {request_id:null,sources:[]};}}});
 const context=await adapter.dispatch(taskCall('open',await sessionRequest(s))),post=s.privateRepo.api.post;
 let failOnce=true;s.privateRepo.api.post=async(route,body)=>{
  if(failOnce&&route==='/git/refs'&&body.ref.startsWith('refs/heads/learning/search-')){
   failOnce=false;const error=Error('PRIVATE_SENTINEL GitHub unavailable');error.code='github_request_failed';error.status=503;throw error;
  }return post(route,body);
 };
 await assert.rejects(adapter.dispatch(taskSearch(context)),error=>error.code==='github_request_failed'&&!String(error).includes('PRIVATE_SENTINEL'));
 await assert.rejects(adapter.dispatch(taskSearch(context,'another-search')),/task_search_unresolved/);
 await assert.rejects(adapter.dispatch(taskCall('verify',{task_token:context.task_token,research_commit:'a'.repeat(40)})),/task_search_unresolved/);
 assert.equal((await adapter.dispatch(taskCall('open',await sessionRequest(s)))).task_token,context.task_token);
 const recovered=await adapter.dispatch(taskSearch(context));assert(recovered.observation_commit);assert.equal(calls,1);
 const writes=s.privateRepo.writes.length;assert.deepEqual(await adapter.dispatch(taskSearch(context)),recovered);
 assert.equal(s.privateRepo.writes.length,writes);
});

test('task adapter stops after provider or permanent write failure and changing request IDs does not replay the operation',async()=>{
 for(const failure of ['provider','journal']){
  const s=await activeScenario();await reconcile(s.args);let calls=0;
  const adapter=createPrivateResearchTaskAdapter({...s.args,taskAccessAllowed:async()=>true,
   searchProvider:{id:'synthetic-task-search',async search(){calls++;if(failure==='provider')throw Error('PRIVATE_SENTINEL');return {request_id:null,sources:[]};}}});
  const context=await adapter.dispatch(taskCall('open',await sessionRequest(s))),post=s.privateRepo.api.post;
  if(failure==='journal')s.privateRepo.api.post=async(route,body)=>{
   if(route==='/git/refs'&&body.ref.startsWith('refs/heads/learning/search-')){
    const error=Error('PRIVATE_SENTINEL denied');error.code='github_request_failed';error.status=403;throw error;
   }return post(route,body);
  };
  const code=failure==='provider'?'research_search_failed':'github_request_failed';
  for(const id of ['same-request','same-request','changed-request'])await assert.rejects(adapter.dispatch(taskSearch(context,id)),
   error=>error.code===code&&!String(error).includes('PRIVATE_SENTINEL'));
  assert.equal(calls,1);
 }
});

test('task adapter rechecks the separate hold and policy before releasing cached context or search results',async()=>{
 const s=await activeScenario();await reconcile(s.args);let access=true,calls=0;
 const adapter=createPrivateResearchTaskAdapter({...s.args,taskAccessAllowed:async()=>access,
  searchProvider:{id:'synthetic-task-search',async search(){calls++;return {request_id:null,sources:[]};}}});
 const context=await adapter.dispatch(taskCall('open',await sessionRequest(s)));await adapter.dispatch(taskSearch(context));
 const writes=s.privateRepo.writes.length;access=false;
 for(const call of [taskCall('context',{task_token:context.task_token}),taskSearch(context),
  taskCall('verify',{task_token:context.task_token,research_commit:'a'.repeat(40)})]){
  await assert.rejects(adapter.dispatch(call),/private_task_access_held/);
 }
 access=true;s.publicRepos.anime.branch('main',{'config/research.json':'{"changed":true}'});
 await assert.rejects(adapter.dispatch(taskSearch(context)));await assert.rejects(adapter.dispatch(taskCall('context',{task_token:context.task_token})));
 assert.equal(calls,1);assert.equal(s.privateRepo.writes.length,writes);
});

test('queued task calls snapshot their data and cannot borrow another adapter token or inject execution options',async()=>{
 const s=await activeScenario();await reconcile(s.args);const queries=[];let release,started;
 const entered=new Promise(resolve=>{started=resolve;}),wait=new Promise(resolve=>{release=resolve;});
 const adapter=createPrivateResearchTaskAdapter({...s.args,taskAccessAllowed:async()=>true,
  searchProvider:{id:'synthetic-task-search',async search(query){queries.push(query);if(queries.length===1){started();await wait;}return {request_id:null,sources:[]};}}});
 const context=await adapter.dispatch(taskCall('open',await sessionRequest(s)));
 const first=adapter.dispatch(taskSearch(context,'first','original first query'));await entered;
 const queued=taskSearch(context,'second','original second query'),second=adapter.dispatch(queued);
 queued.request.query='PRIVATE_SENTINEL changed queued query';queued.request.preference_indexes[0]=999;release();
 await Promise.all([first,second]);assert.deepEqual(queries,['original first query','original second query']);
 const other=createPrivateResearchTaskAdapter({...s.args,taskAccessAllowed:async()=>true});
 await assert.rejects(other.dispatch(taskCall('context',{task_token:context.task_token})),/unknown_task_session/);
 for(const invalid of [{...taskSearch(context),token:'credential'},taskCall('search',{...taskSearch(context).request,provider:'evil'}),
  taskCall('verify',{task_token:context.task_token,research_commit:'a'.repeat(40),script:'AI code'})]){
  await assert.rejects(adapter.dispatch(invalid),/invalid_task_call/);
 }
});

test('task adapter refuses a full durable journal before invoking the provider',async()=>{
 const s=await activeScenario();await reconcile(s.args);let calls=0;
 const adapter=createPrivateResearchTaskAdapter({...s.args,taskAccessAllowed:async()=>true,
  searchProvider:{id:'synthetic-task-search',async search(){calls++;return {request_id:null,sources:[]};}}});
 const context=await adapter.dispatch(taskCall('open',await sessionRequest(s)));
 for(let i=0;i<100;i++){
  const ref=`refs/heads/learning/search-${context.response.session_id}-${digest(String(i))}`;
  s.privateRepo.refs.set(ref,{ref,object:{sha:'a'.repeat(40)}});
 }
 const writes=s.privateRepo.writes.length;await assert.rejects(adapter.dispatch(taskSearch(context)),/session_journal_limit/);
 assert.equal(calls,0);assert.equal(s.privateRepo.writes.length,writes);
});

test('a replacement task worker authenticates a saved search after a lost write acknowledgement without searching again',async()=>{
 let adapter,context,first;let calls=0;
 const {s,researchCommit}=await verificationScenario({onReady:async s=>{
  const options={...s.args,taskAccessAllowed:async()=>true,searchProvider:{id:'synthetic-task-search',
   async search(){calls++;return {request_id:null,sources:[{url:'https://example.org/recovered',title:'Recovered public fixture'}]};}}};
  first=createPrivateResearchTaskAdapter(options);const original=await first.dispatch(taskCall('open',await sessionRequest(s))),post=s.privateRepo.api.post;
  let lose=true;s.privateRepo.api.post=async(route,body)=>{
   const result=await post(route,body);
   if(lose&&route==='/git/refs'&&body.ref.startsWith('refs/heads/learning/search-')){
    lose=false;const error=Error('lost acknowledgement');error.code='github_request_failed';error.status=503;throw error;
   }return result;
  };
  await assert.rejects(first.dispatch(taskSearch(original)),/github_request_failed/);
  adapter=createPrivateResearchTaskAdapter(options);context=await adapter.dispatch(taskCall('open',await sessionRequest(s)));
  assert.notEqual(context.task_token,original.task_token);
  await assert.rejects(adapter.dispatch(taskCall('context',{task_token:original.task_token})),/unknown_task_session/);
  const recovered=await adapter.dispatch(taskSearch(context));assert.equal(recovered.sources[0].url,'https://example.org/recovered');
  assert.equal(calls,1);
  await assert.rejects(adapter.dispatch(taskSearch(context,'search-1','changed query after restart')),/task_request_conflict/);
 }});
 const result=await adapter.dispatch(taskCall('verify',{task_token:context.task_token,research_commit:researchCommit}));
 assert.equal(result.search_adapter_invocations_observed,1);assert.equal(calls,1);
 assert.equal([...s.privateRepo.refs.keys()].filter(name=>name.includes('/learning/search-')).length,1);
});

test('unresolved durable intent blocks a replacement worker even with another request ID',async()=>{
 const s=await activeScenario();await reconcile(s.args);let calls=0;
 const options={...s.args,taskAccessAllowed:async()=>true,searchProvider:{id:'synthetic-task-search',async search(){calls++;return {request_id:null,sources:[]};}}};
 const first=createPrivateResearchTaskAdapter(options);await first.dispatch(taskCall('open',await sessionRequest(s)));
 const session=await openResearchSession({...s.args,request:await sessionRequest(s)});
 await persistResearchSessionTaskIntent({api:s.privateRepo.api,session,proof:s.args.proof,nonce:'11111111-1111-4111-8111-111111111111',
  request:{request_id:'uncertain-search',query:'original public query',preference_indexes:[0]}});
 const replacement=createPrivateResearchTaskAdapter(options),context=await replacement.dispatch(taskCall('open',await sessionRequest(s)));
 const writes=s.privateRepo.writes.length;
 for(const id of ['uncertain-search','different-search'])await assert.rejects(replacement.dispatch(taskSearch(context,id,'original public query')),/task_search_unresolved/);
 await assert.rejects(replacement.dispatch(taskCall('verify',{task_token:context.task_token,research_commit:'a'.repeat(40)})),/task_search_unresolved/);
 assert.equal(calls,0);assert.equal(s.privateRepo.writes.length,writes);
});

test('late search persistence resolves a replacement worker pending intent through authenticated reopening',async()=>{
 const s=await activeScenario();await reconcile(s.args);let calls=0;
 const options={...s.args,taskAccessAllowed:async()=>true,searchProvider:{id:'synthetic-task-search',async search(){calls++;return {request_id:null,sources:[]};}}};
 const first=createPrivateResearchTaskAdapter(options),original=await first.dispatch(taskCall('open',await sessionRequest(s))),post=s.privateRepo.api.post;
 let failOnce=true;s.privateRepo.api.post=async(route,body)=>{
  if(failOnce&&route==='/git/refs'&&body.ref.startsWith('refs/heads/learning/search-')){
   failOnce=false;const error=Error('temporary failure');error.code='github_request_failed';error.status=503;throw error;
  }return post(route,body);
 };
 await assert.rejects(first.dispatch(taskSearch(original)),/github_request_failed/);
 const replacement=createPrivateResearchTaskAdapter(options),pending=await replacement.dispatch(taskCall('open',await sessionRequest(s)));
 await assert.rejects(replacement.dispatch(taskSearch(pending)),/task_search_unresolved/);
 const saved=await first.dispatch(taskSearch(original));
 const resumed=await replacement.dispatch(taskCall('open',await sessionRequest(s)));
 assert.equal(resumed.task_token,pending.task_token);
 assert.equal((await replacement.dispatch(taskSearch(resumed))).observation_commit,saved.observation_commit);assert.equal(calls,1);
});

test('legacy version-2 search journals remain valid and restore as unkeyed private observations',async()=>{
 let adapter,context;
 const {researchCommit}=await verificationScenario({onReady:async s=>{
  const session=await openResearchSession({...s.args,request:await sessionRequest(s),
   searchProvider:{id:'synthetic-legacy-search',async search(){return {request_id:null,sources:[]};}}});
  await persistResearchSessionContext({api:s.privateRepo.api,session,proof:s.args.proof});
  const observed=await observeResearchSessionSearch({session,query:'legacy public query',preferenceIndexes:[]});
  const verified=(await import('../research-session.mjs')).privateResearchSearchObservation({session,handle:observed.handle});
  const {task_request_id,...body}=verified.observation;body.schema_version=2;
  const searchId=digest(stableJson(body)),base=await s.privateRepo.api.pinMain();
  await persistSealedState({api:s.privateRepo.api,base,branch:`learning/search-${session.session_id}-${searchId}`,name:'search.json',
   body:sessionSearchBody(searchId,body),proof:s.args.proof,assertCurrent:()=>recheckResearchSession(session)});
  adapter=createPrivateResearchTaskAdapter({...s.args,taskAccessAllowed:async()=>true});
  context=await adapter.dispatch(taskCall('open',await sessionRequest(s)));
 }});
 const result=await adapter.dispatch(taskCall('verify',{task_token:context.task_token,research_commit:researchCommit}));
 assert.equal(result.search_adapter_invocations_observed,1);assert.equal(result.actual_context_use_verified,false);
});

test('racing task workers reserve one durable intent and only its owner invokes the provider',async()=>{
 const s=await activeScenario();await reconcile(s.args);let calls=0;
 const options={...s.args,taskAccessAllowed:async()=>true,searchProvider:{id:'synthetic-task-search',async search(){calls++;return {request_id:null,sources:[]};}}};
 const left=createPrivateResearchTaskAdapter(options),right=createPrivateResearchTaskAdapter(options);
 const request=taskCall('open',await sessionRequest(s));
 const [a,b]=await Promise.all([left.dispatch(request),right.dispatch(request)]);
 const settled=await Promise.allSettled([left.dispatch(taskSearch(a)),right.dispatch(taskSearch(b))]);
 assert.equal(settled.filter(result=>result.status==='fulfilled').length,1);
 assert.equal(settled.find(result=>result.status==='rejected').reason.code,'task_search_unresolved');
 assert.equal(calls,1);assert.equal([...s.privateRepo.refs.keys()].filter(name=>name.includes('/task-intent-')).length,1);
});

test('task intent captures the code-owned nonce and request before asynchronous authority checks',async()=>{
 const s=await activeScenario();await reconcile(s.args);const session=await openResearchSession({...s.args,request:await sessionRequest(s)});
 const request={request_id:'original-request',query:'original public query',preference_indexes:[0]};
 const options={api:s.privateRepo.api,session,proof:s.args.proof,nonce:'11111111-1111-4111-8111-111111111111',request};
 const get=s.privateRepo.api.get;let changed=false;
 s.privateRepo.api.get=async route=>{if(!changed){changed=true;options.nonce='INVALID';request.query='changed';}return get(route);};
 const record=await persistResearchSessionTaskIntent(options);assert.equal(record.owned,true);
 assert.equal(record.body.nonce,'11111111-1111-4111-8111-111111111111');assert.equal(record.body.query,'original public query');
});

test('GitHub network and body-read exceptions use closed recoverable codes without repeating writes or exposing tokens',async()=>{
 for(const stage of ['fetch','body'])for(const method of ['get','post']){
  let calls=0;const client=new GitHub('Lewdcifer666/wtf-scifi-feedback','SYNTHETIC_SECRET',{writable:true,fetcher:async()=>{
   calls++;if(stage==='fetch')throw TypeError('SYNTHETIC_SECRET socket failed');
   return {ok:true,json:async()=>{throw TypeError('SYNTHETIC_SECRET body interrupted');}};
  }});
  await assert.rejects(client[method]('/git/refs',{}),error=>error.code==='transport_failure'&&!String(error).includes('SYNTHETIC_SECRET'));
  assert.equal(calls,1);
 }
 const denied=new GitHub('Lewdcifer666/wtf-scifi-feedback','SYNTHETIC_SECRET',{writable:true,fetcher:async()=>({ok:false,status:403})});
 await assert.rejects(denied.post('/git/refs',{}),error=>error.code==='github_request_failed'&&error.status===403);
});

test('task adapter retains an observed handle across real GitHub and OIDC network exceptions',async()=>{
 for(const transport of ['github','proof']){
  const s=await activeScenario();await reconcile(s.args);let calls=0,failOnce=true;
  const post=s.privateRepo.api.post,fixture=s.args.proof;
  const unavailable=async()=>{throw TypeError('PRIVATE_SENTINEL socket failure');};
  const brokenGit=new GitHub('Lewdcifer666/wtf-scifi-feedback','SYNTHETIC_SECRET',{writable:true,fetcher:unavailable});
  const brokenProof=githubObservationProof({env:{ACTIONS_ID_TOKEN_REQUEST_URL:'https://pipelines.actions.githubusercontent.com/synthetic',ACTIONS_ID_TOKEN_REQUEST_TOKEN:'SYNTHETIC_SECRET'},fetcher:unavailable});
  if(transport==='github')s.privateRepo.api.post=async(route,body)=>{
   if(failOnce&&route==='/git/refs'&&body.ref.startsWith('refs/heads/learning/search-')){failOnce=false;return brokenGit.post(route,body);}
   return post(route,body);
  };
  else s.args.proof={verify:fixture.verify,async sign(body,revision){
   if(failOnce&&body.kind==='private_research_search_record'){failOnce=false;return brokenProof.sign(body,revision);}
   return fixture.sign(body,revision);
  }};
  const adapter=createPrivateResearchTaskAdapter({...s.args,taskAccessAllowed:async()=>true,
   searchProvider:{id:'synthetic-task-search',async search(){calls++;return {request_id:null,sources:[]};}}});
  const context=await adapter.dispatch(taskCall('open',await sessionRequest(s)));
  await assert.rejects(adapter.dispatch(taskSearch(context)),error=>error.code===(transport==='github'?'transport_failure':'proof_transport_failure')&&!String(error).includes('PRIVATE_SENTINEL'));
  const result=await adapter.dispatch(taskSearch(context));assert(result.observation_commit);assert.equal(calls,1);
 }
});

test('missing search configuration creates no intent and a configured replacement worker can start cleanly',async()=>{
 const s=await activeScenario();await reconcile(s.args);
 const empty=createPrivateResearchTaskAdapter({...s.args,taskAccessAllowed:async()=>true}),request=taskCall('open',await sessionRequest(s));
 const context=await empty.dispatch(request),writes=s.privateRepo.writes.length;
 await assert.rejects(empty.dispatch(taskSearch(context)),/search_provider_unavailable/);
 assert.equal([...s.privateRepo.refs.keys()].filter(name=>name.includes('/task-intent-')).length,0);
 assert.equal(s.privateRepo.writes.length,writes);let calls=0;
 const configured=createPrivateResearchTaskAdapter({...s.args,taskAccessAllowed:async()=>true,
  searchProvider:{id:'synthetic-task-search',async search(){calls++;return {request_id:null,sources:[]};}}});
 const ready=await configured.dispatch(request);assert((await configured.dispatch(taskSearch(ready))).observation_commit);assert.equal(calls,1);
});

test('explicit reopening refreshes late durable results even if this worker opened before any intent existed',async()=>{
 for(const attemptBeforeReopen of [false,true]){
  const s=await activeScenario();await reconcile(s.args);let calls=0;
  const options={...s.args,taskAccessAllowed:async()=>true,searchProvider:{id:'synthetic-task-search',async search(){calls++;return {request_id:null,sources:[]};}}};
  const first=createPrivateResearchTaskAdapter(options),second=createPrivateResearchTaskAdapter(options),request=taskCall('open',await sessionRequest(s));
  const a=await first.dispatch(request),b=await second.dispatch(request),saved=await first.dispatch(taskSearch(a));
  if(attemptBeforeReopen)await assert.rejects(second.dispatch(taskSearch(b)),/task_search_unresolved/);
  const fresh=await second.dispatch(request),recovered=await second.dispatch(taskSearch(fresh));
  assert.equal(recovered.observation_commit,saved.observation_commit);assert.equal(calls,1);
 }
});

test('post-provider head and complete-inventory network failures retain the original invocation for a safe retry',async()=>{
 for(const stage of ['heads','inventory','http']){
  const s=await activeScenario();await reconcile(s.args);let calls=0,returned=false,failOnce=true;
  const get=s.privateRepo.api.get;s.privateRepo.api.get=async route=>{
   if(returned&&failOnce&&(stage==='heads'?route==='/':route.startsWith('/git/blobs/'))){
    failOnce=false;const error=Error('PRIVATE_SENTINEL temporary verification failure');
    error.code=stage==='http'?'github_request_failed':'transport_failure';if(stage==='http')error.status=503;throw error;
   }return get(route);
  };
  const adapter=createPrivateResearchTaskAdapter({...s.args,taskAccessAllowed:async()=>true,
   searchProvider:{id:'synthetic-task-search',async search(){calls++;returned=true;return {request_id:null,sources:[]};}}});
  const context=await adapter.dispatch(taskCall('open',await sessionRequest(s)));
  await assert.rejects(adapter.dispatch(taskSearch(context)),error=>error.code===(stage==='http'?'github_request_failed':'transport_failure'));
  assert((await adapter.dispatch(taskSearch(context))).observation_commit);assert.equal(calls,1);
 }
});

test('authenticated HTTP MCP connects complete private recomputation, durable evidence and actual packet verification',async()=>{
 let client,host,context;let calls=0;
 try{
  const {s,researchCommit}=await verificationScenario({onReady:async s=>{
   const adapter=createPrivateResearchTaskAdapter({...s.args,taskAccessAllowed:async()=>true,
    searchProvider:{id:'synthetic-http-search',async search(){calls++;return {request_id:null,sources:[{url:'https://example.org/review',title:'Synthetic public review'}]};}}});
   const token=digest('synthetic local HTTP credential');host=await startLocalResearchMcpHost({bearerToken:token,adapter});
   client=new Client({name:'synthetic-full-private-task',version:'1'});
   await client.connect(new StreamableHTTPClientTransport(new URL(host.url),{requestInit:{headers:{Authorization:'Bearer '+token}}}));
   context=(await client.callTool({name:'private_research_open',arguments:await sessionRequest(s)})).structuredContent;
   assert(context.context_commit);assert(context.response.context.preferences.length>0);
   const input={task_token:context.task_token,request_id:'http-search',query:'science mystery public reviews',preference_indexes:[0]};
   const result=(await client.callTool({name:'private_research_search',arguments:input})).structuredContent;
   assert(result.observation_commit);assert.equal(result.sources[0].url,'https://example.org/review');
   const repeated=(await client.callTool({name:'private_research_search',arguments:input})).structuredContent;
   assert.deepEqual(repeated,result);assert.equal(calls,1);
  }});
  const verified=(await client.callTool({name:'private_research_verify',arguments:{task_token:context.task_token,research_commit:researchCommit}})).structuredContent;
  assert.equal(verified.research_commit,researchCommit);assert.equal(verified.search_adapter_invocations_observed,1);
  assert.equal(verified.actual_context_use_verified,false);assert.equal(verified.behavioral_effect_observed,false);
  assert.equal(s.publicRepos.scifi.writes.length,0);assert(!JSON.stringify(context).includes('PRIVATE_SENTINEL'));
 }finally{await client?.close();await host?.close();}
});

test('inactive or unpersisted learning blocks session opening without a fallback writer',async()=>{
 const inactive=scenario();inactive.args.clock=()=>new Date('2026-10-11T22:30:00Z');await stage(inactive);await reconcile(inactive.args);const writes=inactive.privateRepo.writes.length;
 await assert.rejects(openResearchSession({...inactive.args,request:await sessionRequest(inactive)}),/learning_inactive/);
 assert.equal(inactive.privateRepo.writes.length,writes);
 const missing=await activeScenario();
 await assert.rejects(openResearchSession({...missing.args,request:await sessionRequest(missing)}),/invalid_handoff/);
 assert.equal(missing.privateRepo.writes.length,0);
});

test('a session cannot be opened after research or unauthorized branch work has already been staged',async()=>{
 for(const content of [{'research-inbox/2026-10-12.json':'{}'},{'scripts/evil.mjs':'throw Error("UNTRUSTED")'}]){
  const s=await activeScenario();await reconcile(s.args);const request=await sessionRequest(s),writes=s.privateRepo.writes.length;
  s.publicRepos.scifi.branch('research/2026-10-12-scifi',content);
  await assert.rejects(openResearchSession({...s.args,request}),/research_already_staged/);
  assert.equal(s.privateRepo.writes.length,writes);
 }
});

test('any of six changed public heads or a superseding private revision invalidates the session',async()=>{
 for(const changed of [...GENRES,'private']){
  const s=await activeScenario();await reconcile(s.args);const session=await openResearchSession({...s.args,request:await sessionRequest(s)}),writes=s.privateRepo.writes.length;
  if(changed==='private')s.privateRepo.branch('main',{'data/feedback/2026-10-01/synthetic.json':stableJson({...s.event,feedback:'A replacement opinion.'})});
  else s.publicRepos[changed].branch('main',{'config/research.json':'{"changed_policy":true}'});
  await assert.rejects(recheckResearchSession(session));
  await assert.rejects(privateResearchSessionResponse(session));
  assert.equal(s.privateRepo.writes.length,writes);
 }
});

test('session date follows Berlin midnight and rechecks immediately before returning context',async()=>{
 const s=await activeScenario();await reconcile(s.args);let now=new Date('2026-10-12T21:59:59Z');
 const clock=()=>now,session=await openResearchSession({...s.args,clock,request:await sessionRequest(s)});
 now=new Date('2026-10-12T22:00:00Z');
 await assert.rejects(recheckResearchSession(session),/invalid_consumer_request/);
 await assert.rejects(privateResearchSessionResponse(session),/invalid_consumer_request/);
 await assert.rejects(verifyResearchSessionCommit({session,researchCommit:'a'.repeat(40)}),/stale_input/);
});

test('session verifies actual packet ancestry and diagnostics without claiming AI use or a behavioral effect',async()=>{
 let session;
 const {s,researchCommit}=await verificationScenario({onReady:async s=>{session=await openResearchSession({...s.args,request:await sessionRequest(s)});}});
 const writes=s.privateRepo.writes.length;
 const result=await verifyResearchSessionCommit({session,researchCommit});
 assert.equal(result.trace.research_commit,researchCommit);assert.equal(result.session_id,session.session_id);
 assert.equal(result.actual_context_use_verified,false);assert.equal(result.behavioral_effect_observed,false);
 assert.equal(result.trace.effect_status,'candidate_diagnostics_only');assert.equal(result.trace.candidates.length,2);
 await assert.rejects(verifyResearchSessionCommit({session:structuredClone(session),researchCommit}),/unauthenticated_research_session/);
 await assert.rejects(recheckResearchSession(session),/research_already_staged/);
 assert.equal(s.privateRepo.writes.length,writes);assert.equal(s.publicRepos.scifi.writes.length,0);
});

test('public staging followed by changed feedback or retraction cannot reuse the old session',async()=>{
 for(const status of ['seen','retracted']){
  let session;
  const {s,researchCommit}=await verificationScenario({onReady:async s=>{session=await openResearchSession({...s.args,request:await sessionRequest(s)});}});
  const writes=s.privateRepo.writes.length;
  s.privateRepo.branch('main',{'data/feedback/2026-10-01/synthetic.json':stableJson({...s.event,status})});
  await assert.rejects(verifyResearchSessionCommit({session,researchCommit}));
  assert.equal(s.privateRepo.writes.length,writes);
 }
});

test('trusted search adapter observations bind real local invocations to the session and actual packet without claiming effect',async()=>{
 let session,searches;const calls=[];
 const {s,researchCommit}=await verificationScenario({onReady:async s=>{
  const provider={id:'synthetic-primary-search',search:async query=>{
   calls.push(query);return {request_id:'synthetic-provider-request',sources:[{url:'https://example.org/review',title:'Public fixture review'}]};
  }};
  session=await openResearchSession({...s.args,request:await sessionRequest(s),searchProvider:provider});
  const learned=await observeResearchSessionSearch({session,query:'science mystery films investigation reviews',preferenceIndexes:[0]});
  const baseline=await observeResearchSessionSearch({session,query:'science fiction film reviews',preferenceIndexes:[]});
  searches=[learned.handle,baseline.handle];
  assert.equal(learned.sources[0].url,'https://example.org/review');
  assert(!stableJson(learned.handle).includes('query'));assert(Object.isFrozen(learned.sources[0]));
 }});
 const writes=s.privateRepo.writes.length,result=await verifyResearchSessionCommit({session,researchCommit,searches});
 assert.deepEqual(calls,['science mystery films investigation reviews','science fiction film reviews']);
 assert.equal(result.trace.research_commit,researchCommit);assert.equal(result.search_adapter_invocations_observed,2);
 assert.deepEqual(result.searches[0].preference_indexes,[0]);assert.deepEqual(result.searches[1].preference_indexes,[]);
 assert.equal(result.actual_context_use_verified,false);assert.equal(result.behavioral_effect_observed,false);
 assert(!stableJson(result).includes('PRIVATE_SENTINEL'));assert(!stableJson(result).includes('tt999999991'));
 await assert.rejects(verifyResearchSessionCommit({session,researchCommit,searches:[structuredClone(searches[0])]}),/unauthenticated_research_search/);
 await assert.rejects(verifyResearchSessionCommit({session,researchCommit,searches:[searches[0],searches[0]]}),/invalid_research_search_evidence/);
 await assert.rejects(verifyResearchSessionCommit({session,researchCommit,searches:new Array(1)}),/unauthenticated_research_search/);
 assert.equal(s.privateRepo.writes.length,writes);assert.equal(s.publicRepos.scifi.writes.length,0);
});

test('search evidence from a different authenticated session cannot be relabeled onto another session',async()=>{
 let session,other,handle;
 const {researchCommit}=await verificationScenario({onReady:async s=>{
  const options={...s.args,request:await sessionRequest(s),searchProvider:{id:'synthetic-search',search:async()=>({request_id:null,sources:[]})}};
  session=await openResearchSession(options);other=await openResearchSession(options);
  assert.equal(session.session_id,other.session_id);
  ({handle}=await observeResearchSessionSearch({session:other,query:'a public synthetic query',preferenceIndexes:[]}));
 }});
 await assert.rejects(verifyResearchSessionCommit({session,researchCommit,searches:[handle]}),/unauthenticated_research_search/);
});

test('search validation and provider errors stop locally without a retry or an alternate provider',async()=>{
 const s=await activeScenario();await reconcile(s.args);const request=await sessionRequest(s);let calls=0;
 const searchProvider={id:'synthetic-search',search:async()=>{calls++;throw Error('PRIVATE_SENTINEL provider failure');}};
 const session=await openResearchSession({...s.args,request,searchProvider});
 for(const args of [{query:'',preferenceIndexes:[]},{query:'a query',preferenceIndexes:[999]},
  {query:'a query',preferenceIndexes:[0,0]},{query:'a query',preferenceIndexes:['0']},
  {query:'\ud800',preferenceIndexes:[]},{query:'x'.repeat(2001),preferenceIndexes:[]},{query:'a query',preferenceIndexes:new Array(1)}]){
  await assert.rejects(observeResearchSessionSearch({session,...args}),/invalid_search_request/);
 }
 assert.equal(calls,0);
 await assert.rejects(observeResearchSessionSearch({session,query:'a public query',preferenceIndexes:[]}),error=>error.code==='research_search_failed'&&!String(error).includes('PRIVATE_SENTINEL'));
 assert.equal(calls,1);
 const unavailable=await openResearchSession({...s.args,request});
 await assert.rejects(observeResearchSessionSearch({session:unavailable,query:'a public query',preferenceIndexes:[]}),/search_provider_unavailable/);
 await assert.rejects(openResearchSession({...s.args,request,searchProvider:{id:'arbitrary-provider',search:'AI-authored code'}}),/invalid_search_provider/);
});

test('malformed search results and source movement during search cannot become accepted evidence',async()=>{
 for(const response of [{sources:[],request_id:null,score:100},
  {sources:[{url:'https://secret@example.org/review',title:'Fixture'}],request_id:null},
  {sources:[{url:'javascript:alert(1)',title:'Fixture'}],request_id:null},
  {sources:[],request_id:null}]){
  const s=await activeScenario();await reconcile(s.args);const writes=s.privateRepo.writes.length;let calls=0;
  const move=response.sources.length===0&&!Object.hasOwn(response,'score');
  const session=await openResearchSession({...s.args,request:await sessionRequest(s),searchProvider:{id:'synthetic-search',search:async()=>{
   calls++;if(move)s.publicRepos.anime.branch('main',{'config/research.json':'{"changed_during_search":true}'});return response;
  }}});
  await assert.rejects(observeResearchSessionSearch({session,query:'a public query',preferenceIndexes:[]}));
  assert.equal(calls,1);assert.equal(s.privateRepo.writes.length,writes);
 }
});

test('search observation snapshots validated preferences and provider results across asynchronous currentness checks',async()=>{
 let session,handle;const preferenceIndexes=[0],response={request_id:null,sources:[{url:'https://example.org/review',title:'Original public review'}]};
 const {researchCommit}=await verificationScenario({onReady:async s=>{
  let returned=false,changed=false;const get=s.privateRepo.api.get;
  s.privateRepo.api.get=async route=>{
   if(returned&&!changed){changed=true;response.sources[0].url='https://secret@example.org/changed';}
   return get(route);
  };
  session=await openResearchSession({...s.args,request:await sessionRequest(s),searchProvider:{id:'synthetic-search',search:async()=>{
   preferenceIndexes[0]=999;returned=true;return response;
  }}});
  ({handle}=await observeResearchSessionSearch({session,query:'a public query',preferenceIndexes}));
  assert(changed);
 }});
 const result=await verifyResearchSessionCommit({session,researchCommit,searches:[handle]});
 assert.deepEqual(result.searches[0].preference_indexes,[0]);
 assert.equal(result.searches[0].sources[0].url,'https://example.org/review');
});

test('normal provider methods retain their receiver and are snapshotted before later method replacement',async()=>{
 let session,handle;
 const {researchCommit}=await verificationScenario({onReady:async s=>{
  const provider={id:'synthetic-stateful-search',client:{search:async query=>({request_id:query,sources:[]})},
   async search(query){return this.client.search(query);}};
  session=await openResearchSession({...s.args,request:await sessionRequest(s),searchProvider:provider});
  provider.search=()=>{throw Error('Replacement method must not be called');};
  ({handle}=await observeResearchSessionSearch({session,query:'stateful public query',preferenceIndexes:[]}));
 }});
 const result=await verifyResearchSessionCommit({session,researchCommit,searches:[handle]});
 assert.equal(result.searches[0].provider_request_id,'stateful public query');
});

test('research advancing during final head checks blocks opening, private delivery and search invocation',async()=>{
 for(const operation of ['open','response','search']){
  const s=await activeScenario();await reconcile(s.args);const request=await sessionRequest(s);let searches=0,session;
  const options={...s.args,request,searchProvider:{id:'synthetic-search',search:async()=>{searches++;return {request_id:null,sources:[]};}}};
  if(operation!=='open')session=await openResearchSession(options);
  const pin=s.publicApis.thriller.pinMain;
  // Detect the first explicit dated-ref read, then advance during the following
  // head check; avoid depending on the consumer's internal read count.
  let checkedBranch=false;const optional=s.publicApis.scifi.optional;
  s.publicApis.scifi.optional=async route=>{const result=await optional(route);if(route==='/git/ref/heads/research/2026-10-12-scifi')checkedBranch=true;return result;};
  s.publicApis.thriller.pinMain=async()=>{const result=await pin();if(checkedBranch)s.publicRepos.scifi.branch('research/2026-10-12-scifi',{'research-inbox/2026-10-12.json':'{}'});return result;};
  if(operation==='open')await assert.rejects(openResearchSession(options),/research_already_staged/);
  if(operation==='response')await assert.rejects(privateResearchSessionResponse(session),/research_already_staged/);
  if(operation==='search')await assert.rejects(observeResearchSessionSearch({session,query:'a public query',preferenceIndexes:[]}),/research_already_staged/);
  assert.equal(searches,0);
 }
});

test('packet ref replacement during final head checks invalidates session commit verification',async()=>{
 let session;
 const {s,researchCommit}=await verificationScenario({onReady:async s=>{session=await openResearchSession({...s.args,request:await sessionRequest(s)});}});
 const pin=s.publicApis.thriller.pinMain,get=s.publicApis.scifi.get;let packetReads=0;
 s.publicApis.scifi.get=async route=>{const result=await get(route);if(route==='/git/ref/heads/research/2026-10-12-scifi')packetReads++;return result;};
 s.publicApis.thriller.pinMain=async()=>{const result=await pin();if(packetReads>=2)s.publicRepos.scifi.branch('research/2026-10-12-scifi',{'research-inbox/2026-10-12.json':'{}'});return result;};
 await assert.rejects(verifyResearchSessionCommit({session,researchCommit}),/stale_input/);
});

async function journalScenario({persistContext=true,persistSearch=true,onSearch=async()=>{},providerResponse=null}={}){
 let session,handle,contextRecord,searchRecord,searchCalls=0;
 const result=await verificationScenario({onReady:async s=>{
  session=await openResearchSession({...s.args,request:await sessionRequest(s),searchProvider:{id:'synthetic-journal-search',search:async()=>{
   searchCalls++;return providerResponse??{request_id:'synthetic-query-id',sources:[{url:'https://example.org/review',title:'A public review'}]};
  }}});
  if(persistContext)contextRecord=await persistResearchSessionContext({api:s.privateRepo.api,session,proof:s.args.proof});
  ({handle}=await observeResearchSessionSearch({session,query:'PRIVATE_SEARCH_QUERY science mystery reviews',preferenceIndexes:[0]}));
  await onSearch({s,session,handle});
  if(persistSearch)searchRecord=await persistResearchSessionSearch({api:s.privateRepo.api,session,handle,proof:s.args.proof});
 }});
 return {...result,session,handle,contextRecord,searchRecord,searchCalls};
}

test('signed private session journal survives process-local handle loss and binds observations to the actual packet',async()=>{
 const {s,researchCommit,contextRecord,searchRecord,searchCalls}=await journalScenario();
 const before=stableJson(s.privateRepo.filesAt(s.args.trustedRevision)),result=await reconcile(s.args),{body}=recordedObservation(s,result);
 assert.equal(body.schema_version,2);assert.equal(body.trace.research_commit,researchCommit);
 const journal=body.session_journal;assert.equal(journal.context_commit,contextRecord.commit);
 assert.equal(journal.search_adapter_invocations_observed,1);assert.equal(journal.searches[0].commit,searchRecord.commit);
 assert.equal(journal.searches[0].observation.provider_request_id,'synthetic-query-id');assert.equal(searchCalls,1);
 assert.equal(journal.brief_delivery_verified,false);assert.equal(journal.actual_context_use_verified,false);assert.equal(journal.behavioral_effect_observed,false);
 assert.equal(body.current_evidence,false);assert.equal(body.actual_context_use_verified,false);assert.equal(body.behavioral_effect_observed,false);
 assert(!JSON.stringify(result).includes('PRIVATE_SEARCH_QUERY'));assert(!JSON.stringify(result).includes('PRIVATE_SENTINEL'));
 assert.equal(stableJson(s.privateRepo.filesAt(s.args.trustedRevision)),before);
 assert.equal(s.publicRepos.scifi.writes.length,0);
 const writes=s.privateRepo.writes.length;await reconcile(s.args);assert.equal(s.privateRepo.writes.length,writes);
});

test('unchanged journal retries reuse signed bytes and never repeat the observed search',async()=>{
 let originalContext,originalSearch;
 const {s,contextRecord,searchRecord,searchCalls}=await journalScenario({onSearch:async({s,session,handle})=>{
  originalContext=await persistResearchSessionContext({api:s.privateRepo.api,session,proof:s.args.proof});
  originalSearch=await persistResearchSessionSearch({api:s.privateRepo.api,session,handle,proof:s.args.proof});
  const writes=s.privateRepo.writes.length;
  const again=await persistResearchSessionSearch({api:s.privateRepo.api,session,handle,proof:s.args.proof});
  assert.equal(again.commit,originalSearch.commit);assert.equal(s.privateRepo.writes.length,writes);
 }});
 assert.equal(originalContext.commit,contextRecord.commit);assert.equal(originalSearch.commit,searchRecord.commit);assert.equal(searchCalls,1);
 assert.equal([...s.privateRepo.refs.keys()].filter(r=>r.includes('/learning/session-')).length,1);
 assert.equal([...s.privateRepo.refs.keys()].filter(r=>r.includes('/learning/search-')).length,1);
});

test('interrupted journal ref creation resumes with the same observation and retains prior context',async()=>{
 const {s,searchCalls}=await journalScenario({persistSearch:false,onSearch:async({s,session,handle})=>{
  const post=s.privateRepo.api.post;let interrupted=false;
  s.privateRepo.api.post=async(route,body)=>{
   if(route==='/git/refs'&&body.ref.startsWith('refs/heads/learning/search-')&&!interrupted){interrupted=true;const error=Error('synthetic interruption');error.status=503;throw error;}
   return post(route,body);
  };
  const context=[...s.privateRepo.refs].find(([name])=>name.includes('/learning/session-'));
  await assert.rejects(persistResearchSessionSearch({api:s.privateRepo.api,session,handle,proof:s.args.proof}),/synthetic interruption/);
  assert.equal(s.privateRepo.refs.get(context[0]).object.sha,context[1].object.sha);
  s.privateRepo.api.post=post;
  await persistResearchSessionSearch({api:s.privateRepo.api,session,handle,proof:s.args.proof});
 }});
 const result=await reconcile(s.args),{body}=recordedObservation(s,result);
 assert.equal(body.session_journal.search_adapter_invocations_observed,1);assert.equal(searchCalls,1);
});

test('journal writers cannot synthesize context, use copied handles, or append observations after packet staging',async()=>{
 const {s,session,handle}=await journalScenario({persistContext:false,persistSearch:false,onSearch:async({s,session,handle})=>{
  const writes=s.privateRepo.writes.length;
  await assert.rejects(persistResearchSessionSearch({api:s.privateRepo.api,session,handle,proof:s.args.proof}),/session_context_not_persisted/);
  await assert.rejects(persistResearchSessionContext({api:s.privateRepo.api,session:structuredClone(session),proof:s.args.proof}),/unauthenticated_research_session/);
  await assert.rejects(persistResearchSessionSearch({api:s.privateRepo.api,session,handle:structuredClone(handle),proof:s.args.proof}),/unauthenticated_research_search/);
  assert.equal(s.privateRepo.writes.length,writes);
 }});
 const writes=s.privateRepo.writes.length;
 await assert.rejects(persistResearchSessionContext({api:s.privateRepo.api,session,proof:s.args.proof}),/research_already_staged/);
 await assert.rejects(persistResearchSessionSearch({api:s.privateRepo.api,session,handle,proof:s.args.proof}),/research_already_staged/);
 assert.equal(s.privateRepo.writes.length,writes);
 const {body}=recordedObservation(s,await reconcile(s.args));assert.equal(body.schema_version,1);assert(!Object.hasOwn(body,'session_journal'));
});

test('prepared context with no observed search never becomes claimed delivery, context use or learning effect',async()=>{
 const {s}=await journalScenario({persistSearch:false});
 const {body}=recordedObservation(s,await reconcile(s.args)),journal=body.session_journal;
 assert.equal(journal.context_prepared_verified,true);assert.equal(journal.search_adapter_invocations_observed,0);
 assert.equal(journal.brief_delivery_verified,false);assert.equal(journal.actual_context_use_verified,false);assert.equal(journal.behavioral_effect_observed,false);
});

test('forged or altered private journal artifacts remain unresolved with a closed failure',async()=>{
 for(const alter of ['query','proof','extra_field','raw_path']){
  const {s,searchRecord}=await journalScenario(),files=s.privateRepo.filesAt(searchRecord.commit),record=JSON.parse(files['learning-output/search.json']);
  if(alter==='query')record.body.observation.query='forged query';
  if(alter==='proof')record.proof='self-declared-proof';
  if(alter==='extra_field')record.body.observation.weight=999;
  s.privateRepo.branch(searchRecord.branch,{'learning-output/search.json':stableJson(record),...(alter==='raw_path'?{'data/feedback/2026-10-12/forged.json':'{}'}:{})});
  await assert.rejects(reconcile(s.args),/invalid_research_observation/);
  assert([...s.privateRepo.refs.keys()].some(r=>r.includes('/learning/failure-')));
  assert(![...s.privateRepo.refs.keys()].some(r=>/^refs\/heads\/learning\/observation-[a-f0-9]{64}$/.test(r)));
  assert.equal(s.publicRepos.scifi.writes.length,0);
 }
});

test('unavailable journal signing key stays pending and resumes without deleting or renewing its original artifacts',async()=>{
 const {s,searchRecord}=await journalScenario(),proof=s.args.proof;
 s.args.proof={...proof,verify:async(token,body,revision)=>{
  if(body.kind==='private_research_search_record'){const error=Error('proof_key_unavailable');error.code='proof_key_unavailable';throw error;}
  return proof.verify(token,body,revision);
 }};
 const pending=await reconcile(s.args);assert(pending.observations.observations.some(o=>o.state==='session_verification_pending'));
 assert.equal(s.privateRepo.refs.get('refs/heads/'+searchRecord.branch).object.sha,searchRecord.commit);
 assert(![...s.privateRepo.refs.keys()].some(r=>/^refs\/heads\/learning\/observation-[a-f0-9]{64}$/.test(r)));
 s.args.proof=proof;
 const {body}=recordedObservation(s,await reconcile(s.args));assert.equal(body.session_journal.searches[0].commit,searchRecord.commit);
});

test('historical journal recovery after publication and retraction never supplies stale current context',async()=>{
 const {s,session,searchRecord}=await journalScenario();
 s.publicRepos.scifi.branch('main',{'config/research.json':'{"after_publication":true}'});
 const head=s.privateRepo.branch('main',{'data/feedback/2026-10-02/later-tombstone.json':stableJson({schema_version:3,feedback_id:'later-tombstone',supersedes:s.event.feedback_id,imdb_id:s.event.imdb_id,source_id:null,rated_at:'2026-10-02T12:00:00Z',profile_context:null,status:'retracted',rating:null,premise_interest:null,liked:[],disliked:[],feedback:''})});
 s.args={...s.args,trustedRevision:head};
 const result=await reconcile(s.args),{body}=recordedObservation(s,result);
 assert.equal(body.session_journal.searches[0].commit,searchRecord.commit);
 assert.equal(body.current_evidence,false);assert.equal(body.actual_context_use_verified,false);
 await assert.rejects(privateResearchSessionResponse(session));
});

test('session ref listing rejects malformed, duplicate, excessive and cross-session entries instead of truncating them',async()=>{
 const session_id='a'.repeat(64),ref={ref:`refs/heads/learning/search-${session_id}-${'b'.repeat(64)}`,object:{sha:'c'.repeat(40)}};
 for(const refs of [null,[null],[ref,ref],Array.from({length:101},()=>ref),[{...ref,ref:'refs/heads/learning/search-other'}], [{...ref,object:{sha:'invalid'}}]]){
  await assert.rejects(loadSessionSearchRefs({get:async()=>refs},session_id),/invalid_session_journal/);
 }
});

test('late-visible journal refs reopen a sealed completed observation while preserving its immutable first result',async()=>{
 const {s,searchRecord,searchCalls}=await journalScenario(),get=s.privateRepo.api.get,optional=s.privateRepo.api.optional;
 s.privateRepo.api.get=async route=>/^\/git\/matching-refs\/heads\/learning\/(?:session|search)-/.test(route)?[]:get(route);
 s.privateRepo.api.optional=async route=>route.startsWith('/git/ref/heads/learning/session-')?null:optional(route);
 const first=recordedObservation(s,await reconcile(s.args));assert.equal(first.body.schema_version,1);
 const original=stableJson(first.body);
 s.privateRepo.api.get=get;s.privateRepo.api.optional=optional;
 const recovered=recordedObservation(s,await reconcile(s.args));assert.equal(recovered.body.schema_version,2);
 assert.notEqual(recovered.recorded.branch,first.recorded.branch);
 assert.equal(recovered.body.session_journal.searches[0].commit,searchRecord.commit);assert.equal(searchCalls,1);
 assert.equal(s.privateRepo.refs.get('refs/heads/'+first.recorded.branch).object.sha,first.recorded.commit);
 assert.equal(stableJson(JSON.parse(s.privateRepo.filesAt(first.recorded.commit)['learning-output/observation.json'])),original);
 const writes=s.privateRepo.writes.length;await reconcile(s.args);assert.equal(s.privateRepo.writes.length,writes);
});

test('version-one sealed indices migrate to journal-aware entries without changing any old ref or observation',async()=>{
 const {s}=await verificationScenario();await reconcile(s.args);
 const base=await s.privateRepo.api.pinMain(),options={api:s.privateRepo.api,base,proof:s.args.proof,assertCurrent:async()=>{},period:'2026-10'};
 const before=await loadObservationIndex(options),legacy={...before.index,schema_version:1,sequence:before.largest_sequence+1,
  completed:before.index.completed.map(({session_id,journal_heads_hash,...entry})=>entry)};
 const branch=`learning/observation-index-2026-10-${String(legacy.sequence).padStart(10,'0')}-${digest(stableJson(legacy))}`;
 const stored=await persistSealedState({...options,branch,name:'index.json',body:legacy});
 const historical=stableJson(s.privateRepo.filesAt(stored.commit));
 await reconcile(s.args);
 const after=await loadObservationIndex(options);assert.equal(after.index.schema_version,2);
 assert(after.index.sequence>legacy.sequence);assert(after.index.completed[0].session_id);assert(after.index.completed[0].journal_heads_hash);
 assert.equal(s.privateRepo.refs.get('refs/heads/'+branch).object.sha,stored.commit);
 assert.equal(stableJson(s.privateRepo.filesAt(stored.commit)),historical);
});

test('journal writer enforces the reader byte limit before any Git writes, including multibyte provider data',async()=>{
 const response={request_id:null,sources:Array.from({length:100},()=>({url:'https://example.org/'+'😀'.repeat(4000),title:'😀'.repeat(1024)}))};
 const {s}=await journalScenario({persistSearch:false,providerResponse:response,onSearch:async({s,session,handle})=>{
  const writes=s.privateRepo.writes.length;
  await assert.rejects(persistResearchSessionSearch({api:s.privateRepo.api,session,handle,proof:s.args.proof}),/session_journal_limit/);
  assert.equal(s.privateRepo.writes.length,writes);
 }});
 assert.equal([...s.privateRepo.refs.keys()].filter(r=>r.includes('/learning/search-')).length,0);
});

test('concurrent journal writers reuse one authenticated context and search despite different proof nonces',async()=>{
 const {s,searchCalls}=await journalScenario({persistContext:false,persistSearch:false,onSearch:async({s,session,handle})=>{
  const proof=nonce=>({...s.args.proof,sign:(body,revision)=>s.args.proof.sign(body,revision,{jti:nonce})});
  const contexts=await Promise.all(['first','second'].map(nonce=>persistResearchSessionContext({api:s.privateRepo.api,session,proof:proof(nonce)})));
  assert.equal(contexts[0].commit,contexts[1].commit);
  const searches=await Promise.all(['first','second'].map(nonce=>persistResearchSessionSearch({api:s.privateRepo.api,session,handle,proof:proof(nonce)})));
  assert.equal(searches[0].commit,searches[1].commit);
 }});
 const {body}=recordedObservation(s,await reconcile(s.args));assert.equal(body.session_journal.search_adapter_invocations_observed,1);
 assert.equal([...s.privateRepo.refs.keys()].filter(r=>r.includes('/learning/session-')).length,1);
 assert.equal([...s.privateRepo.refs.keys()].filter(r=>r.includes('/learning/search-')).length,1);assert.equal(searchCalls,1);
});

test('distinct identical searches with no provider request ID retain separate durable invocations',async()=>{
 let calls=0;
 const {s}=await verificationScenario({onReady:async s=>{
  const session=await openResearchSession({...s.args,request:await sessionRequest(s),searchProvider:{id:'synthetic-search',search:async()=>{calls++;return {request_id:null,sources:[]};}}});
  await persistResearchSessionContext({api:s.privateRepo.api,session,proof:s.args.proof});
  const first=await observeResearchSessionSearch({session,query:'identical public query',preferenceIndexes:[]});
  const second=await observeResearchSessionSearch({session,query:'identical public query',preferenceIndexes:[]});
  assert.notEqual(first.handle.search_id,second.handle.search_id);
  for(const handle of [first.handle,second.handle,first.handle])await persistResearchSessionSearch({api:s.privateRepo.api,session,handle,proof:s.args.proof});
 }});
 const {body}=recordedObservation(s,await reconcile(s.args));assert.equal(body.session_journal.search_adapter_invocations_observed,2);
 const ids=body.session_journal.searches.map(s=>s.observation.invocation_id);assert.equal(new Set(ids).size,2);assert.equal(calls,2);
});

test('concurrent distinct searches cannot exceed the last journal slot and unchanged retries still work at capacity',async()=>{
 const s=await activeScenario();await reconcile(s.args);
 const session=await openResearchSession({...s.args,request:await sessionRequest(s),searchProvider:{id:'synthetic-search',search:async()=>({request_id:null,sources:[]})}});
 await persistResearchSessionContext({api:s.privateRepo.api,session,proof:s.args.proof});
 let first;
 for(let index=0;index<99;index++){
  const {handle}=await observeResearchSessionSearch({session,query:'public capacity fixture',preferenceIndexes:[]});first??=handle;
  await persistResearchSessionSearch({api:s.privateRepo.api,session,handle,proof:s.args.proof});
 }
 const last=await observeResearchSessionSearch({session,query:'public capacity fixture',preferenceIndexes:[]});
 const extra=await observeResearchSessionSearch({session,query:'public capacity fixture',preferenceIndexes:[]});
 const result=await Promise.allSettled([last.handle,extra.handle].map(handle=>persistResearchSessionSearch({api:s.privateRepo.api,session,handle,proof:s.args.proof})));
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(result.find(r=>r.status==='rejected').reason.code,'session_journal_limit');
 assert.equal((await loadSessionSearchRefs(s.privateRepo.api,session.session_id)).length,100);
 const writes=s.privateRepo.writes.length;await persistResearchSessionSearch({api:s.privateRepo.api,session,handle:first,proof:s.args.proof});
 assert.equal(s.privateRepo.writes.length,writes);
});

test('bounded worker defaults held before metadata, signing, persistence or public queries',async()=>{
 let touched=0;const call=taskCall('open',{schema_version:1,genre:'scifi',research_date:'2026-10-12',private_revision:'a'.repeat(40),public_revision:'b'.repeat(40)});
 await assert.rejects(executeResearchWorker({call,api:{get:async()=>{touched++;}}}),/private_task_access_held/);assert.equal(touched,0);
});

async function workerRead(s,call){
 return readWorkerRecord({...s.args,base:await s.privateRepo.api.pinMain(),kind:'result',branch:`learning/task-result-${workerRequestHash(call)}`});
}

test('bounded worker persists a stable external ticket and reuses complete results across job restarts',async()=>{
 const s=await activeScenario();await reconcile(s.args);const call=taskCall('open',await sessionRequest(s));
 const options={...s.args,call,taskAccessAllowed:async()=>true};
 const first=await executeResearchWorker(options),record=await workerRead(s,call),context=record.body.result;
 assert.equal(record.commit,first.commit);assert.equal(context.kind,'private_task_context');
 assert(context.response.context.preferences.length);assert.equal(context.actual_context_use_verified,false);
 const writes=s.privateRepo.writes.length,second=await executeResearchWorker(options);
 assert.equal(second.commit,first.commit);assert.equal(second.reused,true);assert.equal(s.privateRepo.writes.length,writes);
 const contextCall=taskCall('context',{task_token:context.task_token});
 await executeResearchWorker({...options,call:contextCall});
 assert.equal((await workerRead(s,contextCall)).body.result.task_token,context.task_token);
 for(const repo of Object.values(s.publicRepos))assert.equal(repo.writes.length,0);
});

test('keyless provider is wired through the trusted worker, signed intent and recovered search result',async()=>{
 const s=await activeScenario();await reconcile(s.args);const open=taskCall('open',await sessionRequest(s));let calls=0;
 const options={...s.args,taskAccessAllowed:async()=>true,searchProvider:createPublicSearchProvider({fetcher:async(url)=>{
  calls++;assert.equal(new URL(url).hostname,'en.wikipedia.org');assert.equal(new URL(url).searchParams.get('srsearch'),'science mystery public reviews');
  return new Response(JSON.stringify({batchcomplete:true,query:{search:[{pageid:1,ns:0,title:'Synthetic review'}]}}),{headers:{'content-type':'application/json'}});
 }})};
 await executeResearchWorker({...options,call:open});const context=(await workerRead(s,open)).body.result,call=taskSearch(context);
 await executeResearchWorker({...options,call});const result=(await workerRead(s,call)).body.result;
 assert.equal(result.sources[0].url,'https://en.wikipedia.org/?curid=1');assert.equal(calls,1);
 const writes=s.privateRepo.writes.length;await executeResearchWorker({...options,call});
 assert.equal(calls,1);assert.equal(s.privateRepo.writes.length,writes);
 const changed=taskSearch(context,'search-1','changed query');await assert.rejects(executeResearchWorker({...options,call:changed}),/task_request_conflict/);
 assert.equal(calls,1);
});

test('worker recovery after result persistence failure never repeats an already observed search',async()=>{
 const s=await activeScenario();await reconcile(s.args);let calls=0;
 const options={...s.args,taskAccessAllowed:async()=>true,searchProvider:{id:'synthetic-keyless',async search(){calls++;return {request_id:null,sources:[]};}}};
 const open=taskCall('open',await sessionRequest(s));await executeResearchWorker({...options,call:open});
 const context=(await workerRead(s,open)).body.result,call=taskSearch(context),post=s.privateRepo.api.post;let failed=false;
 s.privateRepo.api.post=async(route,body)=>{
  if(route==='/git/refs'&&body.ref===`refs/heads/learning/task-result-${workerRequestHash(call)}`&&!failed){failed=true;throw Object.assign(Error('synthetic outage'),{code:'transport_failure'});}
  return post(route,body);
 };
 await assert.rejects(executeResearchWorker({...options,call}),/synthetic outage/);assert.equal(calls,1);
 await executeResearchWorker({...options,call});assert.equal(calls,1);assert(await workerRead(s,call));
});

test('interrupted provider outcomes stay pending under the original identity after a worker replacement',async()=>{
 const s=await activeScenario();await reconcile(s.args);let calls=0;
 const options={...s.args,taskAccessAllowed:async()=>true,searchProvider:{id:'synthetic-keyless',async search(){calls++;throw Error('PRIVATE_SENTINEL');}}};
 const open=taskCall('open',await sessionRequest(s));await executeResearchWorker({...options,call:open});
 const context=(await workerRead(s,open)).body.result,call=taskSearch(context);
 await assert.rejects(executeResearchWorker({...options,call}),/research_search_failed/);
 for(const candidate of [call,taskSearch(context,'alternate-request')])await assert.rejects(executeResearchWorker({...options,call:candidate}),/task_search_unresolved/);
 assert.equal(calls,1);assert.equal(await workerRead(s,call),null);
});

test('a worker cannot release cached context after a hold, source change, date rollover or public staging',async()=>{
 for(const change of ['hold','private','anime','date','staged']){
  const s=await activeScenario();await reconcile(s.args);let access=true;let now=s.args.clock();
  const options={...s.args,clock:()=>now,taskAccessAllowed:async()=>access},call=taskCall('open',await sessionRequest(s));
  await executeResearchWorker({...options,call});const writes=s.privateRepo.writes.length;
  if(change==='hold')access=false;
  if(change==='private')s.privateRepo.branch('main',{'data/feedback/new.json':'{}'});
  if(change==='anime')s.publicRepos.anime.branch('main',{'config/research.json':'{"changed":true}'});
  if(change==='date')now=new Date('2026-10-12T22:00:00Z');
  if(change==='staged')s.publicRepos.scifi.branch('research/2026-10-12-scifi',{'research-inbox/2026-10-12.json':'{}'});
  await assert.rejects(executeResearchWorker({...options,call}));assert.equal(s.privateRepo.writes.length,writes);
 }
});

test('a later bounded worker verifies a staged packet only through original signed pre-packet state',async()=>{
 let open,context;
 const {s,researchCommit}=await verificationScenario({onReady:async s=>{
  open=taskCall('open',await sessionRequest(s));await executeResearchWorker({...s.args,taskAccessAllowed:async()=>true,call:open});
  context=(await workerRead(s,open)).body.result;
 }});
 const call=taskCall('verify',{task_token:context.task_token,research_commit:researchCommit});
 await executeResearchWorker({...s.args,taskAccessAllowed:async()=>true,call});
 const result=(await workerRead(s,call)).body.result;
 assert.equal(result.research_commit,researchCommit);assert.equal(result.search_adapter_invocations_observed,0);
 assert.equal(result.actual_context_use_verified,false);assert.equal(result.behavioral_effect_observed,false);
 const session=await recoverResearchSessionForVerification({...s.args,request:open.request,researchCommit});
 assert.deepEqual(await restoreResearchSessionSearches(session),[]);
 await assert.rejects(observeResearchSessionSearch({session,query:'new search',preferenceIndexes:[]}),/research_already_staged/);
 await assert.rejects(verifyResearchSessionCommit({session,researchCommit:'f'.repeat(40)}),/stale_input/);
});

test('verification recovery refuses absent pre-packet context rather than minting it after staging',async()=>{
 const {s,researchCommit}=await verificationScenario();const request=await sessionRequest(s),writes=s.privateRepo.writes.length;
 await assert.rejects(recoverResearchSessionForVerification({...s.args,request,researchCommit}),/session_context_not_persisted/);
 assert.equal(s.privateRepo.writes.length,writes);
});

async function brokerScenario({provider=null}={}){
 const s=await activeScenario();await reconcile(s.args);
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'wtf-broker-integration-'));
 const store=()=>createBrokerRequestStore({directory,privateDirectoryVerified:true});
 const readOnly={...s.args.api,writable:false,post:async()=>{throw Error('PC may not write Git objects');}};
 let dispatches=0,allowed=true;
 const options={...s.args,api:readOnly,store:store(),taskAccessAllowed:async()=>allowed,
  dispatchWorker:async call=>{dispatches++;await executeResearchWorker({...s.args,taskAccessAllowed:async()=>true,searchProvider:provider,call});}};
 return {s,directory,options,store,dispatches:()=>dispatches,setAccess:v=>{allowed=v;},close(){
  assert(path.isAbsolute(directory)&&path.basename(directory).startsWith('wtf-broker-integration-'));fs.rmSync(directory,{recursive:true,force:true});
 }};
}

test('actual MCP broker reports pending honestly, then authenticates worker results without a PC Git writer',async()=>{
 let searches=0;const fixture=await brokerScenario({provider:{id:'synthetic-keyless',async search(){searches++;return {request_id:null,sources:[]};}}});
 const {s,options}=fixture,broker=createResearchBrokerAdapter(options),token='x'.repeat(43);
 const host=await startLocalResearchMcpHost({bearerToken:token,adapter:broker}),client=new Client({name:'synthetic-broker-client',version:'1'});
 try{
  await client.connect(new StreamableHTTPClientTransport(new URL(host.url),{requestInit:{headers:{Authorization:'Bearer '+token}}}));
  const tools=(await client.listTools()).tools;
  assert.equal(tools.find(t=>t.name==='private_research_health').annotations.readOnlyHint,true);
  for(const t of tools.filter(t=>t.name!=='private_research_health'))assert.equal(t.annotations.readOnlyHint,false);
  const request=await sessionRequest(s),first=await client.callTool({name:'private_research_open',arguments:request});
  assert.equal(first.isError,true);assert.equal(first.structuredContent.error,'private_task_pending');
  const context=(await client.callTool({name:'private_research_open',arguments:request})).structuredContent;
  assert.equal(context.kind,'private_task_context');assert(!JSON.stringify(context).includes('PRIVATE_SENTINEL'));
  const search=taskSearch(context),pending=await client.callTool({name:'private_research_search',arguments:search.request});
  assert.equal(pending.structuredContent.error,'private_task_pending');
  const result=(await client.callTool({name:'private_research_search',arguments:search.request})).structuredContent;
  assert.equal(result.kind,'private_task_search_result');assert.equal(searches,1);
  assert.equal(result.actual_context_use_verified,false);assert.equal(fixture.dispatches(),2);
  assert.deepEqual(await options.store.pending(),[]);
  for(const repo of Object.values(s.publicRepos))assert.equal(repo.writes.length,0);
 }finally{await client.close();await host.close();fixture.close();}
});

test('PC restart recovers the stable task ticket and persisted dispatch instead of opening a new search',async()=>{
 let searches=0;const f=await brokerScenario({provider:{id:'synthetic-keyless',async search(){searches++;return {request_id:null,sources:[]};}}});
 try{
  const open=taskCall('open',await sessionRequest(f.s)),first=createResearchBrokerAdapter(f.options);
  await assert.rejects(first.dispatch(open),/private_task_pending/);const context=await first.dispatch(open),call=taskSearch(context);
  await assert.rejects(first.dispatch(call),/private_task_pending/);
  const replacement=createResearchBrokerAdapter({...f.options,store:f.store()});
  const recovered=await replacement.dispatch(call);assert.equal(recovered.kind,'private_task_search_result');
  assert.equal(searches,1);assert.equal(f.dispatches(),2);
  await assert.rejects(replacement.dispatch(taskSearch(context,'search-1','changed query')),/task_request_conflict/);
  f.setAccess(false);await assert.rejects(replacement.dispatch(call),/private_task_access_held/);assert.equal(searches,1);
 }finally{f.close();}
});

test('uncertain dispatch is recovered from signed results without a second dispatch',async()=>{
 const f=await brokerScenario();try{
  const open=taskCall('open',await sessionRequest(f.s));let dispatches=0;
  const broker=createResearchBrokerAdapter({...f.options,dispatchWorker:async call=>{
   dispatches++;await f.options.dispatchWorker(call);throw Object.assign(Error('PRIVATE_SENTINEL'),{code:'private_task_pending'});
  }});
  await assert.rejects(broker.dispatch(open),error=>error.code==='private_task_pending'&&!String(error).includes('PRIVATE_SENTINEL'));
  assert.equal((await broker.dispatch(open)).kind,'private_task_context');assert.equal(dispatches,1);
 }finally{f.close();}
});

test('reconciliation rotates bounded batches and retains incomplete requests after automatic dispatch limits',async()=>{
 const f=await brokerScenario();try{
  const base=await sessionRequest(f.s),calls=[];
  for(const genre of GENRES){
   const call=taskCall('open',{...base,genre,public_revision:(await f.s.publicApis[genre].pinMain()).sha});calls.push(call);await f.options.store.reserve(call);
  }
  const broker=createResearchBrokerAdapter(f.options);
  for(let i=0;i<12;i++)await broker.reconcilePending({limit:2});
  assert.equal(f.dispatches(),6);assert.deepEqual(await f.options.store.pending(),[]);
  for(const call of calls)assert(await workerRead(f.s,call));
 }finally{f.close();}
});

test('worker records reject forged context bodies, wrong proof binding and additional Git changes',async()=>{
 for(const mode of ['proof','extra-change']){
  const s=await activeScenario();await reconcile(s.args);const call=taskCall('open',await sessionRequest(s)),options={...s.args,call,taskAccessAllowed:async()=>true};
  await executeResearchWorker(options);const record=await workerRead(s,call),branch=record.branch;
  if(mode==='proof'){
   const value=structuredClone(record.record);value.body.result.actual_context_use_verified=true;
   s.privateRepo.branch(branch,{'learning-output/task-result.json':stableJson(value)});
  }else{
   s.privateRepo.branch(branch,{'learning-output/task-result.json':stableJson(record.record),'learning/evil.mjs':'throw Error("UNTRUSTED")'});
  }
  await assert.rejects(executeResearchWorker(options));
 }
});

test('bounded worker cannot turn task payloads into code, signing policy or arbitrary output paths',async()=>{
 const s=await activeScenario();await reconcile(s.args);const call=taskCall('open',await sessionRequest(s)),writes=s.privateRepo.writes.length;
 for(const change of [{...call,script:'PRIVATE_SENTINEL'}, {...call,proof:{sign:'PRIVATE_SENTINEL'}},
  {...call,request:{...call.request,branch:'main'}}, {...call,operation:'sign'}, {...call,request:{...call.request,output:'data/taste-profile.json'}}]){
  await assert.rejects(executeResearchWorker({...s.args,call:change,taskAccessAllowed:async()=>true}),/invalid_task_call/);
 }
 assert.equal(s.privateRepo.writes.length,writes);
});

test('verification after a worker restart cannot drop an unresolved pre-search intent',async()=>{
 let context,calls=0;
 const {s,researchCommit}=await verificationScenario({onReady:async s=>{
  const options={...s.args,taskAccessAllowed:async()=>true},open=taskCall('open',await sessionRequest(s));
  await executeResearchWorker({...options,call:open});context=(await workerRead(s,open)).body.result;
  await assert.rejects(executeResearchWorker({...options,call:taskSearch(context),searchProvider:{id:'synthetic-public',async search(){calls++;throw Error('unknown outcome');}}}),/research_search_failed/);
 }});
 const writes=s.privateRepo.writes.length;
 await assert.rejects(executeResearchWorker({...s.args,taskAccessAllowed:async()=>true,call:taskCall('verify',{task_token:context.task_token,research_commit:researchCommit})}),/task_search_unresolved/);
 assert.equal(calls,1);assert.equal(s.privateRepo.writes.length,writes);
});

test('post-staging worker recovery authenticates complete signed search and intent without repeating the provider',async()=>{
 let context,calls=0;
 const {s,researchCommit}=await verificationScenario({onReady:async s=>{
  const options={...s.args,taskAccessAllowed:async()=>true},open=taskCall('open',await sessionRequest(s));
  await executeResearchWorker({...options,call:open});context=(await workerRead(s,open)).body.result;
  await executeResearchWorker({...options,call:taskSearch(context),searchProvider:{id:'synthetic-public',async search(){calls++;return {request_id:null,sources:[{url:'https://example.org/review',title:'Synthetic source'}]};}}});
 }});
 const call=taskCall('verify',{task_token:context.task_token,research_commit:researchCommit});
 await executeResearchWorker({...s.args,taskAccessAllowed:async()=>true,call});
 assert.equal((await workerRead(s,call)).body.result.search_adapter_invocations_observed,1);assert.equal(calls,1);
});

test('a half-finished open retains its original ticket rather than allocating a replacement token',async()=>{
 const s=await activeScenario();await reconcile(s.args);const call=taskCall('open',await sessionRequest(s)),post=s.privateRepo.api.post;
 let interrupted=false;
 s.privateRepo.api.post=async(route,body)=>{
  if(route==='/git/refs'&&body.ref===`refs/heads/learning/task-result-${workerRequestHash(call)}`&&!interrupted){interrupted=true;throw Object.assign(Error('interrupted result'),{code:'transport_failure'});}
  return post(route,body);
 };
 const options={...s.args,taskAccessAllowed:async()=>true,call};await assert.rejects(executeResearchWorker(options),/interrupted result/);
 const ticket=await readWorkerRecord({...s.args,base:await s.privateRepo.api.pinMain(),kind:'ticket',branch:`learning/task-ticket-${workerRequestHash(call)}`});
 await executeResearchWorker(options);assert.equal((await workerRead(s,call)).body.result.task_token,ticket.body.task_token);
 assert.equal([...s.privateRepo.refs.keys()].filter(r=>r.startsWith('refs/heads/learning/task-token-')).length,1);
});

test('a missing formerly completed result cannot trigger regeneration of frozen evidence',async()=>{
 const f=await brokerScenario();try{
  const broker=createResearchBrokerAdapter(f.options),call=taskCall('open',await sessionRequest(f.s));
  await assert.rejects(broker.dispatch(call),/private_task_pending/);await broker.dispatch(call);
  assert.equal(f.dispatches(),1);
  f.s.privateRepo.refs.delete(`refs/heads/learning/task-result-${workerRequestHash(call)}`);
  await assert.rejects(broker.dispatch(call),/immutable_artifact_mismatch/);assert.equal(f.dispatches(),1);
 }finally{f.close();}
});
