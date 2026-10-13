import fs from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createResearchValidator,readResearchRegistry} from '../research-contract.mjs';
const schema=JSON.parse(fs.readFileSync(new URL('../schemas/research-packet.schema.json',import.meta.url),'utf8'));
function fixture(genre='scifi'){
 const profile=JSON.parse(fs.readFileSync(new URL(`./fixtures/contracts/${genre}-profile.json`,import.meta.url),'utf8'));
 const dimensions=profile.dna_dimensions.dimensions.map(d=>d.id),tags=profile.dna_dimensions.tag_registry;
 const registry_source=`export const CANONICAL_DIMENSIONS = ${JSON.stringify(dimensions)};\nexport const CANONICAL_DNA_TAGS = ${JSON.stringify(tags)};\nexport const SLOW_TO_FAST_DIMENSION = "pace_speed";\n`;
 const research={schema_version:1,genre,run_prefix:genre[0],timezone:'Europe/Berlin',minimum_sources:genre==='thriller'?3:1,require_all_known:genre==='thriller'};
 const input={profile,registry_source,research,packetSchema:schema};
 const packet={schema_version:1,genre,research_date:'2026-10-12',candidates:[{imdb_id:'tt11111111',type:'movie',title:'Synthetic research',year:2020,reason:'Public-source fixture.',sources:[{url:'https://example.org/review',purpose:'review'},{url:'https://example.net/structure',purpose:'structure'},{url:'https://example.com/identity',purpose:'identity'}],dna:Object.fromEntries(dimensions.map(d=>[d,5])),dna_confidence:1,dna_tags:[]}],research_rejections:[]};
 return {input,packet,dimensions,validate:()=>createResearchValidator(input,{now:Date.parse('2026-10-12T12:00:00Z')})};
}
test('all six pinned genre contracts validate without evaluating fetched registry JavaScript',()=>{
 for(const genre of ['action','anime','fantasy','mystery','scifi','thriller']){
  const f=fixture(genre);assert.deepEqual(f.validate()(f.packet),[],genre);
  assert.throws(()=>readResearchRegistry(f.input.registry_source+'\nthrow Error("EXECUTED_UNTRUSTED");'),/grammar/);
 }
});
test('Thriller known-DNA ingestion and other profiles nullable ingestion remain distinct',()=>{
 for(const genre of ['action','anime','fantasy','mystery','scifi','thriller']){
  const f=fixture(genre);f.packet.candidates[0].dna[f.dimensions[0]]=null;
  const before=JSON.stringify(f.packet),errors=f.validate()(f.packet);
  assert.equal(errors.includes('profile requires all DNA known'),genre==='thriller');assert.equal(JSON.stringify(f.packet),before);
 }
});
test('closed packet fields, required source policies, comma URLs and future Berlin dates match ingestion rules',()=>{
 const f=fixture();const validate=f.validate();f.packet.match_score=100;assert(validate(f.packet).length);delete f.packet.match_score;
 f.packet.candidates[0].sources[0].url='https://example.org/film/synthetic,123.html';assert.deepEqual(validate(f.packet),[]);
 f.input.research.required_source_hosts_by_type={movie:['required.example.org']};assert(f.validate()(f.packet).includes('missing required source host'));
 delete f.input.research.required_source_hosts_by_type;f.input.research.blocked_source_hosts=['example.org'];assert(f.validate()(f.packet).includes('blocked source host'));
 delete f.input.research.blocked_source_hosts;f.packet.research_date='2026-10-13';assert(validate(f.packet).length);
});
test('pinned schema and frozen registry mismatches fail rather than inventing new contract semantics',()=>{
 const f=fixture();f.input.packetSchema={...schema,additionalProperties:true};assert.throws(f.validate,/contract/);
 const registry=fixture();registry.input.registry_source=registry.input.registry_source.replace('"scientific_investigation"','"unreviewed_dimension"');assert.throws(registry.validate,/profile/);
});
test('generated profile adapter matches trusted template validation source when present',async()=>{
 if(!fs.existsSync('generate-learning-contract.mjs'))return;
 const {generatedProfileValidator}=await import('../../generate-learning-contract.mjs');
 assert.equal(fs.readFileSync('learning/generated-profile-validation.mjs','utf8').replace(/\r\n/g,'\n'),generatedProfileValidator());
});
