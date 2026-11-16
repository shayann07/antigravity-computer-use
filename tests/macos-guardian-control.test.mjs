// Drives the real macOS guardian binary over its protocol, headless. The ops
// used here need no TCC grant and post no desktop event: no activate, prompt,
// stop-with-acknowledgement or held-input recovery is exercised.
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {testDirectory} from './paths.mjs';
import {Guardian} from '../server/guardian.mjs';

const skip=process.platform!=='darwin';
const contract=fileURLToPath(new URL('../server/control-contract.json',import.meta.url));

async function privateDirectory(name){
 const {storageOperation,ensureStorageGuard}=await import('../server/storage.mjs');
 const dir=path.join(testDirectory('mac-guardian'),name+'-'+process.pid+'-'+Date.now());
 fs.mkdirSync(dir,{mode:0o700});storageOperation('data',dir,{helper:ensureStorageGuard()});
 const guard=path.join(dir,'guard.state'),latch=path.join(dir,'emergency.stop');
 fs.writeFileSync(guard+'.inputs','{"buttons":[],"keys":[]}',{mode:0o600});
 return {dir,guard,latch};
}
async function start(files,extra={}){
 const g=new Guardian({AGCU_GUARD_FILE:files.guard,AGCU_STOP_LATCH:files.latch,AGCU_CONTRACT_FILE:contract,AGCU_PARENT_PID:String(process.pid),AGCU_PERMISSION_MODE:'standalone',...extra},{bootTimeout:60000});
 await g.start();return g;
}
const fields=file=>fs.readFileSync(file,'utf8').split('|');

test('Mac guardian advertises the unlatched control model and clears only a confirmed Stop',{skip,timeout:240000},async()=>{
 const files=await privateDirectory('clear');
 fs.writeFileSync(files.latch,'stopped',{mode:0o600});
 const g=await start(files);
 try{
  assert.deepEqual(g.capabilities,{clear_stop:true,session_reason:true,remembered_approvals:true,access_tiers:true});
  assert.equal(fields(files.guard)[0],'stopped');
  // Pause or resume cannot leave a confirmed Stop; only clear_stop can.
  g.send({op:'pause'});
  const resume=await g.request({op:'resume'});assert.equal(resume.allowed,false);assert.equal(resume.state,'stopped');
  const reply=await g.request({op:'clear_stop'});
  assert.equal(reply.cleared,true,JSON.stringify(reply));assert.equal(reply.state,'idle');
  assert.equal(reply.workers_stopped,true);assert.equal(reply.input_cleanup_confirmed,true);
  assert.equal(fs.existsSync(files.latch),false);
  const state=fields(files.guard);assert.equal(state[0],'idle');assert.equal(state.length,7);assert.equal(state[5],'0');
  // Clearing an idle guardian is a no-op that reports idle.
  const again=await g.request({op:'clear_stop'});assert.equal(again.cleared,true);assert.equal(again.state,'idle');
  const visual=await g.request({op:'visual_status'});assert.equal(visual.takeover_mode,'manual');
 }finally{await g.close({normal:true}).catch(()=>{});fs.rmSync(files.dir,{recursive:true,force:true});}
});

test('Mac guardian never clears an unconfirmed, companion, invalid or recovered-task Stop',{skip,timeout:240000},async()=>{
 for(const [name,setup,reason,extra] of [
  ['unconfirmed',f=>fs.writeFileSync(f.latch,'unconfirmed:0123456789abcdef0123456789abcdef',{mode:0o600}),'guardian_stop_unconfirmed',{}],
  ['companion',f=>{fs.writeFileSync(f.latch,'stopped',{mode:0o600});fs.writeFileSync(f.latch+'.unconfirmed','unconfirmed:x',{mode:0o600});},'guardian_stop_unconfirmed',{}],
  ['invalid',f=>fs.writeFileSync(f.latch,'stopped-ish',{mode:0o600}),'stop_persistence_failed',{}],
  ['directory',f=>fs.mkdirSync(f.latch,{mode:0o700}),'stop_persistence_failed',{}],
  ['recovered',f=>fs.writeFileSync(f.latch,'stopped',{mode:0o600}),'recovered_cleanup_unverified',{AGCU_REARM_LOCKED:'1'}],
 ]){
  const files=await privateDirectory(name);setup(files);
  const g=await start(files,extra);
  try{
   const reply=await g.request({op:'clear_stop'});
   assert.equal(reply.cleared,false,name);assert.equal(reply.state,'stopped',name);assert.equal(reply.reason,reason,name);
   assert.equal(reply.input_cleanup_confirmed,false,name);
   assert.equal(fs.existsSync(files.latch),true,name+': the marker must stay');
   assert.equal(fields(files.guard)[0],'stopped',name);
  }finally{await g.close({normal:true}).catch(()=>{});fs.rmSync(files.dir,{recursive:true,force:true});}
 }
});

test('Mac guardian rewrites a retired Smart takeover preference to manual',{skip,timeout:240000},async()=>{
 const files=await privateDirectory('smart');
 const preferences=path.join(files.dir,'control-preferences.json');fs.writeFileSync(preferences,JSON.stringify({takeover_mode:'smart',other:1}),{mode:0o600});
 const g=await start(files);
 try{assert.deepEqual(JSON.parse(fs.readFileSync(preferences,'utf8')),{takeover_mode:'manual',other:1});assert.equal(g.takeoverMode,'manual');}
 finally{await g.close({normal:true}).catch(()=>{});fs.rmSync(files.dir,{recursive:true,force:true});}
});
