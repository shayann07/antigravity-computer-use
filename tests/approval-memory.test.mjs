import {testDirectory} from './paths.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
test('native approval record: scope, tiers, expiry, limits and damaged files',{skip:process.platform!=='win32'},()=>{
 const dir=testDirectory('approval-memory-tests');fs.mkdirSync(dir,{recursive:true});const exe=path.join(dir,'ApprovalMemoryTests.exe');
 const compiler=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
 const built=spawnSync(compiler,['-nologo','-r:System.Web.Extensions.dll','-out:'+exe,path.resolve('server/native/ApprovalMemory.cs'),path.resolve('tests/ApprovalMemoryTests.cs')],{windowsHide:true,encoding:'utf8'});assert.equal(built.status,0,built.stdout+built.stderr);
 const run=spawnSync(exe,[dir],{windowsHide:true,encoding:'utf8'});assert.equal(run.status,0,run.stdout+run.stderr);assert.match(run.stdout,/TOTAL 23/);
 fs.writeFileSync(path.join(dir,'result.txt'),run.stdout);
});
