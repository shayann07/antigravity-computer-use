import {testDirectory} from './paths.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
test('native bar body: throws land on their dock, squash against the edge, stay on screen and settle',{skip:process.platform!=='win32'},()=>{
 const dir=testDirectory('bar-body-tests');fs.mkdirSync(dir,{recursive:true});const exe=path.join(dir,'BarBodyTests.exe');
 const compiler=path.join(process.env.WINDIR||'C:\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
 const built=spawnSync(compiler,['-nologo','-out:'+exe,path.resolve('server/native/BarBody.cs'),path.resolve('tests/BarBodyTests.cs')],{windowsHide:true,encoding:'utf8'});assert.equal(built.status,0,built.stdout+built.stderr);
 const run=spawnSync(exe,[],{windowsHide:true,encoding:'utf8'});assert.equal(run.status,0,run.stdout+run.stderr);assert.match(run.stdout,/TOTAL 164/);
 fs.writeFileSync(path.join(dir,'result.txt'),run.stdout);
});
