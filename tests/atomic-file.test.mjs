import {testDirectory} from './paths.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
test('native state files survive a reader briefly holding them, and fail closed when the lock persists (#132)',{skip:process.platform!=='win32'},()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('atomic-file'),'run-'));const exe=path.join(dir,'AtomicFileTests.exe');
 try{
  const compiler=path.join(process.env.WINDIR||'C:\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
  const build=spawnSync(compiler,['-nologo','-out:'+exe,path.resolve('server/native/AtomicFile.cs'),path.resolve('tests/AtomicFileTests.cs')],{windowsHide:true,encoding:'utf8'});assert.equal(build.status,0,build.stdout+build.stderr);
  const run=spawnSync(exe,[dir],{windowsHide:true,encoding:'utf8',timeout:30000});assert.equal(run.status,0,run.stdout+run.stderr);assert.match(run.stdout,/PASS 4/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
