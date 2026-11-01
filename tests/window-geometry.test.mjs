import {testDirectory} from './paths.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
test('native window fitting and physical display reachability preserve negative origins and reject gaps',{skip:process.platform!=='win32'},()=>{
 const dir=testDirectory('window-geometry');fs.mkdirSync(dir,{recursive:true});const exe=path.join(dir,'WindowGeometryTests.exe');
 const csc=path.join(process.env.WINDIR||'C:/Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe');
 const build=spawnSync(csc,['-nologo','-r:System.Drawing.dll','-out:'+exe,path.resolve('server/native/WindowGeometry.cs'),path.resolve('tests/WindowGeometryTests.cs')],{windowsHide:true,encoding:'utf8'});assert.equal(build.status,0,build.stdout+build.stderr);
 const run=spawnSync(exe,[],{windowsHide:true,encoding:'utf8'});assert.equal(run.status,0,run.stdout+run.stderr);assert.match(run.stdout,/TOTAL 14/);
});
