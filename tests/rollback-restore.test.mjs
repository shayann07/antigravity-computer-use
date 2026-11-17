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
