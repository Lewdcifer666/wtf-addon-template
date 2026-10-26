import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import {runtimeDigest,validateHeldRuntimeConfig,validateRuntimeAccess,heldRuntimeFirewall,assertHeldRuntimeFirewall,
 heldRuntimePlan,heldBrokerConfig,isPublicRuntimeIpv4,runtimeLabel,runtimeNames} from '../pc-runtime-policy.mjs';
import {acquireRuntimeLease,superviseHeldRuntime} from '../pc-runtime-supervisor.mjs';
const directory='C:\\Synthetic\\WTFStremioPrivate\\connection';
const access={issuer:'https://synthetic-owner.cloudflareaccess.com',audience:'a'.repeat(64),subject:'synthetic-owner',email:'owner@example.invalid'};
const config=()=>({schema_version:1,remote_service_enabled:false,task_access_enabled:false,deployment_id:'11111111-1111-4111-8111-111111111111',
 source_revision:'a'.repeat(40),directory,access_sha256:runtimeDigest(access),images:Object.fromEntries(['app','tools','connector','namespace'].map((n,i)=>[n,'sha256:'+String(i+1).repeat(64)]))});
const cycleId='22222222-2222-4222-8222-222222222222',issuerAddresses=['104.16.1.2'];
const kernelRules=(firewall,family)=>firewall.split('\n').filter(l=>l.startsWith(family+' -w ')).map(l=>l.slice((family+' -w ').length)).join('\n');

test('held runtime configuration is closed, image-pinned, local and incapable of private task activation',()=>{
 const good=config();assert.equal(validateHeldRuntimeConfig(good).task_access_enabled,false);
 for(const change of [{task_access_enabled:true},{remote_service_enabled:'true'},{directory:'\\\\server\\share\\WTFStremioPrivate\\connection'},
  {directory:'C:\\repo,inject\\WTFStremioPrivate\\connection'},{directory:'C:\\temp'},
  {directory:'C:\\Users\\Synthetic\\AppData\\Local\\Packages\\Synthetic\\LocalCache\\Local\\WTFStremioPrivate\\connection'},{source_revision:'main'},
  {images:{...good.images,app:'node:latest'}},{images:{...good.images,extra:'sha256:'+'a'.repeat(64)}},{command:'untrusted'}])assert.throws(()=>validateHeldRuntimeConfig({...good,...change}));
 for(const change of [{email:'other@example.invalid'},{issuer:'https://evil.invalid'},{audience:'*'},{subject:'* owner'},{key:'synthetic'}])
  assert.throws(()=>validateRuntimeAccess({...access,...change},good.access_sha256));
 assert.deepEqual(validateRuntimeAccess(access,good.access_sha256),access);
 assert.equal(heldBrokerConfig(access).github_app,null);assert.equal(heldBrokerConfig(access).request_directory,null);
});

test('issuer firewall rejects private, reserved, malformed and injectable destinations',()=>{
 for(const address of ['127.0.0.1','10.1.2.3','172.16.1.2','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','198.18.1.1',
  '192.0.2.1','198.51.100.1','203.0.113.1','224.1.2.3','255.255.255.255','::1','104.16.1.2; echo bad','localhost']){
  assert.equal(isPublicRuntimeIpv4(address),false);assert.throws(()=>heldRuntimeFirewall([address]));
 }
 assert.throws(()=>heldRuntimeFirewall([]));assert.throws(()=>heldRuntimeFirewall([...issuerAddresses,...issuerAddresses]));
 const frozen=Object.freeze([...issuerAddresses]);assert(heldRuntimeFirewall(frozen).includes('--uid-owner 1000'));
});

test('exact firewall read-back rejects weaker or extra rules and accepts kernel formatting',()=>{
 const script=heldRuntimeFirewall(issuerAddresses),v4=kernelRules(script,'iptables'),v6=kernelRules(script,'ip6tables');
 assertHeldRuntimeFirewall(issuerAddresses,'iptables',v4.replaceAll('-p tcp','-p tcp -m tcp').replaceAll('ESTABLISHED,RELATED','RELATED,ESTABLISHED'));
 assertHeldRuntimeFirewall(issuerAddresses,'ip6tables',v6);
 for(const changed of [v4+'\n-A OUTPUT -j ACCEPT',v4.replace('-P OUTPUT DROP','-P OUTPUT ACCEPT'),v4.replace('--uid-owner 1000','--uid-owner 0'),
  v4.replace('--dport 443','--dport 80'),v4+'\n-A OTHER -j ACCEPT',v4+'\n-N OTHER'])assert.throws(()=>assertHeldRuntimeFirewall(issuerAddresses,'iptables',changed));
 assert.throws(()=>assertHeldRuntimeFirewall(issuerAddresses,'ip6tables',v6+'\n-A OUTPUT -j ACCEPT'));
});

test('held Docker plans have disjoint private mounts, no App key or journal, no host port/socket and independent expiry',()=>{
 const plan=heldRuntimePlan(config(),{cycleId,issuerAddresses}),all=JSON.stringify(plan);
 assert.equal(plan.enabled,false);assert.equal(plan.cycle_seconds,1800);
 assert(!/runtime-app\.private-key|\/run\/requests|docker\.sock|--privileged|--publish|--network","host|--restart=always/.test(all));
 for(const args of [plan.namespace,plan.app,plan.connector]){
  assert(args.includes('--read-only'));assert(args.includes('--restart=no'));assert(args.includes('--cap-drop'));assert(args.includes('ALL'));assert(args.includes('--pull=never'));
 }
 assert(plan.app.includes('PRIVATE_RESEARCH_BROKER_ALLOWED=false'));assert(!plan.app.join(' ').includes('tunnel-token'));
 assert(!plan.connector.join(' ').includes('runtime-broker'));assert(plan.connector.includes('--token-file'));assert(plan.connector.includes('quic'));
 assert(plan.install_policy.includes('NET_ADMIN'));assert(!plan.app.includes('NET_ADMIN'));assert(!plan.connector.includes('NET_ADMIN'));
 assert(!plan.firewall.includes('0.0.0.0/0'));assert(!plan.firewall.includes('api.github.com'));assert(!plan.firewall.includes('token.actions'));
 assert(plan.app.includes('1800'));assert(plan.connector.includes('1800'));assert(plan.namespace.includes('1800'));
});

function fixture({enabled=true}={}){
 const cfg={...config(),remote_service_enabled:enabled},configFile=path.win32.join(directory,'runtime.json'),map=new Map(),commands=[],states=new Map();
 const data=(name,value)=>map.set(path.win32.join(directory,name),Buffer.from(typeof value==='string'?value:JSON.stringify(value)));
 data('runtime.json',cfg);data('access.json',access);data('resolv.conf','nameserver 1.1.1.1\noptions timeout:2 attempts:1\n');data('tunnel-token.txt','synthetic token, never read by supervisor');
 const reads=[],files={
  readFileSync(file,encoding){reads.push(file);const bytes=map.get(file);if(!bytes)throw Object.assign(Error('missing'),{code:'ENOENT'});return encoding?bytes.toString(encoding):bytes;},
  lstatSync(file){const bytes=map.get(file);return {isFile:()=>!!bytes,isDirectory:()=>!bytes,isSymbolicLink:()=>false,size:bytes?.length??0};},
  existsSync:()=>false,realpathSync:{native:file=>file},mkdirSync(){},
  writeFileSync(file,text,{flag}={}){if(flag==='wx'&&map.has(file))throw Object.assign(Error('exists'),{code:'EEXIST'});map.set(file,Buffer.from(text));}
 };
 let now=0,stop=false,leases=0,closed=0,starts=0,dns=0;
 const docker=args=>{
  commands.push(args);
  if(args[0]==='ps')return states.has(args.at(-1).slice(7,-1))?'synthetic-container':'';
  if(args[0]==='inspect'){const value=states.get(args[1]);assert(value);return JSON.stringify([value]);}
  if(args[0]==='image')return JSON.stringify([{Id:args[2]}]);
  if(args[0]==='rm'){states.delete(args[2]);return '';}
  if(args[0]==='exec')return '401';
  if(args[0]==='run'&&args.includes('--name')){
   const name=args[args.indexOf('--name')+1];states.set(name,{Name:'/'+name,Config:{Labels:{[runtimeLabel]:cfg.deployment_id}},State:{Running:true}});
   if(name===runtimeNames[2])starts++;return 'synthetic-container';
  }
  if(args[0]==='run'&&args.at(-1).endsWith(' -S'))return kernelRules(heldRuntimeFirewall(issuerAddresses),args.at(-1).split(' ')[0]);
  if(args[0]==='run')return 'policy installed';throw Error('unexpected Docker operation');
 };
 return {cfg,configFile,map,commands,states,reads,files,data,get starts(){return starts;},get closed(){return closed;},get leases(){return leases;},get dns(){return dns;},
  stop:()=>{stop=true;},options:{configFile,docker,files,clock:()=>now,shouldStop:()=>stop,
   resolveIssuer:async issuer=>{dns++;assert.equal(issuer,access.issuer);return issuerAddresses;},
   sleep:async ms=>{now+=ms;if(starts>0)stop=true;},acquireLease:async()=>{leases++;return {close:async()=>{closed++;}};}}};
}

test('disabled runtime does not acquire a lease, read a credential, resolve DNS or invoke Docker',async()=>{
 const f=fixture({enabled:false});assert.deepEqual(await superviseHeldRuntime(f.options),{state:'disabled'});
 assert.equal(f.commands.length,0);assert.equal(f.leases,0);assert.equal(f.dns,0);assert.deepEqual(f.reads,[f.configFile]);
});

test('one held cycle starts in policy-first order, observes revocation and cleans only its own containers',async()=>{
 const f=fixture();assert.deepEqual(await superviseHeldRuntime(f.options),{state:'stopped_held'});
 assert.equal(f.starts,1);assert.equal(f.closed,1);assert.equal(f.states.size,0);
 assert(!f.reads.some(file=>file.endsWith('tunnel-token.txt')||file.includes('private-key')||file.includes('requests')));
 const commandText=JSON.stringify(f.commands);assert(!commandText.includes('synthetic token'));
 const starts=f.commands.filter(args=>args[0]==='run');assert(starts[0].includes(runtimeNames[0]));assert(starts[1].includes('/run/held-policy.sh'));
 const removals=f.commands.filter(a=>a[0]==='rm').map(a=>a[2]);assert.deepEqual(removals,[...runtimeNames].reverse());
});

test('an unknown container is never stopped or adopted and the acquired lease is released',async()=>{
 const f=fixture();f.states.set(runtimeNames[1],{Name:'/'+runtimeNames[1],Config:{Labels:{[runtimeLabel]:'other-owner'}},State:{Running:true}});
 await assert.rejects(superviseHeldRuntime(f.options));assert.equal(f.closed,1);assert(!f.commands.some(a=>a[0]==='rm'));assert.equal(f.states.size,1);
});

test('crash recovery reconciles owned stale containers under the OS lease without reading or replacing private work',async()=>{
 const f=fixture();f.states.set(runtimeNames[1],{Name:'/'+runtimeNames[1],Config:{Labels:{[runtimeLabel]:f.cfg.deployment_id}},State:{Running:false}});
 await superviseHeldRuntime(f.options);assert.equal(f.starts,1);assert.equal(f.closed,1);
 assert.equal(f.commands.find(a=>a[0]==='rm')[2],runtimeNames[1]);assert(!JSON.stringify(f.commands).includes('requests'));
});

test('a changed owner configuration stops the running cycle without broadening or reloading it',async()=>{
 const f=fixture(),sleep=f.options.sleep;f.options.sleep=async ms=>{await sleep(ms);f.data('runtime.json',{...f.cfg,images:{...f.cfg.images,app:'sha256:'+'f'.repeat(64)}});};
 await assert.rejects(superviseHeldRuntime(f.options));assert.equal(f.starts,1);assert.equal(f.states.size,0);assert.equal(f.closed,1);
});

test('a widened kernel policy prevents the app and connector from starting',async()=>{
 const f=fixture(),docker=f.options.docker;f.options.docker=args=>{
  const result=docker(args);if(args[0]==='run'&&args.at(-1)==='iptables -S'){f.stop();return result+'\n-A OUTPUT -j ACCEPT';}return result;
 };
 await superviseHeldRuntime(f.options);assert.equal(f.starts,0);assert(!f.commands.some(a=>a.includes(runtimeNames[1])));assert.equal(f.states.size,0);
});

test('single-instance lease refuses a second owner before Docker and releases without a stale PID file',async()=>{
 const server=new EventEmitter();let closed=0;
 server.listen=(_options,ready)=>{queueMicrotask(ready);};server.close=done=>{closed++;done();};
 const lease=await acquireRuntimeLease({createServer:()=>server});await lease.close();assert.equal(closed,1);
 const duplicate=new EventEmitter();duplicate.listen=()=>queueMicrotask(()=>duplicate.emit('error',Object.assign(Error('busy'),{code:'EADDRINUSE'})));
 await assert.rejects(acquireRuntimeLease({createServer:()=>duplicate}),{code:'EADDRINUSE'});
 const f=fixture();f.options.acquireLease=async()=>{throw Error('already owned');};await assert.rejects(superviseHeldRuntime(f.options));assert.equal(f.commands.length,0);
});

test('Windows installer requires an explicit held grant and pinned commit manifest without elevation, policy bypass or task overwrite',()=>{
 const source=fs.readFileSync(new URL('../runtime/install-held-runtime.ps1',import.meta.url),'utf8');
 assert(source.includes('ApprovePersistentHeldTransport'));assert(source.includes("task_access_enabled -ne $false"));
 assert(source.includes('--check --config'));assert(source.includes('--run-approved-runtime --config'));
 assert(source.includes("':.learning-engine-manifest.json'"));assert(source.includes('git -C $taskSource show'));
 assert(source.includes('-LogonType Interactive -RunLevel Limited'));assert(source.includes('-MultipleInstances IgnoreNew'));
 assert(source.includes('$env:USERPROFILE'));assert(!source.includes('$env:LOCALAPPDATA'));
 assert(source.includes('fs.realpathSync.native(process.argv[1])'));assert(source.includes('taskRoot -ne $taskExpectedRoot'));
 assert(source.includes('Get-Command node.exe -CommandType Application | Select-Object -First 1'));
 assert(source.includes('One resolved installed Node executable required'));
 assert(source.indexOf('ShouldProcess(')<source.indexOf('Register-ScheduledTask -TaskName'));
 assert(!/-ExecutionPolicy\s+(?:Bypass|Unrestricted)|-RunLevel\s+Highest|-Password\b|Register-ScheduledTask[^\r\n]*-Force\b|runtime-app\.private-key\.pem/i.test(source));
});
