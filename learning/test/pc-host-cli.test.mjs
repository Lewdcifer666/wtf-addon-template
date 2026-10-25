import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawn,spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const config={issuer:'https://synthetic-cli.cloudflareaccess.com',audience:'c'.repeat(64),subject:'synthetic-owner',email:'owner@example.invalid'};
const cli='learning/research-mcp-host.mjs';
function fixture(){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'wtf-held-cli-')),file=path.join(directory,'access.json');
 return {file,close(){if(fs.existsSync(file))fs.unlinkSync(file);fs.rmdirSync(directory);}};}
const env={...process.env};delete env.PRIVATE_RESEARCH_MCP_TOKEN;
test('Access CLI accepts only bounded server-owned identity JSON and never exposes file contents in errors',()=>{
 const files=fixture();
 try{
  for(const [content,extra] of [['{PRIVATE_SENTINEL',{}],[JSON.stringify({...config,adapter:'PRIVATE_SENTINEL'}),{}],
   ['PRIVATE_SENTINEL'.repeat(400),{}],[JSON.stringify(config),{PRIVATE_RESEARCH_MCP_TOKEN:'x'.repeat(43)}]]){
   fs.writeFileSync(files.file,content);
   const result=spawnSync(process.execPath,[cli,'--access-config',files.file,'--port','0'],{env:{...env,...extra},encoding:'utf8',timeout:5000,windowsHide:true});
   assert.equal(result.status,1);assert.equal(result.stdout,'');assert.match(result.stderr,/host_start_failed/);
   assert(!result.stderr.includes('PRIVATE_SENTINEL'));assert(!result.stderr.includes(files.file));
  }
 }finally{files.close();}
});
test('Access CLI can start a held loopback host without GitHub, provider or bearer credentials',async()=>{
 const files=fixture();fs.writeFileSync(files.file,JSON.stringify(config));
 const child=spawn(process.execPath,[cli,'--access-config',files.file,'--port','0'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let output='',error='';child.stderr.on('data',chunk=>{error+=chunk;});
 try{
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('held_cli_start_timeout')),5000);
   child.once('error',error=>{clearTimeout(timer);reject(error);});
   child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('adapter held')){clearTimeout(timer);resolve();}});
   child.once('exit',code=>{clearTimeout(timer);reject(Error('early_exit_'+code));});
  });
  assert.equal(error,'');assert.equal(output.trim(),'private-mcp: local transport ready; adapter held');
 }finally{
  if(child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}
  files.close();
 }
});
