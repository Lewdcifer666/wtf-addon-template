import assert from 'node:assert/strict';
import {test} from 'node:test';
import {interpretationTransportPlan,interpretationDispatchBody,validateInterpretationWireCall,executeInterpretationWireWorker} from '../interpretation-transport.mjs';
import {interpretationWorkerCallSchema} from '../interpretation-worker.mjs';
import {createBrokerGitHub} from '../broker-github.mjs';
import {gitBlobOid} from '../interpretation.mjs';
const call={schema_version:1,operation:'submit',request:{source_revision:'a'.repeat(40),request_id:'b'.repeat(64),packet:{schema_version:1,source_revision:'a'.repeat(40),request_id:'b'.repeat(64),
 interpretations:Array.from({length:900},(_,i)=>({feedback_id:'synthetic-'+i,raw_blob_oid:'c'.repeat(40),status:'no_signal',statements:[]}))}}};
test('complete packets use bounded wire parts without truncation, and internal transport methods are not AI tools',()=>{
 const plan=interpretationTransportPlan(call);assert.equal(plan.inline,false);assert(plan.parts.length>1);
 const packets=plan.parts.map(part=>{assert(Buffer.byteLength(interpretationDispatchBody(part))<60000);return Buffer.from(part.request.data_base64,'base64');});
 const value=JSON.parse(Buffer.concat(packets).toString('utf8'));assert.equal(value.interpretations.length,900);
 assert.deepEqual(interpretationWorkerCallSchema().oneOf.map(s=>s.properties.operation.const),['request','page','validate','submit']);
});
test('wire transport rejects changed counts, invalid byte lengths, injected destinations and excess packet size',()=>{
 const part=interpretationTransportPlan(call).parts[0];
 for(const change of [{part_count:32},{part_index:32},{data_base64:'AAAA'},{packet_bytes:2*1024*1024},{destination:'main'}])assert.throws(()=>validateInterpretationWireCall({...part,request:{...part.request,...change}}));
 const tooLarge=structuredClone(call);tooLarge.request.packet.interpretations=Array.from({length:9000},(_,i)=>({...call.request.packet.interpretations[0],feedback_id:'synthetic-'+i}));
 assert.throws(()=>interpretationTransportPlan(tooLarge),/interpretation_submission_limit/);
});
test('multipart worker defaults held before all metadata, Git or signer access',async()=>{
 const part=interpretationTransportPlan(call).parts[0];let touched=0;const proxy=new Proxy({},{get(){touched++;throw Error('PRIVATE_SENTINEL');}});
 await assert.rejects(executeInterpretationWireWorker({call:part,api:proxy,proof:proxy}),/private_interpretation_access_held/);assert.equal(touched,0);
});

test('PC transport caches only immutable Git content while every privacy/main-ref read remains fresh',async()=>{
 const sha=gitBlobOid('synthetic');let blobs=0,metadata=0,refs=0;
 const api=createBrokerGitHub({repository:'Lewdcifer666/wtf-scifi-feedback',token:'synthetic',fetcher:async url=>{
  if(url.endsWith('/git/blobs/'+sha)){blobs++;return Response.json({sha,size:9,encoding:'base64',content:Buffer.from('synthetic').toString('base64')});}
  if(url.endsWith('/git/ref/heads/main')){refs++;return Response.json({object:{sha:String(refs).repeat(40)}});}
  metadata++;return Response.json({full_name:'Lewdcifer666/wtf-scifi-feedback',private:metadata===1});
 }});
 const first=await api.get('/git/blobs/'+sha);first.content='mutated';assert.notEqual((await api.get('/git/blobs/'+sha)).content,'mutated');assert.equal(blobs,1);
 assert.equal((await api.get('/')).private,true);assert.equal((await api.get('/')).private,false);assert.equal(metadata,2);
 assert.notEqual((await api.get('/git/ref/heads/main')).object.sha,(await api.get('/git/ref/heads/main')).object.sha);assert.equal(refs,2);
});
