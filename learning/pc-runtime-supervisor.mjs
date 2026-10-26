// Windows operator entry point, never exposed as an MCP/task tool. Nothing runs
// by default. Installation and --run-approved-runtime require a separate human
// persistent-transport decision; neither authorizes private learning.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {Resolver} from 'node:dns/promises';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runtimeDigest,validateHeldRuntimeConfig,validateRuntimeAccess,heldBrokerConfig,heldRuntimePlan,assertHeldRuntimeFirewall,
 runtimeLabel,runtimeNames,runtimeCycleSeconds,isPublicRuntimeIpv4} from './pc-runtime-policy.mjs';
import {validatePrivateTaskRuntimeConfig,privateTaskRuntimePlan,privateTaskBrokerConfig,privateTaskBrokerFilename,
 assertPrivateTaskRuntimeFirewall,verifyPrivateTaskRuntimePaths} from './pc-task-runtime-policy.mjs';
const fail=()=>{throw Error('held_runtime_setup_pending');};
export function readRuntimeJson(file,max=16384,files=fs){
 const stat=files.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1||stat.size>max)fail();
 const raw=files.readFileSync(file),text=raw.toString('utf8');if(!Buffer.from(text).equals(raw))fail();return JSON.parse(text);
}
export async function resolveRuntimeIssuer(issuer){
 if(!/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(issuer))fail();
 return resolveFixedRuntimeHost(new URL(issuer).hostname);
}
async function resolveFixedRuntimeHost(hostname){
 const resolver=new Resolver({timeout:3000,tries:1});resolver.setServers(['1.1.1.1']);
 let timer;try{
  const addresses=await Promise.race([resolver.resolve4(hostname),new Promise((_,reject)=>{timer=setTimeout(()=>{resolver.cancel();reject(Error('held_runtime_dns_pending'));},5000);})]);
  if(!Array.isArray(addresses)||!addresses.length||addresses.length>16||addresses.some(a=>!isPublicRuntimeIpv4(a)))fail();
  return [...new Set(addresses)];
 }finally{clearTimeout(timer);resolver.cancel();}
}
export async function resolvePrivateTaskRuntimeEndpoints(issuer){
 const [issuerAddresses,githubAddresses,oidcAddresses]=await Promise.all([resolveRuntimeIssuer(issuer),
  resolveFixedRuntimeHost('api.github.com'),resolveFixedRuntimeHost('token.actions.githubusercontent.com')]);
 return {issuerAddresses,githubAddresses,oidcAddresses};
}
export async function acquireRuntimeLease({pipe='\\\\.\\pipe\\WTF-Stremio-Private-Held-Runtime',createServer=net.createServer}={}){
 const server=createServer(socket=>{socket.on('error',()=>{});socket.destroy();});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen({path:pipe,readableAll:false,writableAll:false},resolve);});
 server.on('error',()=>{});return {close:()=>new Promise(resolve=>server.close(resolve))};
}
export const superviseHeldRuntime=options=>superviseRuntime(options,false);
export const supervisePrivateTaskRuntime=options=>superviseRuntime(options,true);
async function superviseRuntime({configFile,docker,resolveIssuer=resolveRuntimeIssuer,resolveEndpoints=resolvePrivateTaskRuntimeEndpoints,
 verifyPrivatePaths=verifyPrivateTaskRuntimePaths,clock=()=>Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),shouldStop=()=>false,record=()=>{},acquireLease=acquireRuntimeLease,files=fs}={},privateTasks){
 const validate=privateTasks?validatePrivateTaskRuntimeConfig:validateHeldRuntimeConfig;
 const original=validate(readRuntimeJson(configFile,16384,files));
 // Default/disabled exits before acquiring a pipe, resolving DNS, reading the
 // Access/tunnel files or invoking Docker. A flag is an operator gate, not a
 // replacement for the human approval required to install/start this program.
 if(!original.remote_service_enabled)return {state:'disabled'};
 if(path.win32.normalize(configFile)!==path.win32.join(original.directory,privateTasks?'task-runtime.json':'runtime.json')||typeof docker!=='function')fail();
 const rootInfo=files.lstatSync(original.directory);
 if(!rootInfo.isDirectory()||rootInfo.isSymbolicLink()||files.realpathSync.native(original.directory).toLowerCase()!==original.directory.toLowerCase())fail();
 for(let p=original.directory;;p=path.win32.dirname(p)){
  if(files.existsSync(path.win32.join(p,'.git')))fail();if(path.win32.dirname(p)===p)break;
 }
 const pin=c=>runtimeDigest({...c,remote_service_enabled:false}),expected=pin(original);
 const enabled=()=>{
  const current=validate(readRuntimeJson(configFile,16384,files));if(pin(current)!==expected)fail();
  return current.remote_service_enabled&&!shouldStop();
 };
 const lease=await acquireLease(),label=original.deployment_id;let nextAttempt=0;
 const inspect=name=>{const raw=docker(['ps','-aq','--filter',`name=^/${name}$`]);if(!raw)return null;
  const values=JSON.parse(docker(['inspect',name]));if(values.length!==1||values[0].Name!=='/'+name||values[0].Config?.Labels?.[runtimeLabel]!==label)fail();return values[0];};
 const cleanup=()=>{for(const name of [...runtimeNames].reverse()){if(inspect(name))docker(['rm','-f',name]);}};
 const ensureFile=(name,text)=>{
  const file=path.win32.join(original.directory,name);try{files.writeFileSync(file,text,{flag:'wx',mode:0o600});}
  catch(error){if(error.code!=='EEXIST')throw error;const stat=files.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||files.readFileSync(file,'utf8')!==text)fail();}
 };
 try{
  // The OS releases the exclusive named pipe on a crash. Only its next owner
  // may reconcile the fixed, exactly labelled stale containers; no PID guessing.
  cleanup();
  while(enabled()){
   const time=clock();if(!Number.isFinite(time))fail();
   if(time<nextAttempt){await sleep(2000);continue;}nextAttempt=time+30000;
   let started=false;
   try{
    for(const image of Object.values(original.images)){const info=JSON.parse(docker(['image','inspect',image]));if(info.length!==1||info[0].Id!==image)fail();}
    const access=validateRuntimeAccess(readRuntimeJson(path.win32.join(original.directory,'access.json'),4096,files),original.access_sha256);
    const resolverFile=path.win32.join(original.directory,'resolv.conf');
    if(files.readFileSync(resolverFile,'utf8')!=='nameserver 1.1.1.1\noptions timeout:2 attempts:1\n')fail();
    // Read only metadata about the existing tunnel credential. The connector
    // reads it through its private mount; no token enters Node argv or logs.
    const token=files.lstatSync(path.win32.join(original.directory,'tunnel-token.txt'));
    if(!token.isFile()||token.isSymbolicLink()||token.size<1||token.size>8192)fail();
    if(privateTasks&&await verifyPrivatePaths(original.directory,{files})!==true)fail();
    const endpoints=privateTasks?await resolveEndpoints(access.issuer):{issuerAddresses:await resolveIssuer(access.issuer)};if(!enabled())break;
    const cycleId=randomUUID(),plan=(privateTasks?privateTaskRuntimePlan:heldRuntimePlan)(original,{cycleId,...endpoints});
    const cycleDirectory=path.win32.dirname(plan.policy_file);files.mkdirSync(cycleDirectory,{recursive:true});
    if(files.realpathSync.native(cycleDirectory).toLowerCase()!==cycleDirectory.toLowerCase())fail();
    files.writeFileSync(plan.policy_file,plan.firewall,{flag:'wx',mode:0o600});
    ensureFile(privateTasks?privateTaskBrokerFilename(original):'runtime-broker.json',JSON.stringify(privateTasks?privateTaskBrokerConfig(original,access):heldBrokerConfig(access))+'\n');
    docker(plan.namespace);docker(plan.install_policy);
    // Before the connector or authenticated host exists, confirm both firewall
    // families retain DROP policies. Detailed command/rule tests run in CI.
    const mode='container:'+runtimeNames[0];
    for(const family of ['iptables','ip6tables']){
     const rules=docker(['run','--rm','--pull=never','--network',mode,'--read-only','--cap-drop','ALL','--cap-add','NET_ADMIN',
      '--security-opt','no-new-privileges','--log-driver=none','--entrypoint','/bin/sh',original.images.tools,'-c',family+' -S']);
     if(privateTasks)assertPrivateTaskRuntimeFirewall(endpoints,family,rules);else assertHeldRuntimeFirewall(endpoints.issuerAddresses,family,rules);
    }
    docker(plan.app);
    const health=docker(['exec',runtimeNames[1],'node','--input-type=module','-e',
     "let status;for(let i=0;i<20;i++){try{status=(await fetch('http://127.0.0.1:6505/healthz',{signal:AbortSignal.timeout(1000)})).status;break;}catch{await new Promise(r=>setTimeout(r,100));}}console.log(status);"]);
    if(health!=='401'||!enabled())fail();docker(plan.connector);started=true;record(privateTasks?'private_task_transport_started':'held_transport_started');
    const until=clock()+(runtimeCycleSeconds-30)*1000;
    while(enabled()&&clock()<until){
     for(const name of runtimeNames)if(!inspect(name)?.State?.Running)fail();
     await sleep(2000);
    }
   }catch{record(privateTasks?'private_task_runtime_pending':'held_runtime_pending');}
   finally{cleanup();if(started)record(privateTasks?'private_task_transport_stopped':'held_transport_stopped');}
   if(enabled())await sleep(2000);
  }
  return {state:privateTasks?'stopped_private_tasks':'stopped_held'};
 }finally{try{cleanup();}finally{await lease.close();}}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);let stopping=false;
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{stopping=true;});
 Promise.resolve().then(async()=>{
  if(args.length!==3||!['--check','--run-approved-runtime','--check-task-runtime','--run-approved-task-runtime'].includes(args[0])||args[1]!=='--config'||process.platform!=='win32')fail();
  const privateTasks=args[0].includes('task-runtime'),config=(privateTasks?validatePrivateTaskRuntimeConfig:validateHeldRuntimeConfig)(readRuntimeJson(args[2]));
  if(args[0].startsWith('--check')){console.log(JSON.stringify({schema_version:1,configuration_valid:true,enabled:config.remote_service_enabled,task_access_enabled:config.task_access_enabled,
   ...(privateTasks?{interpretation_access_enabled:config.interpretation_access_enabled}:{}),starts_nothing:true}));return;}
  const docker=args=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:30000}).trim();
  const result=await (privateTasks?supervisePrivateTaskRuntime:superviseHeldRuntime)({configFile:args[2],docker,shouldStop:()=>stopping,
   record:stage=>console.log(JSON.stringify({stage,held:!privateTasks,publication:false}))});
  console.log(JSON.stringify(result));
 }).catch(()=>{console.error('held-runtime: setup_pending; no learning or automatic access expansion');process.exitCode=1;});
}
