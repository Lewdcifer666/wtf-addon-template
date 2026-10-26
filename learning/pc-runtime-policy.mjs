// Closed, held-only PC deployment policy. Produces commands; executes nothing.
import path from 'node:path';
import {isIP} from 'node:net';
import {createHash} from 'node:crypto';
export const runtimeError=()=>Error('invalid_held_runtime_configuration');
const fail=()=>{throw runtimeError();};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.sort().join();
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const sha=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
export const runtimeDigest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const runtimeLabel='wtf.private.runtime';
export const runtimeNames=['wtf-private-runtime-namespace','wtf-private-runtime-app','wtf-private-runtime-connector'];
export const runtimeCycleSeconds=1800;
export function validateHeldRuntimeConfig(input){
 const c=structuredClone(input);
 if(!exact(c,['schema_version','remote_service_enabled','task_access_enabled','deployment_id','source_revision','directory','access_sha256','images'])
  ||c.schema_version!==1||typeof c.remote_service_enabled!=='boolean'||c.task_access_enabled!==false||!uuid(c.deployment_id)||!sha(c.source_revision)
  ||typeof c.directory!=='string'||!path.win32.isAbsolute(c.directory)||c.directory.startsWith('\\\\')||/[\r\n,"\x00]/.test(c.directory)
  ||path.win32.normalize(c.directory)!==c.directory||!c.directory.toLowerCase().endsWith('\\wtfstremioprivate\\connection')
  ||!/^[a-f0-9]{64}$/.test(c.access_sha256??'')||!exact(c.images,['app','tools','connector','namespace'])
  ||Object.values(c.images).some(v=>typeof v!=='string'||!/^sha256:[a-f0-9]{64}$/.test(v)))fail();
 return Object.freeze(c);
}
export function validateRuntimeAccess(access,expected){
 if(!exact(access,['issuer','audience','subject','email'])||typeof access.issuer!=='string'
  ||!/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(access.issuer)
  ||!/^[a-f0-9]{64}$/.test(access.audience??'')||typeof access.subject!=='string'||!access.subject.length||access.subject.length>256||/[\s\x00-\x1f\x7f]/.test(access.subject)
  ||typeof access.email!=='string'||access.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(access.email)
  ||runtimeDigest(access)!==expected)fail();
 return structuredClone(access);
}
export function isPublicRuntimeIpv4(address){
 if(isIP(address)!==4)return false;
 const [a,b,c]=address.split('.').map(Number);
 return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168
  ||a===100&&b>=64&&b<=127||a===192&&b===0&&[0,2].includes(c)||a===192&&b===88&&c===99
  ||a===198&&[18,19].includes(b)||a===198&&b===51&&c===100||a===203&&b===0&&c===113);
}
const quicAddresses=[...['167','67','57','107','27','7','227','47','37','77'].map(n=>'198.41.192.'+n),
 ...['13','193','33','233','53','63','113','73','43','23'].map(n=>'198.41.200.'+n)];
export function heldRuntimeFirewall(addresses){
 if(!Array.isArray(addresses)||addresses.length<1||addresses.length>16||new Set(addresses).size!==addresses.length||addresses.some(a=>!isPublicRuntimeIpv4(a)))fail();
 return ['#!/bin/sh','set -eu',
  ...['iptables','ip6tables'].flatMap(f=>['INPUT','OUTPUT','FORWARD'].map(c=>`${f} -w -P ${c} DROP`)),
  'iptables -w -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT',
  'iptables -w -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT',
  'iptables -w -A INPUT -i lo -p tcp --dport 6505 -j ACCEPT',
  ...[1000,65532].map(uid=>`iptables -w -A OUTPUT -m owner --uid-owner ${uid} -d 127.0.0.1/32 -p tcp --dport 6505 -j ACCEPT`),
  ...[1000,65532].flatMap(uid=>['udp','tcp'].map(protocol=>`iptables -w -A OUTPUT -m owner --uid-owner ${uid} -d 1.1.1.1/32 -p ${protocol} --dport 53 -j ACCEPT`)),
  ...[...addresses].sort().map(a=>`iptables -w -A OUTPUT -m owner --uid-owner 1000 -d ${a}/32 -p tcp --dport 443 -j ACCEPT`),
  ...quicAddresses.map(a=>`iptables -w -A OUTPUT -m owner --uid-owner 65532 -d ${a}/32 -p udp --dport 7844 -j ACCEPT`),
  "echo 'held runtime policy installed'",''].join('\n');
}
export function assertHeldRuntimeFirewall(addresses,family,actual){
 if(!['iptables','ip6tables'].includes(family)||typeof actual!=='string'||actual.length>32768)fail();
 const canonical=line=>{
  const tokens=line.trim().split(/\s+/);
  if(tokens[0]==='-P'){if(tokens.length!==3)fail();return tokens.join(' ');}
  if(tokens[0]!=='-A'||tokens.length<4||(tokens.length-2)%2)fail();
  const flags=[];for(let i=2;i<tokens.length;i+=2){
   let value=tokens[i+1];if(tokens[i]==='-m'&&['tcp','udp'].includes(value))continue;
   if(tokens[i]==='--ctstate')value=value.split(',').sort().join(',');
   if(tokens[i]==='-d')value=value.replace(/\/32$/,'');
   flags.push(tokens[i]+' '+value);
  }
  return tokens.slice(0,2).join(' ')+' '+flags.sort().join(' ');
 };
 const normalize=lines=>{
  const mapped=lines.map(canonical),policies=mapped.filter(l=>l.startsWith('-P ')).sort();
  const normalized=[...policies,...['INPUT','FORWARD','OUTPUT'].flatMap(c=>mapped.filter(l=>l.startsWith('-A '+c+' ')))];
  if(normalized.length!==mapped.length)fail();return normalized;
 };
 const expected=heldRuntimeFirewall(addresses).split('\n').filter(l=>l.startsWith(family+' -w ')).map(l=>l.slice((family+' -w ').length));
 if(JSON.stringify(normalize(actual.trim().split('\n')))!==JSON.stringify(normalize(expected)))fail();
}
export function heldBrokerConfig(access){return {schema_version:1,task_access_enabled:false,access:structuredClone(access),github_app:null,request_directory:null,private_directory_verified:false};}
export function heldRuntimePlan(input,{cycleId,issuerAddresses}={}){
 const config=validateHeldRuntimeConfig(input);if(!uuid(cycleId))fail();
 const root=config.directory,join=(...p)=>path.win32.join(root,...p),label=`${runtimeLabel}=${config.deployment_id}`;
 const source=join('runtime-cycles',cycleId,'firewall.sh'),network='container:'+runtimeNames[0];
 const mount=(file,target)=>['--mount',`type=bind,source=${join(file)},target=${target},readonly`];
 const common=['--init','--label',label,'--pull=never','--restart=no','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--log-driver=none'];
 const networking=['--network',network,...mount('resolv.conf','/etc/resolv.conf')];
 return {schema_version:1,enabled:config.remote_service_enabled,task_access_enabled:false,cycle_seconds:runtimeCycleSeconds,
  firewall:heldRuntimeFirewall(issuerAddresses),policy_file:source,owned_names:[...runtimeNames],label,
  namespace:['run','-d','--name',runtimeNames[0],...common,'--network','bridge','--user','65534:65534','--pids-limit','32','--memory','16m','--cpus','0.25',
   config.images.namespace,'sleep',String(runtimeCycleSeconds)],
  install_policy:['run','--rm','--label',label,'--pull=never','--network',network,'--read-only','--cap-drop','ALL','--cap-add','NET_ADMIN',
   '--security-opt','no-new-privileges','--pids-limit','32','--memory','32m','--log-driver=none',
   '--mount',`type=bind,source=${source},target=/run/held-policy.sh,readonly`,'--entrypoint','/bin/sh',config.images.tools,'/run/held-policy.sh'],
  app:['run','-d','--name',runtimeNames[1],...common,...networking,'--user','1000:1000','--pids-limit','64','--memory','512m','--cpus','0.5',
   '--tmpfs','/tmp:rw,noexec,nosuid,size=16m',...mount('runtime-broker.json','/run/broker.json'),
   '--env','PRIVATE_RESEARCH_BROKER_ALLOWED=false','--entrypoint','/usr/bin/timeout',config.images.app,'-s','TERM','-k','10',String(runtimeCycleSeconds),
   'node','learning/research-broker-host.mjs','--config','/run/broker.json','--port','6505'],
  connector:['run','-d','--name',runtimeNames[2],...common,...networking,'--user','65532:65532','--pids-limit','64','--memory','128m','--cpus','0.5',
   ...mount('tunnel-token.txt','/run/secrets/tunnel-token'),'--entrypoint','/bin/busybox',config.images.connector,
   'timeout','-s','TERM','-k','10',String(runtimeCycleSeconds),'/usr/local/bin/cloudflared','--no-autoupdate','tunnel','--protocol','quic',
   '--edge-ip-version','4','--loglevel','error','run','--token-file','/run/secrets/tunnel-token']};
}
