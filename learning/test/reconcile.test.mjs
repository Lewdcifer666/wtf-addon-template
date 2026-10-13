import fs from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {reconcile,loadPublicProfile,engineFingerprintAt} from '../reconcile.mjs';
import {GitHub} from '../github.mjs';
import {digest,gitBlobOid,stableJson,interpretationRequest} from '../interpretation.mjs';
import {inventoryFeedback} from '../inventory.mjs';
import {GENRES} from '../receipt.mjs';
import {fixtureObservationProof} from './fixtures/observation-proof.mjs';
import {buildReceipt} from '../receipt.mjs';
import {loadVerifiedReceipt} from '../receipt-loader.mjs';
import {prepareResearchUse} from '../research-use.mjs';
import {persistImmutable,persistSealedState} from '../git-artifacts.mjs';
import {loadObservationIndex} from '../observation-index.mjs';

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
async function verificationScenario({issueBeforePacket=true}={}){
 const s=await activeScenario(),profile=JSON.parse(fs.readFileSync(new URL('./fixtures/contracts/scifi-profile.json',import.meta.url))),dimensions=profile.dna_dimensions.dimensions.map(d=>d.id);
 const registry=`export const CANONICAL_DIMENSIONS = ${JSON.stringify(dimensions)};\nexport const CANONICAL_DNA_TAGS = ${JSON.stringify(profile.dna_dimensions.tag_registry)};\nexport const SLOW_TO_FAST_DIMENSION = "pace_speed";\n`;
 s.publicRepos.scifi.branch('main',{'data/taste-profile.json':stableJson(profile),'scripts/registry.mjs':registry,
  'schemas/research-packet.schema.json':fs.readFileSync(new URL('../schemas/research-packet.schema.json',import.meta.url),'utf8'),
  'config/research.json':stableJson({schema_version:1,genre:'scifi',run_prefix:'s',timezone:'Europe/Berlin',minimum_sources:1,require_all_known:false})});
 if(issueBeforePacket)await reconcile(s.args);
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
 const probe=workflow.slice(workflow.indexOf('  provenance-probe:'));assert(probe.includes('contents: read'));assert(!probe.includes('contents: write'));assert(probe.includes('id-token: write'));assert(probe.includes('node learning/reconcile.mjs --probe-proof'));
 const cli=fs.readFileSync(new URL('../reconcile.mjs',import.meta.url),'utf8'),body=cli.slice(cli.indexOf('  if(probe){'),cli.indexOf('  const publicApis=',cli.indexOf('  if(probe){')));
 assert(!body.includes('inventoryFeedback'));assert(!body.includes('.post('));assert(body.includes('feedback_read:false,git_writes:false'));
});
