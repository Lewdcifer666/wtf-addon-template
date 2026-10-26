// Private PC request journal; interpretation submissions contain personal quotes.
// Never log it, put it in Git, or return it through health/discovery.
// Deployment must verify owner/SYSTEM-only ACLs before selecting this directory.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {LearningError} from './git-artifacts.mjs';
import {stableJson,digest} from './interpretation.mjs';
import {validateWorkerCall,workerRequestHash} from './research-worker.mjs';
import {validateInterpretationWorkerCall,interpretationWorkerHash} from './interpretation-worker.mjs';
const fail=()=>{throw new LearningError('invalid_task_journal');};
const hash=s=>/^[a-f0-9]{64}$/.test(s??'');
export const brokerCallFamily=call=>['request','page','validate','submit'].includes(call?.operation)?'interpretation':'research';
const validateCall=call=>brokerCallFamily(call)==='interpretation'?validateInterpretationWorkerCall(call):validateWorkerCall(call);
export const brokerCallHash=call=>brokerCallFamily(call)==='interpretation'?interpretationWorkerHash(call):workerRequestHash(call);
const identity=call=>digest(stableJson(call.operation==='search'
 ?{operation:'search',task_token:call.request.task_token,request_id:call.request.request_id}
 :call.operation==='submit'?{operation:'submit',source_revision:call.request.source_revision,request_id:call.request.request_id}:call));
export function createBrokerRequestStore({directory,privateDirectoryVerified=false}={}){
 if(privateDirectoryVerified!==true||typeof directory!=='string'||!path.isAbsolute(directory))fail();
 const named=path.resolve(directory),info=fs.lstatSync(named);
 if(!info.isDirectory()||info.isSymbolicLink())fail();
 // Canonicalize Windows short names once; every child remains under this fixed
 // verified root. The deployment ACL check must inspect this resolved path.
 const root=fs.realpathSync.native(named);
 for(let parent=root;;parent=path.dirname(parent)){
  if(fs.existsSync(path.join(parent,'.git')))fail();
  if(path.dirname(parent)===parent)break;
 }
 const file=(name)=>{if(!/^[a-f0-9]{64}-(?:request|complete|dispatch-[1-3])\.json$/.test(name))fail();return path.join(root,name);};
 const read=(name)=>{
  const p=file(name);let stat;try{stat=fs.lstatSync(p);}catch(e){if(e.code==='ENOENT')return null;throw e;}
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1||stat.size>96*1024)fail();
  const raw=fs.readFileSync(p),text=raw.toString('utf8');if(!Buffer.from(text).equals(raw))fail();
  let value;try{value=JSON.parse(text);}catch{fail();}return value;
 };
 const once=(name,value)=>{
  const destination=file(name),temporary=destination+'.tmp-'+randomUUID();let fd,created=false;
  try{
   fd=fs.openSync(temporary,'wx',0o600);created=true;fs.writeFileSync(fd,stableJson(value));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
   // Atomic no-replace creation. A crash can leave an ignored private temporary
   // file, but never a partially written request mistaken for durable intent.
   fs.linkSync(temporary,destination);return true;
  }catch(e){if(e.code!=='EEXIST')throw e;return false;}
  finally{if(fd!==undefined)fs.closeSync(fd);if(created)fs.unlinkSync(temporary);}
 };
 const requestAt=name=>{
  const value=read(name);if(!value)return null;
  if(Object.keys(value).sort().join()!=='call,request_hash,schema_version'||value.schema_version!==1
   ||value.request_hash!==brokerCallHash(value.call)||name!==identity(value.call)+'-request.json')fail();
  validateCall(value.call);
  return value;
 };
 const attempts=key=>{
  if(!hash(key))fail();const found=[];
  for(let attempt=1;attempt<=3;attempt++){
   const value=read(`${key}-dispatch-${attempt}.json`);if(!value)continue;
   if(Object.keys(value).sort().join()!=='attempt,request_hash,schema_version,started_at'||value.schema_version!==1
    ||value.request_hash!==key||value.attempt!==attempt||!Number.isFinite(Date.parse(value.started_at))
    ||new Date(value.started_at).toISOString()!==value.started_at)fail();found.push(value);
  }
  if(found.some((v,i)=>v.attempt!==i+1))fail();return found;
 };
 const completion=key=>{
  if(!hash(key))fail();const value=read(key+'-complete.json');if(!value)return null;
  if(Object.keys(value).sort().join()!=='request_hash,result_commit,schema_version'||value.schema_version!==1
   ||value.request_hash!==key||!/^[a-f0-9]{40}$/.test(value.result_commit??''))fail();return value;
 };
 return Object.freeze({
  async reserve(input){
   const call=validateCall(input),name=identity(call)+'-request.json',value={schema_version:1,request_hash:brokerCallHash(call),call};
   once(name,value);const saved=requestAt(name);
   if(stableJson(saved)!==stableJson(value))throw new LearningError('task_request_conflict');
   return saved;
  },
  async pending(){
   const names=fs.readdirSync(root);
   if(names.length>100000||names.some(n=>!/^[a-f0-9]{64}-(?:request|complete|dispatch-[1-3])\.json(?:\.tmp-[a-f0-9-]{36})?$/.test(n)))fail();
   return names.filter(n=>n.endsWith('-request.json')).sort().map(requestAt).filter(request=>{
    return completion(request.request_hash)===null;
   }).sort((a,b)=>Number(attempts(b.request_hash).length>0)-Number(attempts(a.request_hash).length>0)||a.request_hash.localeCompare(b.request_hash));
  },
  async complete(key,commit){
   if(!hash(key)||!/^[a-f0-9]{40}$/.test(commit??''))fail();
   const name=key+'-complete.json',value={schema_version:1,request_hash:key,result_commit:commit};once(name,value);
   if(stableJson(read(name))!==stableJson(value))fail();
  },
  async completed(key){return completion(key);},
  async reserveDispatch(key,now){
   const old=attempts(key),time=Date.parse(now);
   if(!Number.isFinite(time)||new Date(time).toISOString()!==now)fail();
   // Five-minute job bound plus queue allowance; never loop in a task call.
   if(old.length>=3||(old.length&&time-Date.parse(old.at(-1).started_at)<10*60*1000))return false;
   // One outstanding workflow dispatch across the private PC journal. GitHub
   // concurrency has one pending slot and can otherwise cancel queued work.
   for(const name of fs.readdirSync(root).filter(n=>/^[a-f0-9]{64}-dispatch-[1-3]\.json$/.test(n))){
    const other=name.slice(0,64);if(other===key||completion(other))continue;
    const lease=attempts(other).at(-1);
    if(lease&&time-Date.parse(lease.started_at)<10*60*1000)return false;
   }
   const attempt=old.length+1;return once(`${key}-dispatch-${attempt}.json`,{schema_version:1,request_hash:key,attempt,started_at:now});
  }
 });
}
