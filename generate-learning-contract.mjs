import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
export function generatedProfileValidator(){
 let source=fs.readFileSync(path.join(root,'engine/validate-profile.mjs'),'utf8').replace(/\r\n/g,'\n');
 const binding='import { CANONICAL_DIMENSIONS, CANONICAL_DNA_TAGS, SLOW_TO_FAST_DIMENSION } from "./registry.mjs";';
 if(!source.includes(binding))throw Error('Review changed profile validator import before generation');
 source=source.replace(binding,'').replace('export { CANONICAL_DIMENSIONS, CANONICAL_DNA_TAGS, SLOW_TO_FAST_DIMENSION };','').replace(/^export (?=(?:const|function) )/gm,'');
 if(/^\s*(?:import|export) /m.test(source))throw Error('Unexpected profile validator module boundary');
 return '// Generated from trusted engine/validate-profile.mjs; do not edit.\nexport function profileValidator(registry){\nconst {CANONICAL_DIMENSIONS,CANONICAL_DNA_TAGS,SLOW_TO_FAST_DIMENSION}=registry;\n'+source+'\nreturn {validateProfile,validateItemDna};\n}\n';
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 fs.writeFileSync(path.join(root,'learning/generated-profile-validation.mjs'),generatedProfileValidator());
 fs.copyFileSync(path.join(root,'skeleton/schemas/research-packet.schema.json'),path.join(root,'learning/schemas/research-packet.schema.json'));
 const fixtures=path.join(root,'learning/test/fixtures/contracts');fs.mkdirSync(fixtures,{recursive:true});
 // Sci-Fi has no template-owned profile. Its existing public contract fixture
 // is checked in separately and must never be replaced by another genre.
 for(const genre of ['action','anime','fantasy','mystery','thriller'])fs.copyFileSync(path.join(root,'profiles',genre,'taste-profile.json'),path.join(fixtures,genre+'-profile.json'));
 console.log('Generated private contract adapter from trusted template source; no production state touched.');
}
