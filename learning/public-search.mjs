// Fixed public read endpoints only. No accounts, credentials, AI API or retries.
import {LearningError} from './git-artifacts.mjs';
const fail=code=>{throw new LearningError(code);};
const userAgent='WTFPrivateResearch/1.0 (https://github.com/Lewdcifer666/wtf-addon-template)';
const validText=(s,max)=>typeof s==='string'&&s.length<=max&&Buffer.from(s,'utf8').toString('utf8')===s&&!/[\u0000-\u001f\u007f]/.test(s);
const pageLimit=20,byteLimit=512*1024;

// Provider selection and transport injection belong to trusted host code.
// Only the query reaches the selected endpoint; no brief, preference indexes,
// task token, GitHub credential, cookies or feedback are sent.
export function createPublicSearchProvider({kind='wikipedia',fetcher=fetch,timeoutMs=10000}={}){
 if(!['wikipedia','tvmaze'].includes(kind)||typeof fetcher!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<10||timeoutMs>20000)fail('search_provider_unavailable');
 let queue=Promise.resolve();
 async function search(query){
  // Match the session/intent query contract exactly. URLSearchParams encodes
  // whitespace and control characters as data; a stricter post-intent filter
  // would strand an immutable intent without ever contacting the provider.
  if(typeof query!=='string'||query.length>2000||!query.trim()||Buffer.from(query,'utf8').toString('utf8')!==query)fail('invalid_search_request');
  const url=new URL(kind==='wikipedia'?'https://en.wikipedia.org/w/api.php':'https://api.tvmaze.com/search/shows');
  if(kind==='wikipedia'){
   for(const [key,value]of Object.entries({action:'query',format:'json',formatversion:'2',list:'search',srsearch:query,
    srnamespace:'0',srlimit:String(pageLimit),srprop:'',maxlag:'5'}))url.searchParams.set(key,value);
  }else url.searchParams.set('q',query);
  const controller=new AbortController();let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new LearningError('research_search_failed'));},timeoutMs);});
  const operation=async()=>{
   const response=await fetcher(url.href,{method:'GET',headers:{Accept:'application/json','User-Agent':userAgent},
    redirect:'manual',credentials:'omit',signal:controller.signal});
   if(response.status!==200||response.redirected||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??''))fail('research_search_failed');
   const length=response.headers.get('content-length');
   if(length!==null&&(!/^\d+$/.test(length)||Number(length)>byteLimit))fail('invalid_search_result');
   const chunks=[];let bytes=0;
   for await(const chunk of response.body??[]){
    bytes+=chunk.length;if(bytes>byteLimit){controller.abort();fail('invalid_search_result');}chunks.push(chunk);
   }
   const raw=Buffer.concat(chunks),text=raw.toString('utf8');
   if(!raw.length||!Buffer.from(text,'utf8').equals(raw))fail('invalid_search_result');
   let value;try{value=JSON.parse(text);}catch{fail('invalid_search_result');}
   let sources;
   if(kind==='wikipedia'){
    if(value?.error||value?.batchcomplete!==true||!Array.isArray(value?.query?.search)||value.query.search.length>pageLimit)fail('invalid_search_result');
    sources=value.query.search.map(page=>{
     if(!Number.isSafeInteger(page?.pageid)||page.pageid<1||page.ns!==0||!validText(page.title,1024)||!page.title.trim())fail('invalid_search_result');
     return {url:'https://en.wikipedia.org/?curid='+page.pageid,title:page.title};
    });
   }else{
    if(!Array.isArray(value)||value.length>100)fail('invalid_search_result');
    sources=value.slice(0,pageLimit).map(entry=>{
     const show=entry?.show;
     if(!Number.isSafeInteger(show?.id)||show.id<1||!validText(show.name,1024)||!show.name.trim()||!validText(show.url,4096))fail('invalid_search_result');
     let link;try{link=new URL(show.url);}catch{fail('invalid_search_result');}
     if(link.protocol!=='https:'||link.hostname!=='www.tvmaze.com'||link.username||link.password||link.port||link.hash||link.search
      ||!link.pathname.startsWith('/shows/'+show.id+'/'))fail('invalid_search_result');
     return {url:link.href,title:show.name};
    });
   }
   if(new Set(sources.map(s=>s.url)).size!==sources.length)fail('invalid_search_result');
   // Neither documented endpoint supplies a stable exposed request identifier.
   // Null is honest; do not invent one from a timestamp or local request ID.
   return {request_id:null,sources};
  };
  try{return await Promise.race([operation(),timeout]);}
  catch(error){if(['invalid_search_request','invalid_search_result'].includes(error?.code))throw error;fail('research_search_failed');}
  finally{clearTimeout(timer);controller.abort();}
 }
 return Object.freeze({id:kind==='wikipedia'?'wikipedia-public-v1':'tvmaze-public-v1',search(query){
  // Respect public API guidance: one outstanding request per provider instance.
  const next=queue.then(()=>search(query));queue=next.catch(()=>{});return next;
 }});
}
