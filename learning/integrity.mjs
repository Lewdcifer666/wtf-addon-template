import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const engineHash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function canonicalEngineBytes(bytes){
  const text=bytes.toString('utf8');
  if(!Buffer.from(text,'utf8').equals(bytes))throw Error('Engine source must be UTF-8 text');
  return Buffer.from(text.replace(/\r\n/g,'\n'),'utf8');
}
// Legacy manifests could hash CRLF while Git committed LF. Accept only that
// reversible encoding difference when checking ownership, never content edits.
export function matchesOwnedEngineHash(bytes,expected){
  const canonical=canonicalEngineBytes(bytes);
  return [bytes,canonical,Buffer.from(canonical.toString('utf8').replace(/\n/g,'\r\n'))].some(value=>engineHash(value)===expected);
}
export function verifyEngineManifest(root){
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'.learning-engine-manifest.json'),'utf8'));
  if(!manifest||Array.isArray(manifest)||!Object.keys(manifest).length)throw Error('Invalid learning engine manifest');
  const present=[];
  const walk=relative=>{if(!fs.existsSync(path.join(root,relative)))return;
    for(const entry of fs.readdirSync(path.join(root,relative),{withFileTypes:true})){
      const name=`${relative}/${entry.name}`;
      if(entry.isDirectory())walk(name);
      else if(entry.isFile()&&name!=='learning/config/activation.json')present.push(name);
      else if(!entry.isFile())throw Error('Unexpected engine file type');
    }
  };
  walk('learning');
  for(const name of ['engine/dna-score.mjs','engine/identity.mjs','package.json','package-lock.json',...['ci','intake','finalize'].map(n=>`.github/workflows/learning-${n}.yml`)])if(fs.existsSync(path.join(root,name)))present.push(name);
  if(present.some(name=>!Object.hasOwn(manifest,name)))throw Error('Learning engine file missing from integrity manifest');
  for(const [name,expected] of Object.entries(manifest)){
    if(!/^(?:learning\/|engine\/(?:dna-score|identity)\.mjs$|\.github\/workflows\/learning-|package(?:-lock)?\.json$|\.gitignore$)/.test(name)
      ||name.split('/').some(p=>p==='..'||p==='.')||name.includes('\\')||!/^[a-f0-9]{64}$/.test(expected))throw Error('Invalid learning engine manifest entry');
    const actual=canonicalEngineBytes(fs.readFileSync(path.join(root,name)));
    if(engineHash(actual)!==expected)throw Error(`Learning engine integrity mismatch: ${name}`);
  }
  return Object.keys(manifest).length;
}
