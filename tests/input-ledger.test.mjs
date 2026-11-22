import {testDirectory} from './paths.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {ensureHost} from '../server/build.mjs';
test('native recovery journals owned inputs and survives partial delivery/release failure',{skip:process.platform!=='win32'},()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('input-ledger'),'run-'));const exe=path.join(dir,'InputLedgerTests.exe');
 const compiler=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
 const build=spawnSync(compiler,['-nologo','-out:'+exe,path.resolve('server/native/InputLedger.cs'),path.resolve('server/native/AtomicFile.cs'),path.resolve('tests/InputLedgerTests.cs')],{windowsHide:true,encoding:'utf8'});assert.equal(build.status,0,build.stdout+build.stderr);
 const run=spawnSync(exe,[dir],{windowsHide:true,encoding:'utf8'});assert.equal(run.status,0,run.stdout+run.stderr);assert.match(run.stdout,/TOTAL 11/);fs.writeFileSync(path.join(dir,'result.txt'),run.stdout);
});
test('actual Windows cleanup helper refuses a missing input ledger',{skip:process.platform!=='win32'},()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'missing-ledger-native-')),guard=path.join(dir,'guard.state');
 try{fs.writeFileSync(guard,'stopped||0|');const host=ensureHost().exe;for(const file of [guard,'']){const result=spawnSync(host,['--release-inputs'],{windowsHide:true,encoding:'utf8',timeout:10000,env:{...process.env,AGCU_GUARD_FILE:file}});assert.equal(result.status,2,result.stderr);}assert(!fs.existsSync(guard+'.inputs'));}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});
