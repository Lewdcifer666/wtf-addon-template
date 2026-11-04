import {test} from 'node:test';import assert from 'node:assert/strict';
import {githubHttpSummary,githubErrorSummary} from '../github-diagnostics.mjs';
import {createGitHubQuotaGate} from '../github-quota.mjs';
test('quota diagnostics contain only closed response metadata and survive the original error',()=>{
 const response=new Response('PRIVATE_SENTINEL',{status:403,headers:{'x-github-request-id':'A12F:302B','x-ratelimit-resource':'graphql','x-ratelimit-remaining':'0','x-ratelimit-reset':'120','authorization':'PRIVATE_SENTINEL','x-private-query':'PRIVATE_SENTINEL'}});
 assert.deepEqual(githubHttpSummary(response,'current_heads'),{operation:'current_heads',status:403,request_id:'A12F:302B',resource:'graphql',remaining:'0',reset:'120'});
 const gate=createGitHubQuotaGate({clock:()=>0});assert.equal(gate.observe(response,'current_heads'),true);
 assert.throws(()=>gate.reject(),error=>{assert.equal(githubErrorSummary(error).github.resource,'graphql');assert(!JSON.stringify(githubErrorSummary(error)).includes('PRIVATE_SENTINEL'));return true;});
 assert.deepEqual(githubErrorSummary(Object.assign(Error('PRIVATE_SENTINEL'),{github:{query:'PRIVATE_SENTINEL'}})),{});
 assert.equal(githubHttpSummary(response,'caller query'),undefined);
 const malformed=new Response(null,{status:403,headers:{'x-github-request-id':'PRIVATE_SENTINEL','x-ratelimit-resource':'PRIVATE_SENTINEL','retry-after':'tomorrow'}});
 assert.deepEqual(githubHttpSummary(malformed,'rest_read'),{operation:'rest_read',status:403});
});
