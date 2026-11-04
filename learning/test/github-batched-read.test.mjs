import {test} from 'node:test';import assert from 'node:assert/strict';
import {GitHub} from '../github.mjs';import {gitBlobOid} from '../interpretation.mjs';
import {createGitHubQuotaGate} from '../github-quota.mjs';import {createBrokerGitHub} from '../broker-github.mjs';
import {assertWorkerHeads} from '../research-worker.mjs';
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

const genres=['action','anime','fantasy','mystery','scifi','thriller'];
const headResponse=()=>({data:Object.fromEntries([repository,...genres.map(g=>`Lewdcifer666/wtf-${g}-stremio`)].map((name,i)=>['r'+i,
 {nameWithOwner:name,isPrivate:i===0,defaultBranchRef:{name:'main',prefix:'refs/heads/',target:{__typename:'Commit',oid:String(i+1).repeat(40)}}}]))});
function headClients(fetcher,extra={}){
 const quotaGate=extra.quotaGate??createGitHubQuotaGate(),options={batchHeads:true,cacheImmutable:true,quotaGate,fetcher,...extra};
 return {api:new GitHub(repository,'synthetic',options),publicApis:Object.fromEntries(genres.map(g=>[g,new GitHub(`Lewdcifer666/wtf-${g}-stremio`,'synthetic',options)]))};
}

test('each complete seven-head currentness check uses one fresh bounded query and never caches mutable heads',async()=>{
 let calls=0;const c=headClients(async(url,o)=>{
  calls++;assert.equal(url,'https://api.github.com/graphql');assert.equal(o.method,'POST');assert.equal(o.redirect,'manual');
  const q=JSON.parse(o.body).query;assert(q.startsWith('query CurrentPrivateLearningHeads'));assert(!q.includes('mutation'));assert.equal((q.match(/:repository\(/g)||[]).length,7);
  const r=headResponse();r.data.r0.defaultBranchRef.target.oid=calls.toString(16).padStart(40,'0');return Response.json(r);
 });
 for(let n=1;n<=20;n++){const result=await c.api.readCurrentHeads(c.publicApis);assert.equal(result.private,n.toString(16).padStart(40,'0'));assert.deepEqual(Object.keys(result.public),genres);}
 assert.equal(calls,20);
});

test('worker currentness still rejects every moved private/public head after a fresh trusted batch',async()=>{
 let moved=null,queries=0;const c=headClients(async(url)=>{
  if(url==='https://api.github.com/graphql'){queries++;const r=headResponse();if(moved!==null)r.data['r'+moved].defaultBranchRef.target.oid='f'.repeat(40);return Response.json(r);}
  assert(url.endsWith('/git/ref/heads/research/2026-11-04-anime'));return Response.json({}, {status:404});
 });
 const heads={private:'1'.repeat(40),public:Object.fromEntries(genres.map((g,i)=>[g,String(i+2).repeat(40)]))};
 const input={...c,heads,request:{genre:'anime',private_revision:heads.private,public_revision:heads.public.anime,research_date:'2026-11-04'},operation:'open',clock:()=>new Date('2026-11-04T11:00:00Z')};
 await assertWorkerHeads(input);
 for(let i=0;i<7;i++){moved=i;await assert.rejects(assertWorkerHeads(input),{code:'stale_input'});}
 assert.equal(queries,8);
});

test('incomplete, untrusted, malformed or oversized head snapshots never fall back to REST',async()=>{
 for(const change of ['partial','name','privacy','public-privacy','branch','prefix','type','oid','oversize','errors']){
  let calls=0;const c=headClients(async()=>{
   calls++;const r=headResponse();if(change==='partial')delete r.data.r6;if(change==='name')r.data.r0.nameWithOwner='other/repo';
   if(change==='privacy')r.data.r0.isPrivate=false;if(change==='public-privacy')r.data.r1.isPrivate=true;
   if(change==='branch')r.data.r0.defaultBranchRef.name='untrusted';if(change==='prefix')r.data.r0.defaultBranchRef.prefix='refs/tags/';if(change==='type')r.data.r0.defaultBranchRef.target.__typename='Tag';
   if(change==='oid')r.data.r4.defaultBranchRef.target.oid='main';if(change==='oversize')r.padding='x'.repeat(40000);
   if(change==='errors')r.errors=[{message:'PRIVATE_SENTINEL'}];return Response.json(r);
  });
  await assert.rejects(c.api.readCurrentHeads(c.publicApis),e=>e.code==='invalid_source'&&!String(e).includes('SENTINEL'));assert.equal(calls,1);
 }
});

test('head batching shares quota holds with every client, with no fallback or extra request during cooldown',async()=>{
 let calls=0,now=0;const gate=createGitHubQuotaGate({clock:()=>now});
 const c=headClients(async()=>{calls++;return Response.json({errors:[{type:'RATE_LIMITED',message:'PRIVATE_SENTINEL'}]},{headers:{'x-ratelimit-remaining':'0','x-ratelimit-reset':'120'}});},{quotaGate:gate});
 await assert.rejects(c.api.readCurrentHeads(c.publicApis),{code:'github_rate_limited'});
 await assert.rejects(c.publicApis.action.get('/'),{code:'github_rate_limited'});await assert.rejects(c.api.readCurrentHeads(c.publicApis),{code:'github_rate_limited'});assert.equal(calls,1);
 now=120000;c.api.fetcher=async()=>{calls++;return Response.json(headResponse());};await c.api.readCurrentHeads(c.publicApis);assert.equal(calls,2);
});

test('default and PC clients cannot opt into head batching through supplied task data or another credential',async()=>{
 let calls=0;const c=headClients(async()=>{calls++;return Response.json(headResponse());});
 const disabled=new GitHub(repository,'synthetic',{fetcher:async()=>{calls++;}});
 await assert.rejects(disabled.readCurrentHeads(c.publicApis),{code:'invalid_source'});
 const pc=createBrokerGitHub({repository,token:'synthetic',fetcher:async()=>{calls++;}});
 assert.equal(pc.batchHeads,false);await assert.rejects(pc.readCurrentHeads(c.publicApis),{code:'invalid_source'});
 c.publicApis.anime=new GitHub('Lewdcifer666/wtf-anime-stremio','another-synthetic',{quotaGate:c.api.quotaGate});
 await assert.rejects(c.api.readCurrentHeads(c.publicApis),{code:'invalid_source'});assert.equal(calls,0);
});
