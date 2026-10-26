import {LearningError} from './git-artifacts.mjs';
export class GitHub {
  constructor(repository,token,{writable=false,fetcher=fetch,cacheImmutable=false,cacheMaxEntries=2048,cacheMaxBytes=64*1024*1024}={}){
    if(!/^Lewdcifer666\/wtf-(?:scifi-feedback|(?:action|anime|fantasy|mystery|scifi|thriller)-stremio)$/.test(repository))throw new LearningError('unexpected_repository');
    if(!token)throw new LearningError('missing_credentials');
    this.repository=repository;this.token=token;this.writable=writable;this.fetcher=fetcher;
    if(typeof cacheImmutable!=='boolean'||!Number.isInteger(cacheMaxEntries)||cacheMaxEntries<1||cacheMaxEntries>2048
      ||!Number.isInteger(cacheMaxBytes)||cacheMaxBytes<1||cacheMaxBytes>64*1024*1024)throw new LearningError('invalid_api_cache');
    this.immutableReads=cacheImmutable?{values:new Map(),pending:new Map(),bytes:0,maxEntries:cacheMaxEntries,maxBytes:cacheMaxBytes}:null;
  }
  async request(method,route,body){
    if(!route.startsWith('/')||route.includes('://'))throw new LearningError('invalid_api_route');
    if(method!=='GET'&&(!this.writable||this.repository!=='Lewdcifer666/wtf-scifi-feedback'||!/^\/git\/(blobs|trees|commits|refs)$/.test(route)))throw new LearningError('unauthorized_write');
    for(let attempt=0;attempt<3;attempt++){
      let response;
      try{response=await this.fetcher(`https://api.github.com/repos/${this.repository}${route==='/'?'':route}`,{method,headers:{Authorization:`Bearer ${this.token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});}
      catch{throw new LearningError('transport_failure');}
      if(response.ok){
        try{return await response.json();}
        catch(error){throw new LearningError(error instanceof SyntaxError?'github_request_failed':'transport_failure');}
      }
      if(method==='GET'&&response.status>=500&&attempt<2){await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));continue;}
      const error=new LearningError('github_request_failed');error.status=response.status;throw error;
    }
  }
  async get(route){
    const cache=this.immutableReads;
    // Only content-addressed objects/graphs. Heads, refs, branch lists and
    // repository privacy/identity metadata MUST hit GitHub on every check.
    if(!cache||!/^\/(?:git\/(?:commits|blobs)\/[a-f0-9]{40}|git\/trees\/[a-f0-9]{40}\?recursive=1|compare\/[a-f0-9]{40}\.\.\.[a-f0-9]{40})$/.test(route))return this.request('GET',route);
    if(cache.values.has(route))return structuredClone(cache.values.get(route).value);
    if(!cache.pending.has(route))cache.pending.set(route,(async()=>{
      const result=await this.request('GET',route),value=structuredClone(result),size=Buffer.byteLength(JSON.stringify(value));
      const identity=route.startsWith('/compare/')
        ?value&&typeof value.status==='string'&&/^[a-f0-9]{40}$/.test(value.merge_base_commit?.sha??'')
        :value?.sha===route.match(/[a-f0-9]{40}/)?.[0];
      if(identity&&size<=cache.maxBytes){
        while(cache.values.size&&(cache.values.size>=cache.maxEntries||cache.bytes+size>cache.maxBytes)){
          const oldest=cache.values.keys().next().value;cache.bytes-=cache.values.get(oldest).size;cache.values.delete(oldest);
        }
        cache.values.set(route,{value,size});cache.bytes+=size;
      }
      return value;
    })().finally(()=>cache.pending.delete(route)));
    return structuredClone(await cache.pending.get(route));
  }
  post(route,body){return this.request('POST',route,body);}
  async optional(route){try{return await this.get(route);}catch(error){if(error.status===404)return null;throw error;}}
  async pinMain(){const ref=await this.get('/git/ref/heads/main');return this.get(`/git/commits/${ref.object.sha}`);}
}
