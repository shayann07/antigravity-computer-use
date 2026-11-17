import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {testDirectory} from './paths.mjs';import {persistRecoveryStop,settlePriorStop,readStopLatch} from '../server/recovery.mjs';
test('prior Stop settlement requires matching old guard, dead actors and clean native ledger on both platforms',()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'stop-context-')),guard='guard-101-12345678-1234-1234-1234-123456789abc.state',record={guard,children:[102,103,104],dispatched:true,watchdogs_complete:true},file=path.join(dir,'emergency.stop');
 const probe=()=>{throw Object.assign(Error('gone'),{code:'ESRCH'});};
 try{for(const platform of ['win32','darwin']){
  for(const suffix of ['', '.unconfirmed','.context.json'])try{fs.unlinkSync(file+suffix);}catch{}
  fs.writeFileSync(path.join(dir,guard),platform==='win32'?'stopped||0|':'stopped||0||0|0');fs.writeFileSync(path.join(dir,guard)+'.watchdog','104|123456');
  const ledger=path.join(dir,guard)+'.inputs';fs.writeFileSync(ledger,platform==='win32'?'':'{"keys":[],"buttons":[]}');
  persistRecoveryStop(file,guard,{unconfirmed:true,nonce:'a'.repeat(32)});
  assert.throws(()=>settlePriorStop(file,{...record,guard:guard.replace('101','999')},{platform,probe}));
  assert.throws(()=>settlePriorStop(file,record,{platform,probe:()=>{}}));assert(readStopLatch(file).unconfirmed);
  fs.writeFileSync(ledger,'held');assert.throws(()=>settlePriorStop(file,record,{platform,probe}));assert(readStopLatch(file).unconfirmed);
  fs.writeFileSync(ledger,platform==='win32'?'':'{"keys":[],"buttons":[]}');
  const result=settlePriorStop(file,record,{platform,probe});assert.equal(result.task_ended,true);assert.equal(result.prior_cleanup_verified,true);assert.equal(readStopLatch(file).value,'stopped');assert.equal(fs.existsSync(file+'.unconfirmed'),false);
 }}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('unwritable recovery context still persists Stop and cannot be settled from missing context',()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'stop-context-failure-')),file=path.join(dir,'emergency.stop'),guard='guard-101-12345678-1234-1234-1234-123456789abc.state';
 try{fs.mkdirSync(file+'.context.json');assert.throws(()=>persistRecoveryStop(file,guard,{unconfirmed:true}));assert(readStopLatch(file).unconfirmed);assert.throws(()=>settlePriorStop(file,{guard}));assert(readStopLatch(file).unconfirmed);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('undispatched prior Stop settles only when the old guard markers name no live actor, and keeps the confirmed Stop for the next ready',()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'stop-undispatched-')),guard='guard-101-12345678-1234-1234-1234-123456789abc.state',record={guard,open:true,children:[],dispatched:false,watchdogs_complete:true},file=path.join(dir,'emergency.stop'),state=path.join(dir,guard);
 const gone=()=>{throw Object.assign(Error('gone'),{code:'ESRCH'});},live=pid=>id=>{if(id===pid)return true;gone();};
 // A live fixture pid is the same process its marker recorded (macOS checks start times).
 const startOf=pid=>({105:123456,106:99})[pid]??null;
 try{for(const platform of ['win32','darwin']){
  for(const name of fs.readdirSync(dir))fs.rmSync(path.join(dir,name),{recursive:true,force:true});
  fs.writeFileSync(state,'idle||0|');fs.writeFileSync(state+'.inputs',platform==='win32'?'':'{"keys":[],"buttons":[]}');
  persistRecoveryStop(file,guard,{unconfirmed:true,nonce:'a'.repeat(32)});
  assert.throws(()=>settlePriorStop(file,record,{platform,startOf,probe:live(101)}));assert(readStopLatch(file).unconfirmed);
  fs.writeFileSync(state+'.watchdog','105|123456');assert.throws(()=>settlePriorStop(file,record,{platform,startOf,probe:live(105)}));assert(readStopLatch(file).unconfirmed);
  fs.writeFileSync(state+'.watchdog','garbage');assert.throws(()=>settlePriorStop(file,record,{platform,startOf,probe:gone}));assert(readStopLatch(file).unconfirmed);
  fs.writeFileSync(state+'.watchdog','105|123456');fs.writeFileSync(state+'.workers','106:99\n');assert.throws(()=>settlePriorStop(file,record,{platform,startOf,probe:live(106)}));assert(readStopLatch(file).unconfirmed);
  fs.writeFileSync(state+'.workers','nonsense\n');assert.throws(()=>settlePriorStop(file,record,{platform,startOf,probe:gone}));assert(readStopLatch(file).unconfirmed);
  fs.writeFileSync(state+'.workers','');assert.throws(()=>settlePriorStop(file,{...record,children:[102]},{platform,startOf,probe:gone}));assert(readStopLatch(file).unconfirmed);
  const result=settlePriorStop(file,record,{platform,startOf,probe:gone});assert.equal(result.task_ended,true);assert.equal(result.prior_cleanup_verified,true);assert.equal(readStopLatch(file).value,'stopped');assert.equal(fs.existsSync(file+'.unconfirmed'),false);
 }}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
