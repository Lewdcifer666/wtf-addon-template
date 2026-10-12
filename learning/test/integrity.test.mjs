import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {canonicalEngineBytes,engineHash,matchesOwnedEngineHash,verifyEngineManifest} from '../integrity.mjs';
test('engine ownership accepts only LF/CRLF variation; substantive edits remain protected',()=>{
 const lf=Buffer.from('const name="synthetic";\n'),crlf=Buffer.from('const name="synthetic";\r\n');
 assert(canonicalEngineBytes(crlf).equals(lf));
 assert(matchesOwnedEngineHash(lf,engineHash(crlf)));assert(matchesOwnedEngineHash(crlf,engineHash(lf)));
 assert(!matchesOwnedEngineHash(Buffer.from('const name="changed";\n'),engineHash(crlf)));
 assert.throws(()=>canonicalEngineBytes(Buffer.from([0xff])),/UTF-8/);
});
test('manifest verification rejects stale content hashes and passes canonical checkout line endings',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'learning-integrity-'));
 try{
  assert.throws(()=>verifyEngineManifest(root),/ENOENT/);
  fs.mkdirSync(path.join(root,'learning'));
  fs.writeFileSync(path.join(root,'learning/a.mjs'),'export const value=1;\r\n');
  fs.writeFileSync(path.join(root,'.learning-engine-manifest.json'),JSON.stringify({'learning/a.mjs':engineHash(Buffer.from('export const value=1;\n'))}));
  assert.equal(verifyEngineManifest(root),1);
  fs.writeFileSync(path.join(root,'learning/unlisted.mjs'),'export const extra=1;\n');
  assert.throws(()=>verifyEngineManifest(root),/missing from integrity manifest/);
  fs.unlinkSync(path.join(root,'learning/unlisted.mjs'));
  fs.writeFileSync(path.join(root,'learning/a.mjs'),'export const value=2;\n');
  assert.throws(()=>verifyEngineManifest(root),/integrity mismatch/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('private deployment verifies every vendored engine file during ordinary CI',()=>{
 // CI owns GITHUB_REPOSITORY; mutable package metadata cannot opt out. Local
 // checks use the checkout's configured remote, outside the committed tree.
 const repository=process.env.GITHUB_REPOSITORY||execFileSync('git',['remote','get-url','origin'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()
  .replace(/^(?:https:\/\/github\.com\/|git@github\.com:)/,'').replace(/\.git$/,'');
 if(repository==='Lewdcifer666/wtf-addon-template')return;
 assert.equal(repository,'Lewdcifer666/wtf-scifi-feedback','Unexpected learning repository');
 assert(verifyEngineManifest(process.cwd())>0);
});
test('private CI cannot opt out by deleting its manifest and renaming its package',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'learning-identity-'));
 try{
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'wtf-addon-template'}));
  const env={...process.env,GITHUB_REPOSITORY:'Lewdcifer666/wtf-scifi-feedback'};
  delete env.NODE_TEST_CONTEXT;
  const result=spawnSync(process.execPath,['--test','--test-name-pattern=^private deployment verifies',fileURLToPath(import.meta.url)],{
   cwd:root,encoding:'utf8',windowsHide:true,env});
  assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,/ENOENT/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
