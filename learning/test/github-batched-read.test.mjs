import {test} from 'node:test';import assert from 'node:assert/strict';
import {GitHub} from '../github.mjs';import {gitBlobOid} from '../interpretation.mjs';
import {createGitHubQuotaGate} from '../github-quota.mjs';import {createBrokerGitHub} from '../broker-github.mjs';
const repository='Lewdcifer666/wtf-scifi-feedback';
const entry=text=>({type:'blob',mode:'100644',size:Buffer.byteLength(text),sha:gitBlobOid(text)});
const body=(entries,texts)=>({data:{repository:{nameWithOwner:repository,...Object.fromEntries(entries.map((e,i)=>['b'+i,{__typename:'Blob',oid:e.sha,byteSize:e.size,isBinary:false,isTruncated:false,text:texts[i]}]))}}});
test('trusted batching reduces forty complete pinned reads to two requests without caching heads or dropping duplicate paths',async()=>{
 const texts=Array.from({length:40},(_,i)=>JSON.stringify({synthetic:i})),entries=texts.map(entry);let calls=0;
 const api=new GitHub(repository,'synthetic',{batchBlobs:true,cacheImmutable:true,fetcher:async(url,options)=>{
  calls++;assert.equal(url,'https://api.github.com/graphql');assert.equal(options.method,'POST');assert.equal(options.redirect,'manual');
  const q=JSON.parse(options.body);assert(!q.query.includes('mutation'));const ids=Object.keys(q.variables).filter(k=>/^o\d+$/.test(k)).map(k=>q.variables[k]);assert.equal(ids.length,20);
  return Response.json(body(ids.map(id=>entries.find(e=>e.sha===id)),ids.map(id=>texts[entries.findIndex(e=>e.sha===id)])));
 }});
 const got=await api.readBlobs([...entries,entries[0]]);assert.equal(got.size,40);assert.equal(calls,2);
 entries.forEach((e,i)=>assert.equal(got.get(e.sha).toString(),texts[i]));await api.readBlobs(entries);assert.equal(calls,2);
});
test('partial, truncated, wrong-identity or altered batched blobs fail closed without REST fallback',async()=>{
 const text='private synthetic sentinel',e=entry(text);
 for(const change of ['partial','truncated','identity','size','binary','bytes','repository']){
  let calls=0;const api=new GitHub(repository,'synthetic',{batchBlobs:true,fetcher:async()=>{
   calls++;const x=body([e],[text]),b=x.data.repository.b0;
   if(change==='partial')delete x.data.repository.b0;
   if(change==='truncated')b.isTruncated=true;if(change==='identity')b.oid='a'.repeat(40);
   if(change==='size')b.byteSize++;if(change==='binary')b.isBinary=true;if(change==='bytes')b.text+='x';if(change==='repository')x.data.repository.nameWithOwner='other/repo';return Response.json(x);
  }});
  await assert.rejects(api.readBlobs([e]),{code:'invalid_source'});assert.equal(calls,1);
 }
});
test('large blobs use REST from the outset and untrusted batching inputs never reach GitHub',async()=>{
 const text='x'.repeat(17000),e=entry(text);let calls=0;
 const api=new GitHub(repository,'synthetic',{batchBlobs:true,fetcher:async url=>{calls++;assert(url.endsWith('/git/blobs/'+e.sha));return Response.json({sha:e.sha,size:e.size,encoding:'base64',content:Buffer.from(text).toString('base64')});}});
 assert.equal((await api.readBlobs([e])).get(e.sha).length,text.length);
 for(const invalid of [{...e,sha:'mutation{}'},{...e,size:-1},{...e,type:'tree'},{...e,mode:'120000'}])await assert.rejects(api.readBlobs([invalid]),{code:'invalid_source'});
 assert.equal(calls,1);
});
test('one shared quota gate stops REST, batching and other repository reads until reset without another credential or retry',async()=>{
 let now=0,calls=0;const gate=createGitHubQuotaGate({clock:()=>now});
 const limited=new GitHub(repository,'synthetic',{quotaGate:gate,fetcher:async()=>{calls++;return new Response(null,{status:403,headers:{'x-ratelimit-remaining':'0','x-ratelimit-reset':'120'}});}});
 const other=new GitHub('Lewdcifer666/wtf-anime-stremio','synthetic',{quotaGate:gate,batchBlobs:true,fetcher:async()=>{calls++;return Response.json({private:false});}});
 await assert.rejects(limited.get('/'),{code:'github_rate_limited'});await assert.rejects(other.get('/'),{code:'github_rate_limited'});await assert.rejects(other.readBlobs([entry('x')]),{code:'github_rate_limited'});assert.equal(calls,1);
 now=120000;assert.deepEqual(await other.get('/'),{private:false});assert.equal(calls,2);
});
test('GraphQL quota errors do not fall back to REST and scoped PC responses preserve reset headers',async()=>{
 let calls=0;const gate=createGitHubQuotaGate({clock:()=>0});
 const api=new GitHub(repository,'synthetic',{quotaGate:gate,batchBlobs:true,fetcher:async()=>{calls++;return Response.json({errors:[{type:'RATE_LIMITED',message:'PRIVATE_SENTINEL'}]},{headers:{'x-ratelimit-remaining':'0','x-ratelimit-reset':'120'}});}});
 await assert.rejects(api.readBlobs([entry('x')]),e=>e.code==='github_rate_limited'&&!String(e).includes('SENTINEL'));await assert.rejects(api.get('/'),{code:'github_rate_limited'});assert.equal(calls,1);
 const scoped=createBrokerGitHub({repository,token:'synthetic',quotaGate:createGitHubQuotaGate(),fetcher:async()=>new Response(null,{status:429,headers:{'retry-after':'60'}})});
 await assert.rejects(scoped.get('/'),{code:'github_rate_limited'});
});
