import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPublicSearchProvider} from '../public-search.mjs';
const wikipedia={batchcomplete:true,query:{search:[{pageid:123,ns:0,title:'Synthetic film'}]}};
const tvmaze=[{show:{id:321,name:'Synthetic show',url:'https://www.tvmaze.com/shows/321/synthetic-show'}}];
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});

for(const kind of ['wikipedia','tvmaze'])test(`${kind} uses one fixed anonymous read endpoint and releases only titles and source URLs`,async()=>{
 let calls=0;
 const provider=createPublicSearchProvider({kind,fetcher:async(url,options)=>{
  calls++;const link=new URL(url);assert.equal(link.origin,kind==='wikipedia'?'https://en.wikipedia.org':'https://api.tvmaze.com');
  assert.equal(link.searchParams.get(kind==='wikipedia'?'srsearch':'q'),'fiction title & test');
  assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');assert.equal(options.credentials,'omit');
  assert.deepEqual(Object.keys(options.headers).sort(),['Accept','User-Agent']);assert(!url.includes('token'));
  if(kind==='wikipedia'){assert.equal(link.searchParams.get('maxlag'),'5');assert.equal(link.searchParams.get('srnamespace'),'0');}
  return json(kind==='wikipedia'?wikipedia:tvmaze);
 }});
 const result=await provider.search('fiction title & test');assert.equal(calls,1);
 assert.deepEqual(result,{request_id:null,sources:[kind==='wikipedia'?{url:'https://en.wikipedia.org/?curid=123',title:'Synthetic film'}:
  {url:'https://www.tvmaze.com/shows/321/synthetic-show',title:'Synthetic show'}]});
});

test('invalid queries or a caller-selected destination cannot start any request',async()=>{
 let calls=0;const provider=createPublicSearchProvider({fetcher:async()=>{calls++;return json(wikipedia);}});
 for(const q of ['', ' ',null,{},'a'.repeat(2001),'film\nPRIVATE_SENTINEL','\ud800'])await assert.rejects(provider.search(q),{code:'invalid_search_request'});
 assert.equal(calls,0);assert.throws(()=>createPublicSearchProvider({kind:'https://evil.invalid'}),{code:'search_provider_unavailable'});
});

test('zero findings require an explicit valid provider result',async()=>{
 const p=createPublicSearchProvider({fetcher:async()=>json({batchcomplete:true,query:{search:[]}})});
 assert.deepEqual(await p.search('unknown fictional title'),{request_id:null,sources:[]});
 for(const value of [{},null,{query:{search:[]}},{batchcomplete:true,error:{info:'PRIVATE_SENTINEL'},query:{search:[]}}]){
  await assert.rejects(createPublicSearchProvider({fetcher:async()=>json(value)}).search('film'),{code:'invalid_search_result'});
 }
});

test('HTTP errors, redirects and thrown private details stop without retries or fallback',async()=>{
 for(const status of [301,302,307,401,403,404,429,500,503]){
  let calls=0;const p=createPublicSearchProvider({fetcher:async()=>{calls++;return new Response('PRIVATE_SENTINEL',{status,headers:{'content-type':'application/json',Location:'https://evil.invalid'}});}});
  await assert.rejects(p.search('film'),e=>e.code==='research_search_failed'&&!String(e).includes('PRIVATE_SENTINEL'));assert.equal(calls,1);
 }
 let calls=0;const p=createPublicSearchProvider({fetcher:async()=>{calls++;throw Error('PRIVATE_SENTINEL');}});
 await assert.rejects(p.search('film'),e=>e.code==='research_search_failed'&&!String(e).includes('PRIVATE_SENTINEL'));assert.equal(calls,1);
});

test('body limits, UTF-8, JSON and source identities are validated before release',async()=>{
 const malformed=[new Response('x',{headers:{'content-type':'text/html'}}),new Response('x',{headers:{'content-type':'application/json','content-length':'524289'}}),
  new Response('x'.repeat(524289),{headers:{'content-type':'application/json'}}),new Response(new Uint8Array([255]),{headers:{'content-type':'application/json'}}),json({...wikipedia,query:{search:[{pageid:0,ns:0,title:'film'}]}}),
  json({...wikipedia,query:{search:[{pageid:123,ns:1,title:'film'}]}}),json({...wikipedia,query:{search:[wikipedia.query.search[0],wikipedia.query.search[0]]}})];
 for(const response of malformed){const p=createPublicSearchProvider({fetcher:async()=>response});await assert.rejects(p.search('film'),e=>['invalid_search_result','research_search_failed'].includes(e.code));}
 for(const url of ['http://www.tvmaze.com/shows/321/test','https://evil.invalid/shows/321/test','https://www.tvmaze.com/shows/999/test','https://user@www.tvmaze.com/shows/321/test']){
  await assert.rejects(createPublicSearchProvider({kind:'tvmaze',fetcher:async()=>json([{show:{...tvmaze[0].show,url}}])}).search('show'),{code:'invalid_search_result'});
 }
});

test('deadline covers both fetch and stalled response bodies without another invocation',async()=>{
 for(const mode of ['fetch','body']){
  let calls=0;const p=createPublicSearchProvider({timeoutMs:20,fetcher:async()=>{calls++;return mode==='fetch'?new Promise(()=>{}):new Response(new ReadableStream({start(){}}),{headers:{'content-type':'application/json'}});}});
  await assert.rejects(p.search('film'),{code:'research_search_failed'});assert.equal(calls,1);
 }
});

test('parallel task requests serialize external reads',async()=>{
 let active=0,max=0;const p=createPublicSearchProvider({fetcher:async()=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,10));active--;return json(wikipedia);}});
 await Promise.all([p.search('a'),p.search('b'),p.search('c')]);assert.equal(max,1);
});
