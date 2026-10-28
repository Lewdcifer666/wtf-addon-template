import {LearningError} from './git-artifacts.mjs';
import {createHash} from 'node:crypto';
import {createGitHubQuotaGate,isGitHubQuotaGate} from './github-quota.mjs';
const blobOid=bytes=>createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
export class GitHub {
  constructor(repository,token,{writable=false,fetcher=fetch,cacheImmutable=false,cacheMaxEntries=2048,cacheMaxBytes=64*1024*1024,batchBlobs=false,quotaGate=createGitHubQuotaGate()}={}){
    if(!/^Lewdcifer666\/wtf-(?:scifi-feedback|(?:action|anime|fantasy|mystery|scifi|thriller)-stremio)$/.test(repository))throw new LearningError('unexpected_repository');
    if(!token)throw new LearningError('missing_credentials');
    this.repository=repository;this.token=token;this.writable=writable;this.fetcher=fetcher;
    if(typeof batchBlobs!=='boolean'||!isGitHubQuotaGate(quotaGate))throw new LearningError('invalid_api_cache');
    this.batchBlobs=batchBlobs;this.quotaGate=quotaGate;
    if(typeof cacheImmutable!=='boolean'||!Number.isInteger(cacheMaxEntries)||cacheMaxEntries<1||cacheMaxEntries>2048
      ||!Number.isInteger(cacheMaxBytes)||cacheMaxBytes<1||cacheMaxBytes>64*1024*1024)throw new LearningError('invalid_api_cache');
    this.immutableReads=cacheImmutable?{values:new Map(),pending:new Map(),bytes:0,maxEntries:cacheMaxEntries,maxBytes:cacheMaxBytes}:null;
  }
  async request(method,route,body){
    if(!route.startsWith('/')||route.includes('://'))throw new LearningError('invalid_api_route');
    if(method!=='GET'&&(!this.writable||this.repository!=='Lewdcifer666/wtf-scifi-feedback'||!/^\/git\/(blobs|trees|commits|refs)$/.test(route)))throw new LearningError('unauthorized_write');
    for(let attempt=0;attempt<3;attempt++){
      this.quotaGate.assertAllowed();
      let response;
      try{response=await this.fetcher(`https://api.github.com/repos/${this.repository}${route==='/'?'':route}`,{method,headers:{Authorization:`Bearer ${this.token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});}
      catch{throw new LearningError('transport_failure');}
      if(this.quotaGate.observe(response))this.quotaGate.reject();
      if(response.ok){
        try{return await response.json();}
        catch(error){throw new LearningError(error instanceof SyntaxError?'github_request_failed':'transport_failure');}
      }
      if(method==='GET'&&response.status>=500&&attempt<2){await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));continue;}
      const error=new LearningError('github_request_failed');error.status=response.status;throw error;
    }
  }
  rememberImmutable(route,result){
    const cache=this.immutableReads;if(!cache)return;
    const value=structuredClone(result),size=Buffer.byteLength(JSON.stringify(value));
    if(size>cache.maxBytes)return;
    if(cache.values.has(route)){cache.bytes-=cache.values.get(route).size;cache.values.delete(route);}
    while(cache.values.size&&(cache.values.size>=cache.maxEntries||cache.bytes+size>cache.maxBytes)){
      const oldest=cache.values.keys().next().value;cache.bytes-=cache.values.get(oldest).size;cache.values.delete(oldest);
    }
    cache.values.set(route,{value,size});cache.bytes+=size;
  }
  // Closed read-only batching, enabled only by trusted Actions host code.
  // OIDs come from the complete pinned tree; no caller-authored GraphQL or path.
  async readBlobs(entries){
    const fail=()=>{throw new LearningError('invalid_source');};
    if(!Array.isArray(entries)||entries.length>10000)fail();
    const unique=new Map();let total=0;
    for(const e of entries){
      if(e?.type!=='blob'||!['100644','100755'].includes(e.mode)||!/^[a-f0-9]{40}$/.test(e.sha??'')||!Number.isSafeInteger(e.size)||e.size<0||e.size>8*1024*1024)fail();
      if(unique.has(e.sha)&&unique.get(e.sha).size!==e.size)fail();unique.set(e.sha,e);total+=e.size;
    }
    if(total>32*1024*1024)fail();
    const out=new Map(),pending=[];
    const accept=(e,b)=>{if(b?.sha!==e.sha||b.encoding!=='base64'||b.size!==e.size||typeof b.content!=='string')fail();const bytes=Buffer.from(b.content,'base64');if(bytes.length!==e.size||blobOid(bytes)!==e.sha||!Buffer.from(bytes.toString('utf8')).equals(bytes))fail();return bytes;};
    for(const e of unique.values()){
      const cached=this.immutableReads?.values.get('/git/blobs/'+e.sha)?.value;
      if(cached)out.set(e.sha,accept(e,cached));else pending.push(e);
    }
    for(let offset=0;offset<pending.length;){
      const e=pending[offset];
      // Large objects use the existing bounded caller contract from the outset;
      // a failed/truncated/limited batch NEVER falls back to another endpoint.
      if(!this.batchBlobs||e.size>16384){out.set(e.sha,accept(e,await this.get('/git/blobs/'+e.sha)));offset++;continue;}
      const batch=[];while(offset<pending.length&&batch.length<20&&pending[offset].size<=16384)batch.push(pending[offset++]);
      this.quotaGate.assertAllowed();
      const variables={owner:'Lewdcifer666',name:this.repository.split('/')[1]};
      const declarations=['$owner:String!','$name:String!'],fields=['nameWithOwner'];
      batch.forEach((item,i)=>{variables['o'+i]=item.sha;declarations.push(`$o${i}:GitObjectID!`);fields.push(`b${i}:object(oid:$o${i}){__typename ... on Blob{oid byteSize isBinary isTruncated text}}`);});
      const query=`query PinnedPrivateLearningBlobs(${declarations.join(',')}){repository(owner:$owner,name:$name){${fields.join(' ')}}}`;
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);let value;
      try{
        const response=await this.fetcher('https://api.github.com/graphql',{method:'POST',redirect:'manual',credentials:'omit',signal:controller.signal,headers:{Authorization:`Bearer ${this.token}`,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({query,variables})});
        if(this.quotaGate.observe(response))this.quotaGate.reject();
        if(!response.ok||response.redirected){const error=new LearningError('github_request_failed');error.status=response.status;throw error;}
        let size=0;const chunks=[];
        for await(const chunk of response.body??[]){size+=chunk.length;if(size>4*1024*1024)fail();chunks.push(chunk);}
        value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      }catch(error){if(error instanceof LearningError)throw error;throw new LearningError('transport_failure');}finally{clearTimeout(timer);controller.abort();}
      if(Array.isArray(value?.errors)&&value.errors.some(e=>e?.type==='RATE_LIMITED'))this.quotaGate.reject();
      if(value?.errors||value?.data?.repository?.nameWithOwner!==this.repository)fail();
      const staged=[];
      for(let i=0;i<batch.length;i++){
        const item=batch[i],b=value.data.repository['b'+i];
        if(b?.__typename!=='Blob'||b.oid!==item.sha||b.byteSize!==item.size||b.isBinary!==false||b.isTruncated!==false||typeof b.text!=='string')fail();
        const bytes=Buffer.from(b.text,'utf8');if(bytes.length!==item.size||blobOid(bytes)!==item.sha)fail();staged.push([item,bytes]);
      }
      for(const [item,bytes] of staged){this.rememberImmutable('/git/blobs/'+item.sha,{sha:item.sha,size:item.size,encoding:'base64',content:bytes.toString('base64')});out.set(item.sha,bytes);}
    }
    return out;
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
