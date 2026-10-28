// Explicit future deployment entry point. No installer, credential creation,
// tunnel, activation or runner registration. Default configuration stays held.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {LearningError,requireTrustedAncestor} from './git-artifacts.mjs';
import {GENRES} from './receipt.mjs';
import {createGitHubQuotaGate} from './github-quota.mjs';
import {PROOF_REPOSITORY,githubObservationProof} from './observation-proof.mjs';
import {createBrokerGitHub} from './broker-github.mjs';
import {createBrokerAppTokenProvider} from './broker-app-auth.mjs';
import {createResearchWorkerDispatch} from './research-worker-dispatch.mjs';
import {createBrokerRequestStore} from './broker-request-store.mjs';
import {createResearchBrokerAdapter} from './research-broker.mjs';
import {createInterpretationBrokerAdapter} from './interpretation-broker.mjs';
import {createInterpretationWorkerDispatch} from './interpretation-worker-dispatch.mjs';
import {startLocalResearchMcpHost} from './research-mcp-host.mjs';

function readFile(file,max){
 if(typeof file!=='string'||!path.isAbsolute(file))throw new LearningError('invalid_private_host_config');
 const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1||stat.size>max)throw new LearningError('invalid_private_host_config');
 const raw=fs.readFileSync(file),text=raw.toString('utf8');if(!Buffer.from(text).equals(raw))throw new LearningError('invalid_private_host_config');return text;
}
function configAt(file){
 const c=JSON.parse(readFile(file,8192));
 if(!['access,github_app,private_directory_verified,request_directory,schema_version,task_access_enabled',
  'access,github_app,interpretation_access_enabled,private_directory_verified,request_directory,schema_version,task_access_enabled'].includes(Object.keys(c).sort().join())
  ||c.schema_version!==1||typeof c.task_access_enabled!=='boolean'||typeof c.private_directory_verified!=='boolean'
  ||c.interpretation_access_enabled!==undefined&&typeof c.interpretation_access_enabled!=='boolean')throw new LearningError('invalid_private_host_config');
 return c;
}
export async function startResearchBrokerHost({configFile,port=0,env=process.env}={}){
 const config=configAt(configFile);
 const allowed=async()=>{try{return env.PRIVATE_RESEARCH_BROKER_ALLOWED==='true'&&configAt(configFile).task_access_enabled===true;}catch{return false;}};
 const interpretationAllowed=async()=>{try{return env.PRIVATE_INTERPRETATION_BROKER_ALLOWED==='true'&&configAt(configFile).interpretation_access_enabled===true;}catch{return false;}};
 if(!config.task_access_enabled&&config.interpretation_access_enabled!==true)return startLocalResearchMcpHost({access:config.access,port});
 if(config.task_access_enabled&&!await allowed())throw new LearningError('private_task_access_held');
 if(config.interpretation_access_enabled===true&&!await interpretationAllowed())throw new LearningError('private_interpretation_access_held');
 const app=config.github_app;
 if(!app||Object.keys(app).sort().join()!=='app_id,installation_id,private_key_file')throw new LearningError('private_app_credentials_required');
 const getToken=createBrokerAppTokenProvider({appId:app.app_id,installationId:app.installation_id,privateKey:readFile(app.private_key_file,16384)});
 const store=createBrokerRequestStore({directory:config.request_directory,privateDirectoryVerified:config.private_directory_verified});
 const quotaGate=createGitHubQuotaGate({initialUntil:store.quotaDeadline(),onPause:until=>store.recordQuota(until)});
 const api=createBrokerGitHub({repository:PROOF_REPOSITORY,getToken,quotaGate}),publicApis=Object.fromEntries(GENRES.map(g=>[g,createBrokerGitHub({repository:`Lewdcifer666/wtf-${g}-stremio`,getToken,quotaGate})]));
 const proof=githubObservationProof({assertTriggerAncestor:(trigger,executed)=>requireTrustedAncestor(api,trigger,executed)});
 const broker=config.task_access_enabled?createResearchBrokerAdapter({api,publicApis,proof,store,dispatchWorker:createResearchWorkerDispatch({getToken,quotaGate}),taskAccessAllowed:allowed,resultWaitMs:30000}):undefined;
 const interpretationBroker=config.interpretation_access_enabled===true?createInterpretationBrokerAdapter({api,proof,store,dispatchWorker:createInterpretationWorkerDispatch({getToken,quotaGate}),interpretationAccessAllowed:interpretationAllowed}):undefined;
 const host=await startLocalResearchMcpHost({access:config.access,adapter:broker,interpretationAdapter:interpretationBroker,port});
 let reconciling=false;
 const timer=setInterval(()=>{
  if(reconciling)return;reconciling=true;
  void (async()=>{
   if(broker&&await allowed())await broker.reconcilePending();
   if(interpretationBroker&&await interpretationAllowed())await interpretationBroker.reconcilePending();
  })().catch(()=>{console.error('private-broker: reconciliation_pending');}).finally(()=>{reconciling=false;});
 },30000);timer.unref();
 return Object.freeze({...host,close:async()=>{clearInterval(timer);await host.close();}});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 Promise.resolve().then(async()=>{
  if(args.length!==4||args[0]!=='--config'||args[2]!=='--port'||!/^\d{1,5}$/.test(args[3]))throw new LearningError('invalid_private_host_config');
  const host=await startResearchBrokerHost({configFile:args[1],port:Number(args[3])});
  console.log('private-broker: authenticated local transport ready; activation unchanged');
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void host.close().then(()=>process.exit(0));});
 }).catch(()=>{console.error('private-broker: start_failed_closed');process.exitCode=1;});
}
