import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {macSDKFlags,macHudIconFiles,copyMacHudIcons} from '../server/macos-build.mjs';
import {testDirectory} from './paths.mjs';

test('native AppKit glass is compiled only when the selected SDK provides it',()=>{
 for(const version of ['14.0','15.5','25.1.2'])assert.deepEqual(macSDKFlags(version),[]);
 for(const version of ['26.0','26.6.2','27.0'])assert.deepEqual(macSDKFlags(version),['-D','AGCU_MACOS26_SDK']);
 for(const version of ['',null,'unknown','26','26.0-beta','13.3'])assert.throws(()=>macSDKFlags(version),e=>e.code==='macos_sdk_version_invalid');
});

test('Mac bundle resources use the exact official SVGs shared with Windows',()=>{
 const app=fs.mkdtempSync(path.join(testDirectory('tmp'),'mac-hud-assets-'));
 try{
  copyMacHudIcons(app);
  const resources=path.join(app,'Contents/Resources/Phosphor');
  assert.deepEqual(fs.readdirSync(resources).sort(),macHudIconFiles.map(file=>path.basename(file)).sort());
  assert.equal(macHudIconFiles.length,5);
  for(const source of macHudIconFiles)assert.deepEqual(fs.readFileSync(path.join(resources,path.basename(source))),fs.readFileSync(source));
 }finally{fs.rmSync(app,{recursive:true,force:true});}
});
