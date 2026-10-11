import {LearningError} from './git-artifacts.mjs';
export class GitHub {
  constructor(repository,token,{writable=false}={}){
    if(!/^Lewdcifer666\/wtf-(?:scifi-feedback|(?:action|anime|fantasy|mystery|scifi|thriller)-stremio)$/.test(repository))throw new LearningError('unexpected_repository');
    if(!token)throw new LearningError('missing_credentials');
    this.repository=repository;this.token=token;this.writable=writable;
  }
  async request(method,route,body){
    if(!route.startsWith('/')||route.includes('://'))throw new LearningError('invalid_api_route');
    if(method!=='GET'&&(!this.writable||this.repository!=='Lewdcifer666/wtf-scifi-feedback'||!/^\/git\/(blobs|trees|commits|refs)$/.test(route)))throw new LearningError('unauthorized_write');
    for(let attempt=0;attempt<3;attempt++){
      const response=await fetch(`https://api.github.com/repos/${this.repository}${route==='/'?'':route}`,{method,headers:{Authorization:`Bearer ${this.token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
      if(response.ok)return response.json();
      if(method==='GET'&&response.status>=500&&attempt<2){await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));continue;}
      const error=new LearningError('github_request_failed');error.status=response.status;throw error;
    }
  }
  get(route){return this.request('GET',route);}
  post(route,body){return this.request('POST',route,body);}
  async optional(route){try{return await this.get(route);}catch(error){if(error.status===404)return null;throw error;}}
  async pinMain(){const ref=await this.get('/git/ref/heads/main');return this.get(`/git/commits/${ref.object.sha}`);}
}
