// Operator-only plan for a separately approved private task deployment.
// Produces commands; never installs, starts, grants access or activates learning.
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {validateHeldRuntimeConfig,heldRuntimePlan,heldRuntimeFirewall,assertHeldRuntimeFirewall,isPublicRuntimeIpv4} from './pc-runtime-policy.mjs';
const fail=()=>{throw Error('invalid_private_task_runtime_configuration');};
const heldProjection=input=>{const {interpretation_access_enabled,...held}=input;return {...held,schema_version:1,task_access_enabled:false};};
export function validatePrivateTaskRuntimeConfig(input){
 const c=structuredClone(input);
 if(c?.schema_version!==2||typeof c.task_access_enabled!=='boolean'||typeof c.interpretation_access_enabled!=='boolean'
  ||c.remote_service_enabled===true&&!c.task_access_enabled&&!c.interpretation_access_enabled)fail();
 validateHeldRuntimeConfig(heldProjection(c));return Object.freeze(c);
}
export function privateTaskAddresses({issuerAddresses,githubAddresses,oidcAddresses}={}){
 const groups=[issuerAddresses,githubAddresses,oidcAddresses];
 if(groups.some(g=>!Array.isArray(g)||!g.length||g.length>16||new Set(g).size!==g.length||g.some(a=>!isPublicRuntimeIpv4(a))))fail();
 const addresses=[...new Set(groups.flat())].sort();if(addresses.length>16)fail();return addresses;
}
export const assertPrivateTaskRuntimeFirewall=(endpoints,family,actual)=>assertHeldRuntimeFirewall(privateTaskAddresses(endpoints),family,actual);
export function privateTaskBrokerConfig(input,access){
 const c=validatePrivateTaskRuntimeConfig(input);
 return {schema_version:1,task_access_enabled:c.task_access_enabled,interpretation_access_enabled:c.interpretation_access_enabled,
  access:structuredClone(access),github_app:{app_id:5479574,installation_id:175447684,private_key_file:'/run/secrets/runtime-app.pem'},
  request_directory:'/run/private-requests',private_directory_verified:true};
}
export const privateTaskBrokerFilename=input=>{const c=validatePrivateTaskRuntimeConfig(input);return `runtime-task-broker-${c.source_revision}-${Number(c.task_access_enabled)}${Number(c.interpretation_access_enabled)}.json`;};
export function privateTaskRuntimePlan(input,{cycleId,...endpoints}={}){
 const c=validatePrivateTaskRuntimeConfig(input),addresses=privateTaskAddresses(endpoints);
 const plan=heldRuntimePlan(heldProjection(c),{cycleId,issuerAddresses:addresses});
 const app=[...plan.app],replace=(old,value)=>{const index=app.indexOf(old);if(index<0)fail();app[index]=value;};
 replace('PRIVATE_RESEARCH_BROKER_ALLOWED=false',`PRIVATE_RESEARCH_BROKER_ALLOWED=${c.task_access_enabled}`);
 replace(`type=bind,source=${path.win32.join(c.directory,'runtime-broker.json')},target=/run/broker.json,readonly`,
  `type=bind,source=${path.win32.join(c.directory,privateTaskBrokerFilename(c))},target=/run/broker.json,readonly`);
 const before=app.indexOf('--entrypoint');if(before<0)fail();
 app.splice(before,0,'--env',`PRIVATE_INTERPRETATION_BROKER_ALLOWED=${c.interpretation_access_enabled}`,
  // Use the exact validated public addresses admitted by this cycle's firewall.
  // Independent host/container DNS answers can differ geographically. Fixed
  // host mappings retain HTTPS hostname/certificate verification and deny all
  // other destinations; neither private request data nor callers choose them.
  '--add-host',`api.github.com:${[...endpoints.githubAddresses].sort()[0]}`,
  '--add-host',`token.actions.githubusercontent.com:${[...endpoints.oidcAddresses].sort()[0]}`,
  '--mount',`type=bind,source=${path.win32.join(c.directory,'runtime-app.private-key.pem')},target=/run/secrets/runtime-app.pem,readonly`,
  '--mount',`type=bind,source=${path.win32.join(c.directory,'requests')},target=/run/private-requests`);
 return {...plan,task_access_enabled:c.task_access_enabled,interpretation_access_enabled:c.interpretation_access_enabled,
  firewall:heldRuntimeFirewall(addresses).replace('held runtime policy installed','private task runtime policy installed'),app};
}

// ACL verification is read-only and fixed to this Windows owner's protected
// directory. No caller-provided shell/path, credential contents or token output.
export function verifyPrivateTaskRuntimePaths(root,{files,platform=process.platform,run=execFileSync}={}){
 if(platform!=='win32'||!files||typeof run!=='function')fail();
 const expected=path.win32.join(process.env.USERPROFILE??'','WTFStremioPrivate','connection');
 if(!path.win32.isAbsolute(expected)||typeof root!=='string'||root.toLowerCase()!==expected.toLowerCase())fail();
 const key=files.lstatSync(path.win32.join(root,'runtime-app.private-key.pem')),journal=files.lstatSync(path.win32.join(root,'requests'));
 if(!key.isFile()||key.isSymbolicLink()||key.size<1||key.size>16384||!journal.isDirectory()||journal.isSymbolicLink()
  ||files.realpathSync.native(path.win32.join(root,'requests')).toLowerCase()!==path.win32.join(root,'requests').toLowerCase())fail();
 const script=`$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'WTFStremioPrivate/connection'))
$owner=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$allowed=@($owner,'S-1-5-18')
$journal=Join-Path $root 'requests'
$entries=@(Get-ChildItem -LiteralPath $journal -Force)
if($entries.Count -gt 100000){throw 'private journal bound exceeded'}
foreach($entry in $entries){
 if($entry.PSIsContainer -or $entry.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'unsafe private journal entry'}
}
foreach($target in @($root,$journal,(Join-Path $root 'runtime-app.private-key.pem'))+@($entries|ForEach-Object{$_.FullName})){
 $item=Get-Item -LiteralPath $target
 if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'unsafe private path'}
 $acl=Get-Acl -LiteralPath $target
 if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $allowed){throw 'private owner required'}
 if($target -eq $root -and -not $acl.AreAccessRulesProtected){throw 'private ACL required'}
 if(@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])|Where-Object{$_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -notin $allowed}).Count){throw 'private ACL required'}
}
'PRIVATE_TASK_PATHS_VERIFIED'
`;
 // A Node child can inherit PowerShell7's module path. Legacy PowerShell then
 // discovers Get-Acl in an incompatible module and cannot autoload it. Pin both
 // executable and built-in module directory; never weaken or skip ACL checks.
 const systemRoot=process.env.SystemRoot??process.env.SYSTEMROOT;
 if(typeof systemRoot!=='string'||!path.win32.isAbsolute(systemRoot)||path.win32.normalize(systemRoot)!==systemRoot||/[\r\n,"\x00]/.test(systemRoot))fail();
 const powershellRoot=path.win32.join(systemRoot,'System32','WindowsPowerShell','v1.0');
 const result=run(path.win32.join(powershellRoot,'powershell.exe'),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
  {encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:10000,env:{...process.env,PSModulePath:path.win32.join(powershellRoot,'Modules')}}).trim();
 if(result!=='PRIVATE_TASK_PATHS_VERIFIED')fail();return true;
}
