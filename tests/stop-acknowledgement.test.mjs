// Inert private-pipe/file tests. No native UI, approval, physical input or re-arm.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';import {createInterface} from 'node:readline';
import {Guardian} from '../server/guardian.mjs';import {Runtime} from '../server/runtime.mjs';import {readStopLatch,persistStopLatch,settleFreshStopLatch} from '../server/recovery.mjs';import {testDirectory} from './paths.mjs';
const nonce='a'.repeat(32);
async function transport(t,respond){
 let starts=0;const child=new EventEmitter();child.pid=8123;child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.kill=()=>true;
 const guard=path.join(testDirectory('tmp'),'guard-protocol-only.state');
 const g=new Guardian({AGCU_GUARD_FILE:guard},{host:()=>({exe:'inert-fixture'}),spawnProcess:()=>{starts++;return child;},bootTimeout:1000});
 const lines=createInterface({input:child.stdin});lines.on('line',line=>respond?.(JSON.parse(line),child));
 t.after(()=>{if(g.proc===child)child.emit('close',0);lines.close();child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();});
 const boot=g.start();child.stdout.write(JSON.stringify({ev:'ready',pid:child.pid})+'\n');await boot;
 return {g,child,guard,starts:()=>starts};
}
const valid=(m,child)=>({id:m.id,state:'stopped',stop_nonce:m.stop_nonce,guardian_pid:child.pid,guard_file:'guard-protocol-only.state',workers_stopped:true,input_cleanup_confirmed:true});

test('native Stop receipt is bound to nonce, original process, guard and complete cleanup',async t=>{
 const f=await transport(t,(m,child)=>{if(m.stop_nonce)child.stdout.write(JSON.stringify(valid(m,child))+'\n');});
 assert.equal((await f.g.stopAcknowledged(nonce)).stop_nonce,nonce);assert.equal(f.starts(),1);
 for(const bad of [null,'a'.repeat(32)+'\n','b'.repeat(31),'G'.repeat(32)])await assert.rejects(f.g.stopAcknowledged(bad),/nonce/);
});

test('uncorrelated state and malformed, foreign or incomplete receipts cannot confirm Stop',async t=>{
 for(const patch of [{stop_nonce:'b'.repeat(32)},{guardian_pid:999},{guard_file:'other.state'},{workers_stopped:false},{input_cleanup_confirmed:false},{state:'active'}]){
  const f=await transport(t,(m,child)=>{if(m.stop_nonce)child.stdout.write(JSON.stringify({...valid(m,child),...patch})+'\n');});
  await assert.rejects(f.g.stopAcknowledged(nonce),e=>e.code==='guardian_stop_unconfirmed');assert.equal(f.starts(),1);
 }
 const f=await transport(t,(m,child)=>{if(m.stop_nonce)child.stdout.write(JSON.stringify({id:m.id,ev:'state',state:'stopped'})+'\n');});
 await assert.rejects(f.g.stopAcknowledged(nonce),e=>e.code==='guardian_stop_unconfirmed');
});

test('Stop timeout and late state never create a replacement guardian or acknowledge the old request',async t=>{
 let sent;const f=await transport(t,m=>{if(m.stop_nonce)sent=m;});
 const stopped=f.g.stopAcknowledged(nonce,{timeoutMs:100});
 await assert.rejects(stopped,e=>e.code==='guardian_request_timeout');
 f.child.stdout.write(JSON.stringify(valid(sent,f.child))+'\n');assert.equal(f.g.pending.size,0);assert.equal(f.starts(),1);
 f.child.emit('close',1);await assert.rejects(f.g.stopAcknowledged(nonce),e=>e.code==='guardian_stop_unconfirmed');assert.equal(f.starts(),1);
});

test('native exit after emitting a receipt invalidates its process binding',async t=>{
 const f=await transport(t,(m,child)=>{if(m.stop_nonce){child.stdout.write(JSON.stringify(valid(m,child))+'\n');child.emit('close',1);}});
 await assert.rejects(f.g.stopAcknowledged(nonce),e=>e.code==='guardian_stop_unconfirmed');assert.equal(f.starts(),1);
});

test('only a confirmed expected idle exit avoids acknowledgement from a dead process',async t=>{
 const f=await transport(t);assert.equal(f.g.requiresStopAcknowledgement,true);
 f.g.expectedIdleExit=true;f.child.emit('close',0);assert.equal(f.g.requiresStopAcknowledgement,false);
 const failed=await transport(t);failed.g.expectedIdleExit=true;failed.child.emit('close',1);assert.equal(failed.g.requiresStopAcknowledgement,true);
});

function fixture(t,{old=false,held=false}={}){
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'stop-receipt-')),file=path.join(dir,'emergency.stop');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 if(old)fs.writeFileSync(file,'unconfirmed:earlier-controller');
 const guardian=new EventEmitter();guardian.requiresStopAcknowledgement=true;
 const driver={inputMayBeHeld:held,async abort(){}};
 const r=new Runtime({guardian,driver,sessions:{register(){},close(){}},latchFile:file,taskFile:null});
 return {dir,file,guardian,driver,r};
}

test('fresh receipt waits for independent driver cleanup, coalesces Stop and retains human re-arm',async t=>{
 const f=fixture(t);let release,calls=0,aborts=0;const gate=new Promise(resolve=>release=resolve);
 f.guardian.stopAcknowledged=async n=>{calls++;assert.equal(readStopLatch(f.file).value,'unconfirmed:'+n);return {stop_nonce:n,workers_stopped:true,input_cleanup_confirmed:true};};
 f.driver.abort=async()=>{aborts++;await gate;};
 const a=f.r.stop(),b=f.r.stop();await new Promise(resolve=>setTimeout(resolve,0));
 assert(readStopLatch(f.file).unconfirmed);assert.equal(calls,1);assert.equal(aborts,1);
 release();const [first,second]=await Promise.all([a,b]);assert(first.native_stop_confirmed);assert.deepEqual(first,second);
 assert.equal(fs.readFileSync(f.file,'utf8'),'stopped');assert(!fs.existsSync(f.file+'.unconfirmed'));assert.equal(f.r.status().state,'stopped');
 await assert.rejects(f.r.resume(),e=>e.code==='human_rearm_required'||e.code==='human_resume_required'||e.code==='control_inactive');
});

test('old uncertainty, held inputs and failed driver cleanup cannot be settled by a new receipt',async t=>{
 for(const options of [{old:true},{held:true},{failure:true}]){
  const f=fixture(t,options);f.guardian.stopAcknowledged=async n=>({stop_nonce:n,workers_stopped:true,input_cleanup_confirmed:true});
  if(options.failure)f.driver.abort=async()=>{throw Object.assign(Error('inert cleanup failure'),{code:'input_cleanup_failed'});};
  await assert.rejects(f.r.stop(),e=>['guardian_stop_unconfirmed','input_cleanup_failed'].includes(e.code));
  assert(readStopLatch(f.file).unconfirmed);assert.equal(f.r.state,'stopped');
 }
});

test('End retains durable task evidence after Stop acknowledgement fails',async t=>{
 const f=fixture(t);f.guardian.send=()=>true;f.guardian.stopAcknowledged=async()=>{throw Error('inert lost receipt');};
 f.guardian.endAcknowledged=async()=>({state:'stopped'});
 f.r.taskFile=path.join(f.dir,'task-state.json');f.r.beginTask();const before=fs.readFileSync(f.r.taskFile,'utf8');
 await assert.rejects(f.r.stop(),e=>e.code==='guardian_stop_unconfirmed');
 await assert.rejects(f.r.finish(),e=>e.code==='guardian_stop_unconfirmed');
 assert.equal(fs.readFileSync(f.r.taskFile,'utf8'),before);assert.equal(f.r.taskOpen,true);assert(readStopLatch(f.file).unconfirmed);
});

test('End validates original process, cleanup, inactive state and hidden controls',async t=>{
 const receipt=(m,child)=>({id:m.id,end_nonce:m.end_nonce,state:'idle',guardian_pid:child.pid,guard_file:'guard-protocol-only.state',workers_stopped:true,input_cleanup_confirmed:true,controls_visible:false});
 const f=await transport(t,(m,child)=>{if(m.end_nonce)child.stdout.write(JSON.stringify(receipt(m,child))+'\n');});
 assert.equal((await f.g.endAcknowledged(nonce)).state,'idle');assert.equal(f.starts(),1);
 for(const bad of [null,nonce+'\n','G'.repeat(32),'a'.repeat(31)])await assert.rejects(f.g.endAcknowledged(bad),/nonce/);
 for(const patch of [{end_nonce:'b'.repeat(32)},{guardian_pid:999},{guard_file:'foreign.state'},{workers_stopped:false},{input_cleanup_confirmed:false},{controls_visible:true},{state:'active'}]){
  const bad=await transport(t,(m,child)=>{if(m.end_nonce)child.stdout.write(JSON.stringify({...receipt(m,child),...patch})+'\n');});
  await assert.rejects(bad.g.endAcknowledged(nonce),e=>e.code==='guardian_end_unconfirmed');assert.equal(bad.starts(),1);
 }
 f.child.emit('close',1);await assert.rejects(f.g.endAcknowledged(nonce),e=>e.code==='guardian_end_unconfirmed');assert.equal(f.starts(),1);
});

test('End waits for driver and native cleanup before closing task evidence',async t=>{
 const f=fixture(t);let release,called=false,calls=0;const gate=new Promise(resolve=>release=resolve);
 f.r.taskFile=path.join(f.dir,'task-state.json');f.r.beginTask();
 f.driver.abort=async()=>{await gate;};
 f.guardian.endAcknowledged=async()=>{calls++;called=true;assert.equal(f.r.taskOpen,true);return {state:'idle'};};
 f.r.frames.set('old',{});const generation=f.r.generation;
 const pending=f.r.finish(),duplicate=f.r.finish();assert.equal(f.r.frames.size,0);assert.equal(f.r.generation,generation+1);
 await new Promise(resolve=>setTimeout(resolve,0));assert.equal(called,false);assert.equal(f.r.taskOpen,true);
 assert.throws(()=>f.r.beginTask(),e=>e.code==='cleanup_in_progress');
 release();assert.equal((await pending).ended,true);await duplicate;assert.equal(calls,1);assert.equal(f.r.taskOpen,false);assert.equal(JSON.parse(fs.readFileSync(f.r.taskFile)).open,false);
});

test('End timeout cannot be settled by a late receipt or a replacement process',async t=>{
 let message;const f=await transport(t,m=>{if(m.end_nonce)message=m;});
 await assert.rejects(f.g.endAcknowledged(nonce,{timeoutMs:100}),e=>e.code==='guardian_request_timeout');
 f.child.stdout.write(JSON.stringify({id:message.id,end_nonce:nonce,state:'idle',guardian_pid:f.child.pid,guard_file:'guard-protocol-only.state',workers_stopped:true,input_cleanup_confirmed:true,controls_visible:false})+'\n');
 assert.equal(f.g.pending.size,0);assert.equal(f.starts(),1);
});

test('failed End retains task record and latches Stop instead of reporting completion',async t=>{
 const f=fixture(t);f.r.taskFile=path.join(f.dir,'task-state.json');f.r.beginTask();const before=fs.readFileSync(f.r.taskFile,'utf8');
 f.guardian.endAcknowledged=async()=>{throw Error('lost End receipt');};
 f.guardian.stopAcknowledged=async n=>({stop_nonce:n,workers_stopped:true,input_cleanup_confirmed:true});
 await assert.rejects(f.r.finish(),e=>e.code==='guardian_end_unconfirmed');assert.equal(f.r.state,'stopped');assert.equal(f.r.taskOpen,true);assert.equal(fs.readFileSync(f.r.taskFile,'utf8'),before);assert.equal(readStopLatch(f.file).value,'stopped');
});

test('settlement refuses another episode or replaced storage and always leaves a primary Stop',t=>{
 const f=fixture(t);const root=fs.lstatSync(f.dir,{bigint:true});persistStopLatch(f.file,{unconfirmed:true,nonce});
 assert.throws(()=>settleFreshStopLatch(f.file,'b'.repeat(32),root),/episode/);assert(readStopLatch(f.file).unconfirmed);
 assert.throws(()=>settleFreshStopLatch(f.file,nonce,{dev:root.dev,ino:root.ino+1n}),/ownership/);assert(readStopLatch(f.file).unconfirmed);
 settleFreshStopLatch(f.file,nonce,root);assert.equal(fs.readFileSync(f.file,'utf8'),'stopped');assert(!fs.existsSync(f.file+'.unconfirmed'));
});

test('settlement never removes a replacement episode and unlink failure retains uncertainty',t=>{
 const f=fixture(t),root=fs.lstatSync(f.dir,{bigint:true});persistStopLatch(f.file,{unconfirmed:true,nonce});
 const io=Object.create(fs);io.unlinkSync=()=>{throw Object.assign(Error('inert unlink failure'),{code:'EACCES'});};
 assert.throws(()=>settleFreshStopLatch(f.file,nonce,root,{io}),/unlink failure/);
 assert.equal(fs.readFileSync(f.file,'utf8'),'stopped');assert.equal(readStopLatch(f.file).unconfirmed,true);
 fs.writeFileSync(f.file+'.unconfirmed','unconfirmed:another-episode');
 assert.throws(()=>settleFreshStopLatch(f.file,nonce,root),/episode/);assert.equal(fs.readFileSync(f.file+'.unconfirmed','utf8'),'unconfirmed:another-episode');
});

test('a fresh Stop receipt from the same original guard can settle its earlier uncertain nonce',async t=>{
 const f=fixture(t);let original;f.guardian.stopAcknowledged=async n=>{original=n;throw Error('lost first receipt');};
 await assert.rejects(f.r.stop(),{code:'guardian_stop_unconfirmed'});assert(readStopLatch(f.file).unconfirmed);
 f.guardian.stopAcknowledged=async n=>{assert.equal(n,original);return {stop_nonce:n,workers_stopped:true,input_cleanup_confirmed:true};};
 const result=await f.r.stop();assert(result.native_stop_confirmed);assert.equal(readStopLatch(f.file).value,'stopped');assert.equal(f.r.state,'stopped');
});
test('End can verify exited native actors of this bound current task without a replacement guardian',{skip:process.platform!=='win32'},async t=>{
 const {storageOperation}=await import('../server/storage.mjs');const f=fixture(t);storageOperation('data',f.dir);
 f.r.guardFile=path.join(f.dir,path.basename(f.r.guardFile));f.r.taskFile=path.join(f.dir,'task-state.json');f.r.beginTask();
 fs.writeFileSync(f.r.guardFile,'stopped||0|');fs.writeFileSync(f.r.guardFile+'.inputs','');fs.writeFileSync(f.r.guardFile+'.watchdog','2147483644|12345');
 f.guardian.pid=2147483647;f.driver.info={pid:2147483646};f.r.recordDispatch();
 f.guardian.endAcknowledged=async()=>{throw Error('original guardian exited');};f.guardian.stopAcknowledged=async()=>{throw Error('original guardian exited');};
 assert.equal((await f.r.finish()).ended,true);assert.equal(f.r.taskOpen,false);assert.equal(f.r.state,'stopped');assert.equal(readStopLatch(f.file).value,'stopped');
});
