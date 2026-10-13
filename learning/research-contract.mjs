import fs from 'node:fs';
import Ajv from 'ajv';
import {profileValidator} from './generated-profile-validation.mjs';
import {digest,stableJson} from './interpretation.mjs';
const schema=JSON.parse(fs.readFileSync(new URL('./schemas/research-packet.schema.json',import.meta.url),'utf8'));
const shape=new Ajv({allErrors:true,strict:true}).compile(schema);

// A generated registry is declarative policy data. Parse its exact closed export
// grammar; never evaluate/import fetched JavaScript from any repository branch.
export function readResearchRegistry(source){
 if(typeof source!=='string'||source.length>128*1024)throw Error('Invalid pinned registry');
 const body=source.replace(/^\s*\/\/[^\n]*$/gm,'').trim();
 const match=/^export const CANONICAL_DIMENSIONS = (\[[\s\S]*?\]);\s*export const CANONICAL_DNA_TAGS = (\[[\s\S]*?\]);\s*export const SLOW_TO_FAST_DIMENSION = ("[^"\\]*"|null);\s*$/.exec(body);
 if(!match)throw Error('Unsupported pinned registry grammar');
 const [dimensions,tags,slow]=match.slice(1).map(value=>JSON.parse(value));
 for(const list of [dimensions,tags])if(!Array.isArray(list)||list.some(v=>typeof v!=='string')||new Set(list).size!==list.length)throw Error('Invalid pinned registry');
 if(slow!==null&&!dimensions.includes(slow))throw Error('Invalid pinned registry');
 return {CANONICAL_DIMENSIONS:dimensions,CANONICAL_DNA_TAGS:tags,SLOW_TO_FAST_DIMENSION:slow};
}
const sourceUrl=value=>{
 const url=new URL(value);
 if(!['https:','http:'].includes(url.protocol)||!url.hostname.includes('.')||url.username||url.password||/[\s;]/.test(value)||url.hostname.includes(',')||/,https?:\/\//i.test(value))throw Error('invalid source URL');
 url.hash='';return url.href;
};
const hostList=value=>Array.isArray(value)&&value.every(host=>typeof host==='string'&&/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(host));
const hostMatches=(host,rule)=>host===rule||host.endsWith('.'+rule);
export function createResearchValidator(input,{now=Date.now()}={}){
 if(!input?.packetSchema||digest(stableJson(input.packetSchema))!==digest(stableJson(schema)))throw Error('Unsupported pinned packet contract');
 const registry=readResearchRegistry(input.registry_source),{validateProfile,validateItemDna}=profileValidator(registry);
 const profile=input.profile,research=input.research;
 if(validateProfile(profile).length)throw Error('Invalid pinned profile');
 if(research?.schema_version!==1||!research.genre||!/^[a-z][a-z0-9-]*$/.test(research.genre)||!/^[a-z]+$/.test(research.run_prefix)||research.timezone!=='Europe/Berlin'||!Number.isInteger(research.minimum_sources)||research.minimum_sources<1||typeof research.require_all_known!=='boolean')throw Error('Invalid pinned research configuration');
 const required=research.required_source_hosts_by_type??{},blocked=research.blocked_source_hosts??[];
 if(!required||typeof required!=='object'||Array.isArray(required)||Object.entries(required).some(([type,hosts])=>!['movie','series'].includes(type)||!hostList(hosts))||!hostList(blocked))throw Error('Invalid pinned source-host configuration');
 const dimensions=new Set(registry.CANONICAL_DIMENSIONS),tags=new Set(registry.CANONICAL_DNA_TAGS);
 return packet=>{
  if(!shape(packet))return ['invalid packet structure'];
  const errors=[],today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
  const date=new Date(`${packet.research_date}T12:00:00Z`);
  if(packet.genre!==research.genre||!Number.isFinite(+date)||date.toISOString().slice(0,10)!==packet.research_date||packet.research_date>today)errors.push('invalid genre or research date');
  for(const item of packet.candidates){
   if(!item.title.trim()||!item.reason.trim())errors.push('empty candidate text');
   errors.push(...validateItemDna(item,dimensions,tags));
   if(research.require_all_known&&[...dimensions].some(d=>!Number.isInteger(item.dna[d])))errors.push('profile requires all DNA known');
   if((item.tags||[]).some(tag=>!profile.controlled_tags.includes(tag)))errors.push('unknown public tag');
   if(item.external_ids&&!research.allow_external_ids)errors.push('external IDs not enabled');
   const urls=[];
   for(const source of item.sources)try{urls.push(sourceUrl(source.url));}catch{errors.push('invalid source URL');}
   if(new Set(urls).size!==urls.length||new Set(urls).size<research.minimum_sources)errors.push('insufficient distinct sources');
   const hosts=urls.map(url=>new URL(url).hostname.toLowerCase().replace(/\.$/,''));
   if(hosts.some(host=>blocked.some(rule=>hostMatches(host,rule))))errors.push('blocked source host');
   for(const host of required[item.type]||[])if(!hosts.some(actual=>hostMatches(actual,host)))errors.push('missing required source host');
   if(research.require_non_metadata_source&&!item.sources.some(s=>{
    try{return ['structure','review','whole_runtime'].includes(s.purpose)&&!new URL(sourceUrl(s.url)).hostname.includes('cinemeta');}catch{return false;}
   }))errors.push('missing non-metadata evidence');
  }
  for(const rejection of packet.research_rejections)if(!rejection.title.trim()||!rejection.reason.trim())errors.push('empty rejection text');
  return errors;
 };
}
