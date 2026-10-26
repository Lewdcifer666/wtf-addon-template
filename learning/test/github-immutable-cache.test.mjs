import assert from 'node:assert/strict';
import {test} from 'node:test';
import {GitHub} from '../github.mjs';
const repository='Lewdcifer666/wtf-scifi-feedback',sha='a'.repeat(40);
const response=value=>({ok:true,json:async()=>structuredClone(value)});

test('worker cache shares only immutable Git object reads and protects cached values from caller mutation',async()=>{
 let calls=0;const api=new GitHub(repository,'synthetic',{cacheImmutable:true,fetcher:async()=>{calls++;await new Promise(r=>setTimeout(r,5));return response({sha,parents:[{sha:'b'.repeat(40)}]});}});
 const [first,second]=await Promise.all([api.get('/git/commits/'+sha),api.get('/git/commits/'+sha)]);
 first.parents[0].sha='FORGED';assert.equal(second.parents[0].sha,'b'.repeat(40));
 assert.equal((await api.get('/git/commits/'+sha)).parents[0].sha,'b'.repeat(40));assert.equal(calls,1);
});

test('mutable heads, privacy metadata and ref inventories are never cached',async()=>{
 const calls=new Map();let version=0;
 const api=new GitHub(repository,'synthetic',{cacheImmutable:true,fetcher:async url=>{
  const route=url.split(repository)[1]||'/';calls.set(route,(calls.get(route)??0)+1);version++;
  return response(route.startsWith('/git/commits/')?{sha,parents:[],tree:{sha:'b'.repeat(40)}}:{sha:String(version),private:version<4,object:{sha}});
 }});
 for(const route of ['/','/git/ref/heads/main','/git/matching-refs/heads/learning/','/git/ref/heads/research/2026-10-26-scifi']){
  assert.notDeepEqual(await api.get(route),await api.get(route));assert.equal(calls.get(route),2);
 }
 await api.pinMain();await api.pinMain();assert.equal(calls.get('/git/ref/heads/main'),4);assert.equal(calls.get('/git/commits/'+sha),1);
});

test('cache is repository-local, bounded and never retains failed or malformed reads',async()=>{
 let calls=0;const fetcher=async url=>{calls++;return response({sha:url.split('/').at(-1),padding:'x'.repeat(10)});};
 const a=new GitHub(repository,'synthetic',{cacheImmutable:true,cacheMaxEntries:1,fetcher});
 const b=new GitHub('Lewdcifer666/wtf-scifi-stremio','synthetic',{cacheImmutable:true,fetcher});
 await a.get('/git/blobs/'+sha);await b.get('/git/blobs/'+sha);assert.equal(calls,2);
 await a.get('/git/blobs/'+'b'.repeat(40));await a.get('/git/blobs/'+sha);assert.equal(calls,4);
 let failures=0;const bad=new GitHub(repository,'synthetic',{cacheImmutable:true,fetcher:async()=>{failures++;throw Error('transport');}});
 for(let i=0;i<2;i++)await assert.rejects(bad.get('/git/blobs/'+sha),{code:'transport_failure'});assert.equal(failures,2);
});

test('oversized single objects do not exceed the cache budget or suppress subsequent reads',async()=>{
 let calls=0;const api=new GitHub(repository,'synthetic',{cacheImmutable:true,cacheMaxBytes:10,fetcher:async()=>{calls++;return response({sha,payload:'x'.repeat(100)});}});
 await api.get('/git/blobs/'+sha);await api.get('/git/blobs/'+sha);assert.equal(calls,2);
});

test('wrong-identity immutable responses cannot poison a later valid lookup',async()=>{
 let calls=0;const api=new GitHub(repository,'synthetic',{cacheImmutable:true,fetcher:async()=>response({sha:++calls===1?'b'.repeat(40):sha})});
 assert.equal((await api.get('/git/blobs/'+sha)).sha,'b'.repeat(40));
 assert.equal((await api.get('/git/blobs/'+sha)).sha,sha);await api.get('/git/blobs/'+sha);assert.equal(calls,2);
});
