// Separate from addon engine sync: private learning MUST NOT be copied into
// public addon data or connected to the public publisher App.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {canonicalEngineBytes,matchesOwnedEngineHash} from './learning/integrity.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const argv=process.argv.slice(2);
if(argv.length!==2||argv[0]!=='--target')throw Error('Usage: node generate-learning.mjs --target PRIVATE_FEEDBACK_CHECKOUT');
const target=fs.realpathSync.native(path.resolve(argv[1]));
const git=(...args)=>execFileSync('git',['-C',target,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
if(path.resolve(git('rev-parse','--show-toplevel'))!==target)throw Error('Target must be a checkout root');
if(!/^(?:https:\/\/github\.com\/|git@github\.com:)Lewdcifer666\/wtf-scifi-feedback(?:\.git)?$/.test(git('remote','get-url','origin')))throw Error('Unexpected private target');
const repo=JSON.parse(execFileSync('gh',['api','repos/Lewdcifer666/wtf-scifi-feedback'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
if(repo.private!==true||repo.full_name!=='Lewdcifer666/wtf-scifi-feedback')throw Error('Private target could not be verified');
if(git('branch','--show-current')==='main')throw Error('Vendor through a reviewed branch, never main');
const files={};
function scan(relative){for(const entry of fs.readdirSync(path.join(root,relative),{withFileTypes:true})){
 const name=`${relative}/${entry.name}`;if(entry.isDirectory())scan(name);else if(entry.isFile())files[name]=fs.readFileSync(path.join(root,name));else throw Error('No symlinks in learning source');
}}
scan('learning');files['engine/dna-score.mjs']=fs.readFileSync(path.join(root,'engine/dna-score.mjs'));
files['engine/identity.mjs']=fs.readFileSync(path.join(root,'engine/identity.mjs'));
// Activation belongs to the private deployment. A later engine sync must never
// toggle it or turn a shadow receipt into an activated one.
if(fs.existsSync(path.join(target,'learning/config/activation.json')))delete files['learning/config/activation.json'];
for(const name of ['learning-ci.yml','learning-intake.yml','learning-finalize.yml'])files[`.github/workflows/${name}`]=files[`learning/workflows/${name}`];
const pkg={name:'wtf-private-feedback-learning',version:'1.0.0',private:true,type:'module',engines:{node:'>=20'},scripts:{test:'node --test learning/test/*.test.mjs'},dependencies:{ajv:'8.20.0','@modelcontextprotocol/sdk':'1.32.1',jose:'6.2.12'}};
files['package.json']=Buffer.from(JSON.stringify(pkg,null,2)+'\n');
if(!fs.existsSync(path.join(target,'.gitignore')))files['.gitignore']=Buffer.from('node_modules/\n');
const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));lock.name=pkg.name;lock.packages[''].name=pkg.name;
files['package-lock.json']=Buffer.from(JSON.stringify(lock,null,2)+'\n');
const manifestName='.learning-engine-manifest.json',manifestPath=path.join(target,manifestName);
const previous=fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath,'utf8')):{};
for(const name of Object.keys(files))files[name]=canonicalEngineBytes(files[name]);
for(const name of Object.keys(files)){
 const destination=path.join(target,name);
 if(fs.existsSync(destination)&&!previous[name]&&!canonicalEngineBytes(fs.readFileSync(destination)).equals(files[name]))throw Error(`Unowned target file: ${name}`);
 if(previous[name]&&fs.existsSync(destination)&&!matchesOwnedEngineHash(fs.readFileSync(destination),previous[name]))throw Error(`Local learning customization requires review: ${name}`);
}
for(const [name,bytes] of Object.entries(files)){const destination=path.join(target,name);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,bytes);}
fs.writeFileSync(manifestPath,JSON.stringify(Object.fromEntries(Object.entries(files).filter(([name])=>name!=='learning/config/activation.json').map(([name,bytes])=>[name,createHash('sha256').update(bytes).digest('hex')])),null,2)+'\n');
console.log(`Vendored ${Object.keys(files).length} reviewed engine files into verified private checkout; raw events untouched.`);
