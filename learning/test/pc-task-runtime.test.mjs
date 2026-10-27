import assert from 'node:assert/strict';
import {test} from 'node:test';
import path from 'node:path';
import {runtimeDigest,runtimeNames,runtimeLabel} from '../pc-runtime-policy.mjs';
import {validatePrivateTaskRuntimeConfig,privateTaskRuntimePlan,privateTaskAddresses,privateTaskBrokerConfig,
 privateTaskBrokerFilename,verifyPrivateTaskRuntimePaths} from '../pc-task-runtime-policy.mjs';
import {supervisePrivateTaskRuntime} from '../pc-runtime-supervisor.mjs';
const root='C:\\Synthetic\\WTFStremioPrivate\\connection',access={issuer:'https://synthetic.cloudflareaccess.com',audience:'a'.repeat(64),subject:'synthetic-owner',email:'owner@example.invalid'};
const config=()=>({schema_version:2,remote_service_enabled:false,task_access_enabled:false,interpretation_access_enabled:false,
 deployment_id:'11111111-1111-4111-8111-111111111111',source_revision:'a'.repeat(40),directory:root,access_sha256:runtimeDigest(access),
 images:Object.fromEntries(['app','tools','connector','namespace'].map((name,i)=>[name,'sha256:'+String(i+1).repeat(64)]))});
const endpoints={issuerAddresses:['104.16.1.2'],githubAddresses:['140.82.114.5'],oidcAddresses:['185.199.108.133']},cycleId='22222222-2222-4222-8222-222222222222';
const rules=(script,family)=>script.split('\n').filter(l=>l.startsWith(family+' -w ')).map(l=>l.slice((family+' -w ').length)).join('\n');

test('private runtime is a separate closed configuration and cannot expand a held deployment implicitly',()=>{
 const c=config();assert.equal(validatePrivateTaskRuntimeConfig(c).remote_service_enabled,false);
 for(const change of [{schema_version:1},{remote_service_enabled:true},{task_access_enabled:'true'},{interpretation_access_enabled:'true'},
  {github_app:{app_id:'other'}},{egress:['openai.com']},{command:'untrusted'},{directory:'C:\\temp'},{images:{...c.images,app:'node:latest'}}])assert.throws(()=>validatePrivateTaskRuntimeConfig({...c,...change}));
 const active={...c,remote_service_enabled:true,interpretation_access_enabled:true};assert.equal(validatePrivateTaskRuntimeConfig(active).task_access_enabled,false);
 const broker=privateTaskBrokerConfig(active,access);assert.equal(broker.task_access_enabled,false);assert.equal(broker.interpretation_access_enabled,true);
 assert.deepEqual(broker.github_app,{app_id:5479574,installation_id:175447684,private_key_file:'/run/secrets/runtime-app.pem'});
});

test('private runtime plan mounts exactly the protected key and journal and retains independent deadlines and least privilege',()=>{
 const c={...config(),remote_service_enabled:true,interpretation_access_enabled:true},p=privateTaskRuntimePlan(c,{cycleId,...endpoints}),text=JSON.stringify(p);
 assert(p.app.includes('PRIVATE_RESEARCH_BROKER_ALLOWED=false'));assert(p.app.includes('PRIVATE_INTERPRETATION_BROKER_ALLOWED=true'));
 const mounts=p.app.filter(v=>v.startsWith('type=bind,'));assert.equal(mounts.length,4);
 assert(mounts.some(v=>v.endsWith('target=/run/secrets/runtime-app.pem,readonly')));assert(mounts.some(v=>v.endsWith('target=/run/private-requests')));
 assert(mounts.some(v=>v.includes(privateTaskBrokerFilename(c))));
 for(const args of [p.app,p.connector,p.namespace]){assert(args.includes('--read-only'));assert(args.includes('--pull=never'));assert(args.includes('1800'));assert(args.includes('--restart=no'));}
 assert(!p.connector.join(' ').includes('runtime-app.private-key'));assert(!p.connector.join(' ').includes('private-requests'));
 assert(!/docker\.sock|--privileged|--publish|--network","host|data\/feedback|OpenAI|openai\.com/.test(text));
 assert(!p.app.includes('NET_ADMIN'));assert(!p.connector.includes('NET_ADMIN'));assert(p.install_policy.includes('NET_ADMIN'));
 const hostPins=p.namespace.flatMap((v,i)=>v==='--add-host'?[p.namespace[i+1]]:[]);
 assert.deepEqual(hostPins,[`api.github.com:${endpoints.githubAddresses[0]}`,`token.actions.githubusercontent.com:${endpoints.oidcAddresses[0]}`]);
 assert(!p.app.includes('--add-host'));assert(!p.connector.includes('--add-host'));assert(!p.app.some(v=>v.includes('NODE_TLS_REJECT_UNAUTHORIZED')));
 assert.equal(p.task_access_enabled,false);assert.equal(p.interpretation_access_enabled,true);
});

test('GitHub host mappings deterministically choose only a validated firewall address without disabling TLS or broadening DNS',()=>{
 const c={...config(),remote_service_enabled:true,interpretation_access_enabled:true};
 const e={...endpoints,githubAddresses:['140.82.121.6','140.82.121.5'],oidcAddresses:['140.82.114.22','140.82.112.22']};
 const p=privateTaskRuntimePlan(c,{cycleId,...e}),pins=p.namespace.flatMap((v,i)=>v==='--add-host'?[p.namespace[i+1]]:[]);
 assert.deepEqual(pins,['api.github.com:140.82.121.5','token.actions.githubusercontent.com:140.82.112.22']);
 assert(p.firewall.includes('-d 140.82.121.5/32'));assert(p.firewall.includes('-d 140.82.112.22/32'));
 assert.throws(()=>privateTaskRuntimePlan(c,{cycleId,...e,githubAddresses:['127.0.0.1']}));
 assert(!JSON.stringify(p).includes('host-gateway'));assert(!p.app.includes('--network=host'));
 for(const args of [p.app,p.connector]){assert(args.includes('container:wtf-private-runtime-namespace'));for(const forbidden of ['--add-host','--hostname','--dns','--dns-search','--dns-option','--mac-address','--publish','--publish-all','--expose'])assert(!args.includes(forbidden));}
});

test('private runtime allows only a bounded union of public IPv4 addresses for fixed owner, GitHub and OIDC endpoints',()=>{
 assert.equal(privateTaskAddresses(endpoints).length,3);
 for(const bad of [{...endpoints,githubAddresses:['127.0.0.1']},{...endpoints,oidcAddresses:['169.254.169.254']},
  {...endpoints,githubAddresses:[]},{...endpoints,githubAddresses:['140.82.114.5;echo bad']}])assert.throws(()=>privateTaskAddresses(bad));
 assert.throws(()=>privateTaskAddresses({...endpoints,githubAddresses:Array.from({length:17},(_,i)=>'140.82.114.'+(i+1))}));
});

test('private path verifier checks only fixed owner ACLs and file metadata, never reading or printing a key',()=>{
 const previous=process.env.USERPROFILE,oldRoot=process.env.SystemRoot,oldModules=process.env.PSModulePath;
 process.env.USERPROFILE='C:\\Synthetic';process.env.SystemRoot='C:\\Windows';process.env.PSModulePath='C:\\Unrelated\\PowerShell7\\Modules';let calls=0;
 try{
  const files={lstatSync:file=>({isFile:()=>file.endsWith('.pem'),isDirectory:()=>file.endsWith('requests'),isSymbolicLink:()=>false,size:3000}),realpathSync:{native:file=>file},
   readFileSync(){throw Error('MUST_NOT_READ_A_KEY');}};
  const run=(binary,args,options)=>{calls++;assert.equal(binary,'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');assert.equal(options.windowsHide,true);
   assert.equal(options.env.PSModulePath,'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules');assert.equal(process.env.PSModulePath,'C:\\Unrelated\\PowerShell7\\Modules');
   const script=Buffer.from(args.at(-1),'base64').toString('utf16le');assert(script.includes('Get-Acl -LiteralPath'));assert(script.includes("$allowed=@($owner,'S-1-5-18')"));
   assert(script.includes('GetOwner([Security.Principal.SecurityIdentifier])'));assert(script.includes('Get-ChildItem -LiteralPath $journal -Force'));assert(script.includes('$entries.Count -gt 100000'));
   assert(!script.includes('Get-Content'));assert(!script.includes('Register-ScheduledTask'));return 'PRIVATE_TASK_PATHS_VERIFIED\r\n';};
  assert.equal(verifyPrivateTaskRuntimePaths(root,{platform:'win32',files,run}),true);assert.equal(calls,1);
  assert.throws(()=>verifyPrivateTaskRuntimePaths(root,{platform:'linux',files,run}));assert.equal(calls,1);
  assert.throws(()=>verifyPrivateTaskRuntimePaths(root,{platform:'win32',files,run:()=> 'unsafe'}));
 }finally{if(previous===undefined)delete process.env.USERPROFILE;else process.env.USERPROFILE=previous;
  if(oldRoot===undefined)delete process.env.SystemRoot;else process.env.SystemRoot=oldRoot;
  if(oldModules===undefined)delete process.env.PSModulePath;else process.env.PSModulePath=oldModules;}
});

function fixture({enabled=true}={}){
 const c={...config(),remote_service_enabled:enabled,interpretation_access_enabled:enabled},configFile=path.win32.join(root,'task-runtime.json'),map=new Map(),reads=[],commands=[],states=new Map();
 const data=(name,value)=>map.set(path.win32.join(root,name),Buffer.from(typeof value==='string'?value:JSON.stringify(value)));
 data('task-runtime.json',c);data('access.json',access);data('resolv.conf','nameserver 1.1.1.1\noptions timeout:2 attempts:1\n');data('tunnel-token.txt','SYNTHETIC_SECRET');
 const files={readFileSync(file,encoding){reads.push(file);const value=map.get(file);if(!value)throw Error('missing');return encoding?value.toString():value;},
  lstatSync:file=>({isFile:()=>map.has(file),isDirectory:()=>!map.has(file),isSymbolicLink:()=>false,size:map.get(file)?.length??0}),
  realpathSync:{native:file=>file},existsSync:()=>false,mkdirSync(){},writeFileSync(file,text,{flag}={}){if(flag==='wx'&&map.has(file))throw Object.assign(Error('exists'),{code:'EEXIST'});map.set(file,Buffer.from(text));}};
 let stopped=false,started=0,verified=0,resolved=0,now=0;
 const docker=args=>{commands.push(args);
  if(args[0]==='ps')return states.has(args.at(-1).slice(7,-1))?'synthetic':'';
  if(args[0]==='inspect')return JSON.stringify([states.get(args[1])]);
  if(args[0]==='image')return JSON.stringify([{Id:args[2]}]);
  if(args[0]==='rm'){states.delete(args[2]);return '';}
  if(args[0]==='exec')return '401';
  if(args[0]==='run'&&args.includes('--name')){const name=args[args.indexOf('--name')+1];states.set(name,{Name:'/'+name,Config:{Labels:{[runtimeLabel]:c.deployment_id}},State:{Running:true}});if(name===runtimeNames[2])started++;return 'synthetic';}
  if(args[0]==='run'&&args.at(-1).endsWith(' -S'))return rules(privateTaskRuntimePlan(c,{cycleId,...endpoints}).firewall,args.at(-1).split(' ')[0]);
  if(args[0]==='run')return '';throw Error('unexpected Docker operation');
 };
 return {c,configFile,reads,commands,states,data,stop:()=>{stopped=true;},get started(){return started;},get verified(){return verified;},get resolved(){return resolved;},
  options:{configFile,files,docker,clock:()=>now,shouldStop:()=>stopped,acquireLease:async()=>({close:async()=>{}}),
   verifyPrivatePaths:async()=>{verified++;return true;},resolveEndpoints:async()=>{resolved++;assert.equal(verified,1);return endpoints;},sleep:async ms=>{now+=ms;stopped=true;}}};
}

test('disabled task runtime never reads private paths, resolves network or invokes Docker',async()=>{
 const f=fixture({enabled:false});assert.deepEqual(await supervisePrivateTaskRuntime(f.options),{state:'disabled'});
 assert.equal(f.verified,0);assert.equal(f.resolved,0);assert.equal(f.commands.length,0);assert.deepEqual(f.reads,[f.configFile]);
});

test('approved-mode supervisor checks private paths before network policy, shares lifecycle containment and cleans owned containers',async()=>{
 const f=fixture();assert.deepEqual(await supervisePrivateTaskRuntime(f.options),{state:'stopped_private_tasks'});assert.equal(f.started,1);assert.equal(f.states.size,0);
 assert.equal(f.verified,1);assert.equal(f.resolved,1);assert(!f.reads.some(p=>p.endsWith('.pem')||p.endsWith('tunnel-token.txt')));
 assert(!JSON.stringify(f.commands).includes('SYNTHETIC_SECRET'));
 const launches=f.commands.filter(a=>a[0]==='run');assert(launches[0].includes(runtimeNames[0]));assert(launches[1].includes('NET_ADMIN'));
 assert.deepEqual(f.commands.filter(a=>a[0]==='rm').map(a=>a[2]),[...runtimeNames].reverse());
});

test('failed private ACL verification cannot launch a namespace, broker, connector or resolve new egress',async()=>{
 const f=fixture();f.options.verifyPrivatePaths=async()=>{f.stop();return false;};await supervisePrivateTaskRuntime(f.options);
 assert.equal(f.resolved,0);assert.equal(f.started,0);assert(!f.commands.some(a=>a[0]==='run'));
});

test('changing task permissions requires a new reviewed configuration and stops the current private cycle',async()=>{
 const f=fixture(),sleep=f.options.sleep;f.options.sleep=async ms=>{await sleep(ms);f.data('task-runtime.json',{...f.c,task_access_enabled:true});};
 await assert.rejects(supervisePrivateTaskRuntime(f.options));assert.equal(f.started,1);assert.equal(f.states.size,0);
});
