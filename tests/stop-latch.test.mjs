// File/transport tests only. Never start controls, send input or clear a real latch.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {EventEmitter} from 'node:events';
import {testDirectory} from './paths.mjs';import {persistStopLatch,preserveStopLatch,readStopLatch} from '../server/recovery.mjs';import {Runtime} from '../server/runtime.mjs';
const run=promisify(execFile);
function location(t){const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'stop-monotonic-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return {dir,file:path.join(dir,'emergency.stop')};}
function runtime(file){const guardian=new EventEmitter();guardian.send=()=>true;const driver={async abort(){}};return {guardian,r:new Runtime({guardian,driver,sessions:{register(){},close(){}},latchFile:file,taskFile:null})};}

test('ordinary Stop and a late guardian exit preserve uncertainty across runtime reconstruction',async t=>{
 const {file}=location(t);fs.writeFileSync(file,'unconfirmed:fixture');
 assert.equal(persistStopLatch(file).value,'unconfirmed:fixture');
 const {r,guardian}=runtime(file);guardian.emit('state','stopped','guardian_exited');
 assert.equal(fs.readFileSync(file,'utf8'),'unconfirmed:fixture');
 assert.equal(runtime(file).r.lastControlReason,'guardian_stop_unconfirmed');
 await assert.rejects(r.stop(),e=>e.code==='guardian_stop_unconfirmed');
 assert.equal(fs.readFileSync(file,'utf8'),'unconfirmed:fixture');
});

test('stronger publication survives a late write through an older open file handle',t=>{
 const {file}=location(t);const old=fs.openSync(file,'wx',0o600);
 try{
  const saved=persistStopLatch(file,{unconfirmed:true});assert.equal(saved.unconfirmed,true);
  fs.writeFileSync(old,'stopped');fs.fsyncSync(old);
  assert.equal(readStopLatch(file).value,saved.value);
  assert.equal(persistStopLatch(file).value,saved.value);
  fs.writeFileSync(file,'stopped');assert.equal(readStopLatch(file).value,saved.value,'a legacy primary rewrite cannot erase the companion');
  fs.unlinkSync(file);assert.equal(runtime(file).r.lastControlReason,'guardian_stop_unconfirmed','a companion alone blocks restart');
 }finally{fs.closeSync(old);}
});

test('an uncertainty marker winning an exclusive publication race is preserved',t=>{
 const {file}=location(t);const io=Object.create(fs);
 io.linkSync=(from,to)=>{fs.writeFileSync(to,'unconfirmed:concurrent');return fs.linkSync(from,to);};
 assert.equal(persistStopLatch(file,{io}).value,'unconfirmed:concurrent');
});

test('invalid legacy evidence survives passive status and refused shutdown without starting controls',async t=>{
 const {file}=location(t);fs.writeFileSync(file,'owner-stop');const {r,guardian}=runtime(file);let requests=0;
 guardian.start=async()=>{requests++;};guardian.request=async()=>{requests++;};guardian.close=async()=>{requests++;};
 assert.equal(r.status().state,'stopped');assert.equal(r.status().control_reason,'stop_persistence_failed');
 await r.prepare();await r.finish();await assert.rejects(r.close(),e=>e.code==='stop_persistence_failed');
 assert.equal(requests,0);assert.equal(fs.readFileSync(file,'utf8'),'owner-stop');
});

test('publication flush failure preserves the old Stop and removes only its own temporary file',t=>{
 const {dir,file}=location(t);fs.writeFileSync(file,'stopped');const io=Object.create(fs);
 io.fsyncSync=()=>{throw Object.assign(Error('fixture flush failure'),{code:'EIO'});};
 assert.throws(()=>persistStopLatch(file,{unconfirmed:true,io}),/flush failure/);
 assert.equal(fs.readFileSync(file,'utf8'),'stopped');assert.deepEqual(fs.readdirSync(dir),['emergency.stop']);
});

test('different existing uncertainty records are both retained rather than rewritten',t=>{
 const {file}=location(t);fs.writeFileSync(file,'unconfirmed:primary-context');fs.writeFileSync(file+'.unconfirmed','unconfirmed:pending-context');
 assert.equal(persistStopLatch(file).value,'unconfirmed:pending-context');
 assert.equal(fs.readFileSync(file,'utf8'),'unconfirmed:primary-context');assert.equal(fs.readFileSync(file+'.unconfirmed','utf8'),'unconfirmed:pending-context');
});

test('invalid entries fail closed and migration never converts uncertainty to confirmation',t=>{
 const {dir,file}=location(t);const previous=path.join(dir,'previous.stop');fs.writeFileSync(previous,'unconfirmed:old-install');
 assert.equal(preserveStopLatch(previous,file),true);const first=readStopLatch(file).value;
 fs.writeFileSync(previous,'stopped');preserveStopLatch(previous,file);assert.equal(readStopLatch(file).value,first);
 fs.writeFileSync(previous,'invalid');assert.throws(()=>preserveStopLatch(previous,file),/invalid/);assert.equal(readStopLatch(file).value,first);
 fs.unlinkSync(file);fs.mkdirSync(file);assert.throws(()=>persistStopLatch(file,{unconfirmed:true}));assert(fs.statSync(file).isDirectory());
 assert.equal(runtime(file).r.lastControlReason,'stop_persistence_failed');
});

test('independent ordinary writers cannot downgrade an already published uncertainty marker',{timeout:30000},async t=>{
 const {file}=location(t);fs.writeFileSync(file,'unconfirmed:multi-process');
 const module=new URL('../server/recovery.mjs',import.meta.url).href;
 const code=`import {persistStopLatch} from ${JSON.stringify(module)};for(let i=0;i<10;i++)persistStopLatch(process.argv[1]);`;
 const results=await Promise.allSettled(Array.from({length:4},()=>run(process.execPath,['--input-type=module','-e',code,file],{windowsHide:true,timeout:15000})));
 for(const result of results)if(result.status==='rejected')throw result.reason;
 assert.equal(fs.readFileSync(file,'utf8'),'unconfirmed:multi-process');
});
