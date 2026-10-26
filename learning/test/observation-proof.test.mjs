import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fixtureObservationProof} from './fixtures/observation-proof.mjs';
import {verifyObservationProof,githubObservationProof} from '../observation-proof.mjs';
import {engineFingerprintAt,recoverEngineFingerprint} from '../reconcile.mjs';
import {selectObservationBatch,emptyObservationIndex} from '../observation-index.mjs';
import {proofAudience} from '../observation-proof.mjs';
const body={schema_version:1,kind:'synthetic_private_index',completed:[]},revision='a'.repeat(40),proof=fixtureObservationProof();

test('only GitHub-signed private main workflow proofs bind the exact immutable body and revision',async()=>{
 const token=await proof.sign(body,revision);assert.equal((await proof.verify(token,body,revision)).sha,revision);
 for(const extra of [{aud:'wrong'},{repository:'Lewdcifer666/wtf-anime-stremio'},{repository_visibility:'public'},{repository_id:'1'},{repository_owner_id:'1'},{ref:'refs/heads/interpretation/fake'},{sha:'b'.repeat(40)},{event_name:'pull_request'},
  {workflow_ref:'Lewdcifer666/wtf-scifi-feedback/.github/workflows/learning-intake.yml@refs/heads/main'}])await assert.rejects(proof.verify(await proof.sign(body,revision,extra),body,revision),/invalid_observation_proof/);
 await assert.rejects(proof.verify(token,{...body,completed:['forged']},revision),/invalid_observation_proof/);
 const parts=token.split('.');parts[1]=Buffer.from(JSON.stringify({forged:true})).toString('base64url');await assert.rejects(proof.verify(parts.join('.'),body,revision),/invalid_observation_proof/);
 const unknown=[{...proof.key,kid:'rotated'}];assert.throws(()=>verifyObservationProof(token,body,revision,unknown),/proof_key_unavailable/);
});

test('expired proof authenticates historical bookkeeping only; it cannot authorize fresh issuance or a taste snapshot refresh',async()=>{
 const token=await proof.sign(body,revision),now=+new Date('2026-10-13T08:00:00Z');
 assert(verifyObservationProof(token,body,revision,[proof.key],{now}));
 assert.throws(()=>verifyObservationProof(token,body,revision,[proof.key],{now,fresh:true}),/invalid_observation_proof/);
 const future=await proof.sign(body,revision,{iat:Math.floor(now/1000)+1000,nbf:Math.floor(now/1000)+1000,exp:Math.floor(now/1000)+1300});
 assert.throws(()=>verifyObservationProof(future,body,revision,[proof.key],{now}),/invalid_observation_proof/);
});

test('production proof provider is lazy, refuses arbitrary endpoints and never accepts a key from stored data',async()=>{
 let calls=0;const provider=githubObservationProof({env:{},fetcher:async()=>{calls++;throw Error('unexpected network');}});
 await assert.rejects(provider.sign(body,revision),/proof_credentials_required/);assert.equal(calls,0);
 const unsafe=githubObservationProof({env:{ACTIONS_ID_TOKEN_REQUEST_URL:'https://evil.invalid/oidc',ACTIONS_ID_TOKEN_REQUEST_TOKEN:'SYNTHETIC_SECRET'},fetcher:async()=>{calls++;throw Error('unexpected network');}});
 await assert.rejects(unsafe.sign(body,revision),/invalid_observation_proof/);assert.equal(calls,0);
});

test('historical fingerprint recovery accepts both documented schemes without rewriting old bytes',()=>{
 const tree={tree:[{path:'learning/reconcile.mjs',type:'blob',sha:'a'.repeat(40)},{path:'engine/dna-score.mjs',type:'blob',sha:'b'.repeat(40)},{path:'engine/identity.mjs',type:'blob',sha:'c'.repeat(40)},{path:'package-lock.json',type:'blob',sha:'d'.repeat(40)}]};
 const legacy=engineFingerprintAt(tree,{legacy:true}),current=engineFingerprintAt(tree);assert.notEqual(legacy,current);
 assert.equal(recoverEngineFingerprint(tree,legacy),legacy);assert.equal(recoverEngineFingerprint(tree,current),current);
 const changed=structuredClone(tree);changed.tree[0].sha='f'.repeat(40);assert.throws(()=>recoverEngineFingerprint(changed,legacy),/invalid_research_observation/);
});

test('bounded pending selection prioritizes new refs, rotates old work, and survives an unavailable signing key without dropping a ref',()=>{
 const refs=Array.from({length:100},(_,i)=>({ref:'synthetic/'+i,object:{sha:i.toString(16).padStart(40,'0')}}));
 const index={...emptyObservationIndex(),known_handoffs:refs.slice(0,99).map(r=>r.object.sha),cursor:refs[50].object.sha};
 const batch=selectObservationBatch(refs,index,{budget:6});assert.equal(batch.length,6);assert.equal(batch[0],refs[99]);assert.equal(batch[1],refs[51]);
 const reached=new Set();for(let hour=0;hour<100;hour++)for(const ref of selectObservationBatch(refs,emptyObservationIndex(),{budget:6,rebuilding:true,clock:()=>new Date(hour*3600000)}))reached.add(ref.object.sha);
 assert.equal(reached.size,refs.length);assert.equal(refs.length,100);
});

test('queued main triggers authenticate separately from the fresh pinned execution revision',async()=>{
 const trigger='b'.repeat(40),token=await proof.sign(body,revision,{sha:trigger}),checked=[];
 const provider=githubObservationProof({clock:()=>new Date('2026-10-12T08:00:00Z'),env:{ACTIONS_ID_TOKEN_REQUEST_URL:'https://pipelines.actions.githubusercontent.com/synthetic',ACTIONS_ID_TOKEN_REQUEST_TOKEN:'SYNTHETIC'},
  fetcher:async url=>({ok:true,text:async()=>JSON.stringify(String(url).includes('/.well-known/jwks')?{keys:[proof.key]}:{value:token})}),
  assertTriggerAncestor:async(event,executed)=>{checked.push([event,executed]);assert.equal(event,trigger);assert.equal(executed,revision);}});
 assert.equal(await provider.sign(body,revision),token);assert.equal((await provider.verify(token,body,revision)).sha,trigger);assert.equal(checked.length,2);
 assert.notEqual(proofAudience(body,revision),proofAudience(body,trigger),'Execution revision must be cryptographically bound to the payload');
 const refusing=fixtureObservationProof({assertTriggerAncestor:async()=>{throw Error('untrusted main ancestry');}});
 await assert.rejects(refusing.verify(token,body,revision),/untrusted main ancestry/);
});

test('proof network and interrupted-body failures are recoverable while HTTP authorization denials stay permanent',async()=>{
 const env={ACTIONS_ID_TOKEN_REQUEST_URL:'https://pipelines.actions.githubusercontent.com/synthetic',ACTIONS_ID_TOKEN_REQUEST_TOKEN:'SYNTHETIC_SECRET'};
 for(const stage of ['fetch','body','denied']){
  let calls=0;const provider=githubObservationProof({env,fetcher:async()=>{
   calls++;if(stage==='fetch')throw TypeError('SYNTHETIC_SECRET network unavailable');
   if(stage==='denied')return {ok:false,status:403};
   return {ok:true,text:async()=>{throw TypeError('SYNTHETIC_SECRET body unavailable');}};
  }});
  await assert.rejects(provider.sign(body,revision),error=>error.code===(stage==='denied'?'proof_credentials_required':'proof_transport_failure')&&!String(error).includes('SYNTHETIC_SECRET'));
  assert.equal(calls,1);
 }
});

test('persistent proof readers share bounded issuer-key fetches and refresh rather than trusting missing rotated keys',async()=>{
 let calls=0,now=new Date('2026-10-12T08:00:00Z');const token=await proof.sign(body,revision);
 const provider=githubObservationProof({clock:()=>now,fetcher:async url=>{
  calls++;assert.equal(url,'https://token.actions.githubusercontent.com/.well-known/jwks');
  await new Promise(r=>setTimeout(r,5));return new Response(JSON.stringify({keys:calls===1?[]:[proof.key]}));
 }});
 await provider.verify(token,body,revision);assert.equal(calls,2);
 await Promise.all([provider.verify(token,body,revision),provider.verify(token,body,revision)]);assert.equal(calls,2);
 now=new Date(+now+6*60*1000);await provider.verify(token,body,revision);assert.equal(calls,3);
 assert.throws(()=>verifyObservationProof(token,body,revision,[proof.key],{now:NaN}),/invalid_observation_proof/);
});

test('issuer-key and OIDC response deadlines cover stalled bodies, invalid UTF-8 and the byte limit',async()=>{
 for(const mode of ['fetch-timeout','body-timeout','oversize','utf8']){
  let calls=0;const provider=githubObservationProof({timeoutMs:20,fetcher:async()=>{
   calls++;if(mode==='fetch-timeout')return new Promise(()=>{});
   if(mode==='body-timeout')return new Response(new ReadableStream({start(){}}));
   return new Response(mode==='oversize'?'x'.repeat(256*1024+1):new Uint8Array([255]));
  }});
  await assert.rejects(provider.verify(await proof.sign(body,revision),body,revision),e=>e.code===(mode.endsWith('timeout')?'proof_transport_failure':'invalid_observation_proof'));
  assert.equal(calls,1);
 }
});
