import fs from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createInterpretationWorkerDispatch} from '../interpretation-worker-dispatch.mjs';
import {interpretationWorkerHash,validateInterpretationWorkerCall,readInterpretationWorkerResult} from '../interpretation-worker.mjs';
import {persistImmutable} from '../git-artifacts.mjs';
const call={schema_version:1,operation:'request',request:{source_revision:'a'.repeat(40)}};
test('interpretation dispatcher has only the fixed private-main workflow capability',async()=>{
 let request;const dispatch=createInterpretationWorkerDispatch({token:'synthetic-api-token',fetcher:async(url,options)=>{request={url,options};return new Response(null,{status:204});}});
 assert.deepEqual(await dispatch(call),{accepted:true});
 assert.equal(request.url,'https://api.github.com/repos/Lewdcifer666/wtf-scifi-feedback/actions/workflows/learning-finalize.yml/dispatches');
 const body=JSON.parse(request.options.body);assert.equal(body.ref,'main');assert.equal(body.inputs.dry_run,false);
 assert.deepEqual(JSON.parse(body.inputs.interpretation_request),call);assert.equal(request.options.redirect,'manual');
});
test('uncertain interpretation dispatch is pending and never automatically retried',async()=>{
 for(const outcome of ['throw',500,302]){
  let calls=0;const dispatch=createInterpretationWorkerDispatch({token:'synthetic-api-token',fetcher:async()=>{calls++;if(outcome==='throw')throw Error('SECRET_SENTINEL');return new Response(null,{status:outcome});}});
  await assert.rejects(dispatch(call),e=>e.code==='private_interpretation_pending'&&!e.message.includes('SECRET_SENTINEL'));assert.equal(calls,1);
 }
});
test('closed interpretation input and dispatch byte budget are checked before credentials or network',async()=>{
 let credentials=0,requests=0;const dispatch=createInterpretationWorkerDispatch({getToken:async()=>{credentials++;return 'synthetic';},fetcher:async()=>{requests++;return new Response(null,{status:204});}});
 await assert.rejects(dispatch({...call,repository:'public'}),/invalid_interpretation_task_call/);
 const huge={schema_version:1,operation:'submit',request:{source_revision:'a'.repeat(40),request_id:'b'.repeat(64),packet:{schema_version:1,source_revision:'a'.repeat(40),request_id:'b'.repeat(64),
  interpretations:Array.from({length:1000},(_,i)=>({feedback_id:'synthetic-'+i,raw_blob_oid:'c'.repeat(40),status:'no_signal',statements:[]}))}}};
 await assert.rejects(dispatch(huge),/interpretation_submission_limit/);assert.equal(credentials,0);assert.equal(requests,0);
});
test('semantic JSON key ordering cannot create another interpretation request identity',()=>{
 const packet={schema_version:1,source_revision:'a'.repeat(40),request_id:'b'.repeat(64),interpretations:[{feedback_id:'synthetic',raw_blob_oid:'c'.repeat(40),status:'no_signal',statements:[]}]};
 const a={schema_version:1,operation:'submit',request:{source_revision:packet.source_revision,request_id:packet.request_id,packet}};
 const b={operation:'submit',request:{packet:{interpretations:packet.interpretations,request_id:packet.request_id,source_revision:packet.source_revision,schema_version:1},request_id:packet.request_id,source_revision:packet.source_revision},schema_version:1};
 assert.equal(interpretationWorkerHash(a),interpretationWorkerHash(b));assert.deepEqual(validateInterpretationWorkerCall(a),validateInterpretationWorkerCall(b));
});
test('interpretation result reader defaults held and exact result branches accept no alternate files',async()=>{
 let reads=0;await assert.rejects(readInterpretationWorkerResult({api:{get(){reads++;}}}),/private_interpretation_access_held/);assert.equal(reads,0);
 await assert.rejects(persistImmutable({}, {base:{},branch:'learning/interpretation-result-'+'a'.repeat(64),files:{'arbitrary.json':'{}'}}),/unsafe_artifact_path/);
});
test('interpretation worker stays opt-in, bounded, mutually exclusive and on trusted main',()=>{
 const workflow=fs.readFileSync(new URL('../workflows/learning-finalize.yml',import.meta.url),'utf8'),job=workflow.slice(workflow.indexOf('  interpretation-worker:'));
 assert(job.includes("vars.PRIVATE_INTERPRETATION_WORKER_ENABLED == 'true'"));assert(job.includes('timeout-minutes: 5'));
 assert(job.includes("inputs.task_request == ''"));assert(job.includes("github.ref == 'refs/heads/main'"));
 assert(job.includes('ref: ${{ steps.trusted.outputs.sha }}'));assert(job.includes('persist-credentials: false'));assert(job.includes('package-manager-cache: false'));
 assert(job.includes('node learning/interpretation-worker.mjs'));assert(!job.includes('${{ inputs.interpretation_request }}'));
 const source=fs.readFileSync(new URL('../interpretation-worker.mjs',import.meta.url),'utf8');assert(source.includes('GITHUB_EVENT_PATH'));assert(!source.includes('process.env.INTERPRETATION_REQUEST'));
 assert(workflow.includes('cancel-in-progress: false'));
});
