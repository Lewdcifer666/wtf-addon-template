import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
// The template owns this entry point; it is not vendored into private packages.
// GitHub-owned repository identity always takes precedence inside the tests.
const files=fs.readdirSync('learning/test').filter(name=>name.endsWith('.test.mjs')).map(name=>'learning/test/'+name);
const result=spawnSync(process.execPath,['--test',...files],{stdio:'inherit',windowsHide:true,
 env:{...process.env,LEARNING_SOURCE_REPOSITORY:'Lewdcifer666/wtf-addon-template'}});
if(result.error)throw result.error;
process.exitCode=result.status??1;
