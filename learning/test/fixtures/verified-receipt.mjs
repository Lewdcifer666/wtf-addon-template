import {gitBlobOid} from '../../interpretation.mjs';
import {loadVerifiedReceipt} from '../../receipt-loader.mjs';
export function receiptApi(inputs,expected){
 const base={sha:inputs.source.source_revision},commit={sha:'1'.repeat(40),parents:[base],tree:{sha:'2'.repeat(40)}};
 const ref={ref:`refs/heads/${expected.branch}`,object:{sha:commit.sha}};
 const tree={sha:commit.tree.sha,truncated:false,tree:Object.entries(expected.files).map(([name,bytes])=>({path:`learning-output/${name}`,mode:'100644',type:'blob',sha:gitBlobOid(bytes)}))};
 const comparison={status:'ahead',merge_base_commit:base,files:Object.keys(expected.files).map(name=>({filename:`learning-output/${name}`,status:'added'}))};
 const metadata={private:true,full_name:'Lewdcifer666/wtf-scifi-feedback',default_branch:'main'};
 const api={repository:metadata.full_name,optional:async route=>route===`/git/ref/heads/${expected.branch}`?ref:null,
  get:async route=>{
   if(route==='/')return metadata;
   if(route===`/git/commits/${ref.object.sha}`)return commit;
   if(route===`/git/trees/${commit.tree.sha}?recursive=1`)return tree;
   if(route===`/compare/${base.sha}...${ref.object.sha}`)return comparison;
   throw Error('Unexpected synthetic read');
  },post:async()=>{throw Error('Read-only receipt loader attempted a write');}};
 return {api,base,expected,ref,commit,tree,comparison,metadata,assertCurrent:async()=>{}};
}
export const verifiedReceipt=(inputs,expected)=>loadVerifiedReceipt(receiptApi(inputs,expected));
