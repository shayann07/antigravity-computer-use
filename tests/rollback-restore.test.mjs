import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {restoreFile} from '../scripts/rollback.mjs';import {testDirectory} from './paths.mjs';

test('rollback leaves an unchanged launcher alone and retries a briefly locked one (#8)',()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'rollback-restore-'));
 try{
  const saved=path.join(dir,'saved.bin'),file=path.join(dir,'cu-node.exe');
  fs.writeFileSync(saved,'same');fs.writeFileSync(file,'same');
  assert.equal(restoreFile(saved,file,{io:{...fs,renameSync(){throw Object.assign(Error('locked'),{code:'EPERM'});}}}),'unchanged','no rename needed for identical bytes');
  fs.writeFileSync(saved,'old build');let tries=0;
  const locked={...fs,renameSync(a,b){if(++tries<3)throw Object.assign(Error('in use'),{code:'EPERM'});return fs.renameSync(a,b);}};
  assert.equal(restoreFile(saved,file,{io:locked,sleep:()=>{}}),'restored');assert.equal(tries,3);assert.equal(fs.readFileSync(file,'utf8'),'old build');
  fs.writeFileSync(file,'new build');
  assert.throws(()=>restoreFile(saved,file,{io:{...fs,renameSync(){throw Object.assign(Error('in use'),{code:'EBUSY'});}},sleep:()=>{},attempts:3}),{code:'EBUSY'});
  assert.equal(fs.existsSync(file+'.rollback.tmp'),false,'no temporary file is left behind');assert.equal(fs.readFileSync(file,'utf8'),'new build');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('the installer retries a briefly locked launcher rename and gives up on other errors',async()=>{
 const {renameRetrying}=await import('../scripts/install.mjs');
 let n=0;assert.equal(renameRetrying('a','b',{rename(){if(++n<4)throw Object.assign(Error('in use'),{code:'EBUSY'});},sleep(){}}),4);
 assert.throws(()=>renameRetrying('a','b',{rename(){throw Object.assign(Error('gone'),{code:'ENOENT'});},sleep(){}}),{code:'ENOENT'});
});

test('rollback restores BOM-prefixed and blank configuration backups and keeps unrelated settings (#134, #135)',async()=>{
 const {rollback,readConfigFile}=await import('../scripts/rollback.mjs');
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'rollback-config-'));
 try{
  const root=path.join(dir,'install'),release=path.join(root,'releases','1.0.6'),backup=path.join(dir,'backup');
  fs.mkdirSync(release,{recursive:true});fs.mkdirSync(backup);
  const mcp=path.join(dir,'mcp_config.json'),config=path.join(dir,'config.json');
  // Backups exactly as the installer saw them: one with a BOM, one blank.
  fs.writeFileSync(path.join(backup,'0.json'),'﻿{"mcpServers":{"antigravity-computer-use":{"command":"old"}}}');
  fs.writeFileSync(path.join(backup,'1.json'),'  \n');
  // Live files carry a setting the user added after installation.
  fs.writeFileSync(mcp,JSON.stringify({mcpServers:{'antigravity-computer-use':{command:'new'},other:{command:'keep'}}}));
  fs.writeFileSync(config,'﻿'+JSON.stringify({theme:'dark',sidecars:{'antigravity-computer-use':{enable:true}}}));
  const records=[{kind:'config',file:mcp,existed:true,saved:path.join(backup,'0.json')},{kind:'sidecar-config',file:config,existed:true,saved:path.join(backup,'1.json')}];
  const plan=path.join(backup,'rollback.json');fs.writeFileSync(plan,JSON.stringify({release,records}));
  assert.deepEqual(rollback(plan),{restored:true});
  assert.deepEqual(readConfigFile(mcp),{mcpServers:{'antigravity-computer-use':{command:'old'},other:{command:'keep'}}});
  assert.deepEqual(readConfigFile(config),{theme:'dark',sidecars:{}});
  assert.deepEqual(fs.readdirSync(dir).filter(name=>name.endsWith('.tmp')),[],'no temporary file is left behind');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('rollback checks every configuration file before it changes any (#135)',async()=>{
 const {rollback}=await import('../scripts/rollback.mjs');
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'rollback-validate-'));
 try{
  const release=path.join(dir,'install','releases','1.0.6');fs.mkdirSync(release,{recursive:true});
  const first=path.join(dir,'mcp_config.json'),second=path.join(dir,'config.json'),saved=path.join(dir,'saved.json');
  const original=JSON.stringify({mcpServers:{'antigravity-computer-use':{command:'new'}}});
  fs.writeFileSync(first,original);fs.writeFileSync(second,'{not json');fs.writeFileSync(saved,'{}');
  const plan=path.join(dir,'rollback.json');
  fs.writeFileSync(plan,JSON.stringify({release,records:[{kind:'config',file:first,existed:true,saved},{kind:'sidecar-config',file:second,existed:true,saved}]}));
  assert.throws(()=>rollback(plan),SyntaxError);
  assert.equal(fs.readFileSync(first,'utf8'),original,'the first file is untouched when a later one is unreadable');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
