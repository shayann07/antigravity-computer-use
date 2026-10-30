import {testDirectory} from './paths.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {Runtime,appKey} from '../server/runtime.mjs';
import {Driver} from '../server/driver.mjs';
import fs from 'node:fs';import path from 'node:path';
import {spawn} from 'node:child_process';
import {storageOperation} from '../server/storage.mjs';
import {priorWindowsCleanupVerified} from '../server/recovery.mjs';
function fixture(){
 const guardian=new EventEmitter();guardian.messages=[];guardian.send=m=>guardian.messages.push(m);guardian.request=async m=>{guardian.messages.push(m);return {state:'stopped',controls_visible:true};};guardian.close=()=>{};guardian.pid=998;
 const driver={abortCalls:0,async abort(){this.abortCalls++;},info:{pid:999}};
 const sessions={register(){},close(){}};
 return new Runtime({guardian,driver,sessions});
}
test('task reservation survives controller replacement until confirmed End',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-task-state-')),file=path.join(dir,'task-state.json');
 const make=()=>{const guardian=new EventEmitter();guardian.send=()=>{};return new Runtime({guardian,driver:{async abort(){}},sessions:{register(){},close(){}},taskFile:file});};
 try{
  const first=make();first.beginTask();const marker=JSON.parse(fs.readFileSync(file));assert.equal(marker.open,true);assert.equal(marker.guard,path.basename(first.guardFile));
  const restarted=make();assert.equal(restarted.priorGuard,marker.guard);assert.notEqual(restarted.priorGuard,path.basename(restarted.guardFile));assert.equal(restarted.status().task_open,true);assert.equal(restarted.status().recovered_task,true);
  await assert.rejects(restarted.grant(1),e=>e.code==='recovered_task_requires_end');
  await assert.rejects(restarted.action('clipboard',{}),e=>e.code==='recovered_task_requires_end');
  await assert.rejects(restarted.launch({app:'example'}),e=>e.code==='recovered_task_requires_end');
  let observed=false;restarted.grant=async(_hwnd,_reason,options)=>{observed=options.observationOnly;throw Error('observation probe');};
  await assert.rejects(restarted.observe({hwnd:1}),/observation probe/);assert.equal(observed,true);
  await restarted.finish({preserveTask:true});assert.equal(JSON.parse(fs.readFileSync(file)).open,true);
  await assert.rejects(restarted.finish(),e=>e.code==='recovered_cleanup_unverified');assert.equal(restarted.status().recovered_task,true);assert.equal(JSON.parse(fs.readFileSync(file)).open,true);assert.equal(make().status().task_open,true);
  for(const invalid of ['{broken',JSON.stringify({schema:1,open:true,guard:'../../outside'})]){fs.writeFileSync(file,invalid);assert.throws(()=>make(),e=>e.code==='task_state_invalid');}
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('task reservation write failure remains closed to actions and updates',()=>{
 const r=fixture();const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-task-fail-'));r.taskFile=path.join(dir,'missing','state.json');
 try{for(let i=0;i<2;i++)assert.throws(()=>r.beginTask(),e=>e.code==='task_state_write_failed');assert.equal(r.status().task_open,true);assert.equal(r.taskDurable,false);}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('task startup creates an empty ledger and never overwrites held input evidence',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-empty-ledger-')),r=fixture();r.taskFile=path.join(dir,'task-state.json');r.guardFile=path.join(dir,path.basename(r.guardFile));const ledger=r.guardFile+'.inputs';
 try{
  r.beginTask();const expected=process.platform==='darwin'?'{"keys":[],"buttons":[]}':'';assert.equal(fs.readFileSync(ledger,'utf8'),expected);await r.finish();
  const held=process.platform==='darwin'?'{"keys":[42],"buttons":[]}':'k:65:0:0';fs.writeFileSync(ledger,held);
  assert.throws(()=>r.beginTask(),e=>e.code==='task_state_write_failed');assert.equal(fs.readFileSync(ledger,'utf8'),held);assert.equal(r.status().task_open,true);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('passive production runtime initializes its ledger without starting controls',async t=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-passive-ledger-'));const previous={data:process.env.AGCU_DATA_DIR,plugin:process.env.CU_PLUGIN_DATA,claude:process.env.CLAUDE_PLUGIN_DATA};let runtime;
 try{
  try{storageOperation('data',dir);}catch(error){if(['storage_unsafe_ancestor','insecure_storage_ancestor','storage_permissions_conflict'].includes(error.code)){t.skip('native private storage qualification refused: '+error.code);return;}throw error;}
  process.env.AGCU_DATA_DIR=dir;delete process.env.CU_PLUGIN_DATA;delete process.env.CLAUDE_PLUGIN_DATA;
  runtime=new Runtime();assert.equal(runtime.state,'idle');assert.equal(runtime.guardian.proc,undefined);const data=fs.readFileSync(runtime.guardFile+'.inputs','utf8');
  if(process.platform==='darwin')assert.deepEqual(JSON.parse(data),{keys:[],buttons:[]});else assert.equal(data,'');
  await runtime.close();runtime=null;
 }finally{
  if(runtime)await runtime.close();for(const [name,value] of [['AGCU_DATA_DIR',previous.data],['CU_PLUGIN_DATA',previous.plugin],['CLAUDE_PLUGIN_DATA',previous.claude]]){if(value===undefined)delete process.env[name];else process.env[name]=value;}fs.rmSync(dir,{recursive:true,force:true});
 }
});
test('recovered End closes only after old Windows ledger and native processes verify',{skip:process.platform!=='win32'},async t=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'verified-prior-')),file=path.join(dir,'task-state.json'),guard='guard-2147483647-12345678-1234-1234-1234-123456789abc.state';
 try{
  try{storageOperation('data',dir);}catch(error){if(['storage_unsafe_ancestor','insecure_storage_ancestor','storage_permissions_conflict'].includes(error.code)){t.skip('native private storage qualification refused: '+error.code);return;}throw error;}
  fs.writeFileSync(file,JSON.stringify({schema:1,open:true,guard,children:[2147483645,2147483646,2147483644],dispatched:true,watchdogs_complete:true}));fs.writeFileSync(path.join(dir,guard),'stopped||0|');fs.writeFileSync(path.join(dir,guard+'.watchdog'),'2147483644|12345');fs.writeFileSync(path.join(dir,guard+'.inputs'),'');
  const guardian=new EventEmitter();guardian.send=()=>{};const r=new Runtime({guardian,driver:{async abort(){}},sessions:{register(){},close(){},async clearVerifiedStale(pid){assert.equal(pid,2147483647);}},taskFile:file});
  assert.equal(r.status().recovered_task,true);assert.equal((await r.finish()).ended,true);assert.equal(r.status().task_open,false);assert.equal(JSON.parse(fs.readFileSync(file)).open,false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('recovered End waits for actual prior process exits and preserves Stop',{skip:process.platform!=='win32',timeout:30000},async t=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'prior-processes-')),file=path.join(dir,'task-state.json'),latch=path.join(dir,'emergency.stop');let children=[],controller;
 const previous={data:process.env.AGCU_DATA_DIR,plugin:process.env.CU_PLUGIN_DATA,claude:process.env.CLAUDE_PLUGIN_DATA};
 try{
  try{storageOperation('data',dir);}catch(error){if(['storage_unsafe_ancestor','insecure_storage_ancestor','storage_permissions_conflict'].includes(error.code)){t.skip('native private storage qualification refused: '+error.code);return;}throw error;}
  process.env.AGCU_DATA_DIR=dir;delete process.env.CU_PLUGIN_DATA;delete process.env.CLAUDE_PLUGIN_DATA;
  children=Array.from({length:3},()=>{const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});child.done=new Promise(resolve=>child.once('close',resolve));return child;});
  assert(children.every(child=>Number.isSafeInteger(child.pid)&&child.pid>0));
  const script=`import fs from 'node:fs';import {EventEmitter} from 'node:events';import {Runtime} from ${JSON.stringify(new URL('../server/runtime.mjs',import.meta.url).href)};const guardian=new EventEmitter();guardian.pid=Number(process.argv[2]);guardian.send=()=>{};const driver={info:{pid:Number(process.argv[3])},async abort(){}};const r=new Runtime({guardian,driver,sessions:{register(){},close(){}},taskFile:process.argv[1]});r.beginTask();fs.writeFileSync(r.guardFile,'stopped||0|');fs.writeFileSync(r.guardFile+'.watchdog',process.argv[4]+'|12345');fs.writeFileSync(r.guardFile+'.inputs','');r.recordDispatch();console.log('recorded');setInterval(()=>{},1000);`;
  controller=spawn(process.execPath,['--input-type=module','-e',script,file,...children.map(child=>String(child.pid))],{env:process.env,stdio:['ignore','pipe','pipe'],windowsHide:true});let output='',errors='';controller.stdout.on('data',x=>output+=x);controller.stderr.on('data',x=>errors+=x);controller.done=new Promise(resolve=>controller.once('close',resolve));
  const until=Date.now()+15000;while(!output.includes('recorded')&&controller.exitCode===null&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,20));assert(output.includes('recorded'),errors);controller.kill();await controller.done;
  fs.writeFileSync(latch,'stopped');const guardian=new EventEmitter();guardian.send=()=>{};const r=new Runtime({guardian,driver:{async abort(){}},sessions:{register(){},close(){},async clearVerifiedStale(pid){assert.equal(pid,controller.pid);}},taskFile:file,latchFile:latch});
  await assert.rejects(r.finish(),e=>e.code==='recovered_cleanup_unverified');assert.equal(JSON.parse(fs.readFileSync(file)).open,true);
  for(const child of children.slice(0,2)){child.kill();await child.done;}await assert.rejects(r.finish(),e=>e.code==='recovered_cleanup_unverified');
  children[2].kill();await children[2].done;const ledger=path.join(dir,JSON.parse(fs.readFileSync(file)).guard+'.inputs');fs.writeFileSync(ledger,'k:65:0:0');
  await assert.rejects(r.finish(),e=>e.code==='recovered_cleanup_unverified');assert.equal(JSON.parse(fs.readFileSync(file)).open,true);
  // Fixture evidence only: do not invoke a native input-release helper here.
  fs.writeFileSync(ledger,'');
  // A ChildProcess close event does not guarantee Windows has already removed
  // its process identity. Wait for the exact predicate used by the runtime;
  // do not retry input, weaken the predicate, or mark cleanup verified early.
  const record=JSON.parse(fs.readFileSync(file)),cleanupDeadline=performance.now()+5000;
  while(!priorWindowsCleanupVerified(dir,record)&&performance.now()<cleanupDeadline)await new Promise(resolve=>setTimeout(resolve,25));
  storageOperation('verify-data-tree',dir);
  assert.equal(priorWindowsCleanupVerified(dir,record),true,'Prior fixture processes or their ledger remain unverified');
  assert.equal((await r.finish()).ended,true);assert.equal(r.state,'stopped');assert.equal(fs.readFileSync(latch,'utf8'),'stopped');assert.equal(JSON.parse(fs.readFileSync(file)).open,false);
 }finally{
  if(controller&&controller.exitCode===null&&controller.signalCode===null)controller.kill();if(controller)await controller.done;
  for(const child of children){if(child.exitCode===null&&child.signalCode===null)child.kill();await child.done;}
  for(const [name,value] of [['AGCU_DATA_DIR',previous.data],['CU_PLUGIN_DATA',previous.plugin],['CLAUDE_PLUGIN_DATA',previous.claude]]){if(value===undefined)delete process.env[name];else process.env[name]=value;}
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
test('native process identities are persisted before dispatch and retained across restart',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-task-children-')),file=path.join(dir,'task-state.json');const r=fixture();r.taskFile=file;
 try{
  r.guardFile=path.join(dir,path.basename(r.guardFile));fs.writeFileSync(r.guardFile+'.watchdog','104|123');
  r.beginTask();r.guardian.pid=111;r.driver.info={pid:222};r.recordDispatch();let saved=JSON.parse(fs.readFileSync(file));assert.equal(saved.dispatched,true);assert.equal(saved.watchdogs_complete,true);assert.deepEqual(saved.children,[111,222,104]);assert.equal(saved.guard,path.basename(r.guardFile));
  r.driver.info.pid=333;fs.writeFileSync(r.guardFile+'.watchdog','105|124');r.recordDispatch();saved=JSON.parse(fs.readFileSync(file));assert.deepEqual(saved.children,[111,222,104,333,105]);
  const before=fs.readFileSync(file,'utf8');r.driver.info.pid=undefined;assert.throws(()=>r.recordDispatch(),e=>e.code==='task_process_identity_unavailable');assert.equal(fs.readFileSync(file,'utf8'),before);
  const guardian=new EventEmitter();guardian.send=()=>{};const restarted=new Runtime({guardian,driver:{async abort(){}},sessions:{register(){},close(){}},taskFile:file});assert.deepEqual(restarted.priorChildren,[111,222,104,333,105]);assert.equal(restarted.priorDispatched,true);await assert.rejects(restarted.finish(),e=>e.code==='recovered_cleanup_unverified');
  r.driver.info.pid=333;fs.unlinkSync(r.guardFile+'.watchdog');r.recordDispatch();assert.equal(JSON.parse(fs.readFileSync(file)).watchdogs_complete,false);
  fs.writeFileSync(r.guardFile+'.watchdog','106|125');r.recordDispatch();assert.equal(JSON.parse(fs.readFileSync(file)).watchdogs_complete,false);
  await r.finish();r.beginTask();const next=JSON.parse(fs.readFileSync(file));assert.equal(next.dispatched,false);assert.equal(next.watchdogs_complete,true);assert.deepEqual(next.children,[]);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('End keeps task open and Stop latched until held-input release succeeds',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-end-cleanup-')),taskFile=path.join(dir,'task-state.json'),latchFile=path.join(dir,'emergency.stop');
 const guardian=new EventEmitter();guardian.send=()=>{};guardian.close=async()=>{};
 const driver=new Driver();let releases=0,confirmed=false;driver.releaseHeldInputs=async()=>{releases++;return confirmed;};
 const r=new Runtime({guardian,driver,sessions:{register(){},close(){}},taskFile,latchFile});driver.onEvent=event=>{if(event.event==='input_cleanup_failed')r.stop().catch(()=>{});};
 try{
  r.beginTask();r.state='active';driver.inputMayBeHeld=true;
  for(let n=0;n<2;n++){await assert.rejects(r.finish(),e=>e.code==='input_cleanup_failed');assert.equal(r.state,'stopped');assert.equal(driver.inputMayBeHeld,true);assert.equal(JSON.parse(fs.readFileSync(taskFile)).open,true);}
  assert.equal(fs.readFileSync(latchFile,'utf8'),'stopped');assert.equal(releases,2);
  confirmed=true;const ended=await r.finish();assert.equal(ended.ended,true);assert.equal(r.state,'stopped');assert.equal(driver.inputMayBeHeld,false);assert.equal(JSON.parse(fs.readFileSync(taskFile)).open,false);assert.equal(fs.readFileSync(latchFile,'utf8'),'stopped');assert.equal(releases,3);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('ready prioritizes previous input cleanup over re-arm without starting controls',async()=>{
 const r=fixture();let requests=0;r.taskOpen=true;r.taskDurable=true;r.recoveredTask=true;r.guardian.request=async()=>{requests++;return {state:'idle',controls_visible:true};};
 for(const state of ['idle','paused','stopped']){r.state=state;const ready=await r.ready();assert.equal(ready.ready,false);assert.equal(ready.recovered_task,true);assert.equal(ready.next_action,'inspect_prior_input_cleanup');assert.equal(ready.error.code,'recovered_cleanup_unverified');assert.equal(ready.replay_allowed,false);assert.equal(r.taskOpen,true);assert.equal(requests,0);}
});
test('durable unconfirmed Stop remains distinct across controller restart',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-unconfirmed-restart-')),latch=path.join(dir,'emergency.stop');fs.writeFileSync(latch,'unconfirmed:fixture');let requests=0;
 const guardian=new EventEmitter();guardian.send=()=>{};guardian.request=async()=>{requests++;return {state:'stopped',controls_visible:true};};
 const r=new Runtime({guardian,driver:{async abort(){}},sessions:{register(){}},latchFile:latch});
 try{assert.equal(r.state,'stopped');assert.equal(r.lastControlReason,'guardian_stop_unconfirmed');const ready=await r.ready();assert.equal(ready.error.code,'guardian_stop_unconfirmed');assert.equal(ready.next_action,'inspect_diagnostics');assert.equal(ready.replay_allowed,false);assert.equal(requests,0);guardian.emit('resume','idle','human_resume');assert.equal(r.state,'stopped');}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('explicit controls refuse unverified restart and Stop failures before starting guardian',async()=>{
 const r=fixture();let requests=0;r.guardian.request=async()=>{requests++;return {controls_visible:true};};
 r.recoveredTask=true;await assert.rejects(r.showControls(),e=>e.code==='recovered_cleanup_unverified');
 r.recoveredTask=false;r.state='stopped';r.lastControlReason='guardian_stop_unconfirmed';await assert.rejects(r.showControls(),e=>e.code==='guardian_stop_unconfirmed');
 r.lastControlReason='stop_persistence_failed';await assert.rejects(r.showControls(),e=>e.code==='stop_persistence_failed');
 r.lastControlReason='guard_persistence_failed';await assert.rejects(r.showControls(),e=>e.code==='guard_persistence_failed');assert.equal(requests,0);
 r.lastControlReason='persisted_emergency_stop';assert.equal((await r.showControls()).controls_visible,true);assert.equal(requests,1);assert.equal(r.state,'stopped');
});
test('ready reports unconfirmed cleanup instead of asking for repeated re-arm',async()=>{
 const r=fixture();r.state='stopped';r.lastControlReason='input_cleanup_failed';const ready=await r.ready();assert.equal(ready.ready,false);assert.equal(ready.next_action,'inspect_input_cleanup');assert.equal(r.state,'stopped');
});
test('task reservation remains open after actual controller process termination',{timeout:30000},async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-task-crash-')),file=path.join(dir,'task-state.json');
 const script=`import {Runtime} from ${JSON.stringify(new URL('../server/runtime.mjs',import.meta.url).href)};import {EventEmitter} from 'node:events';const guardian=new EventEmitter();guardian.send=()=>{};const r=new Runtime({guardian,driver:{async abort(){}},sessions:{register(){},close(){}},taskFile:process.argv[1]});r.beginTask();console.log('reserved');setInterval(()=>{},1000);`;
 const child=spawn(process.execPath,['--input-type=module','-e',script,file],{stdio:['ignore','pipe','pipe'],windowsHide:true});let output='',errors='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>errors+=x);
 const closed=new Promise(resolve=>child.once('close',resolve));
 try{
  const until=Date.now()+15000;while(!output.includes('reserved')&&child.exitCode===null&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,20));
  assert(output.includes('reserved'),errors);child.kill();await closed;
  const guardian=new EventEmitter();guardian.send=()=>{};const restarted=new Runtime({guardian,driver:{async abort(){}},sessions:{register(){},close(){}},taskFile:file});
  const saved=JSON.parse(fs.readFileSync(file));assert(saved.guard);assert.equal(restarted.priorGuard,saved.guard);assert.equal(restarted.status().task_open,true);await assert.rejects(restarted.finish(),e=>e.code==='recovered_cleanup_unverified');assert.equal(JSON.parse(fs.readFileSync(file)).open,true);
 }finally{if(child.exitCode===null&&child.signalCode===null)child.kill();await closed;fs.rmSync(dir,{recursive:true,force:true});}
});
test('pause invalidates frames synchronously and keeps per-app session grants',async()=>{
 const r=fixture();r.state='active';r.frames.set('old',{});r.grants.set('app',{});const generation=r.generation;const pending=r.pause();assert.equal(r.state,'paused');assert(r.generation>generation);assert.equal(r.frames.size,0);assert.equal(r.grants.size,1);await pending;assert.equal(r.driver.abortCalls,1);
});
test('emergency stop invalidates grants/frames before awaiting the native worker',async()=>{
 const r=fixture();r.state='active';r.frames.set('old',{});r.grants.set('app',{});const pending=r.stop();assert.equal(r.state,'stopped');assert.equal(r.frames.size,0);assert.equal(r.grants.size,0);await pending;
 await assert.rejects(r.grant(123,'cannot self-rearm'),e=>e.code==='control_inactive');
});
test('a stale guardian state or resume cannot override a persisted Stop',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-stop-event-')),latchFile=path.join(dir,'emergency.stop');const guardian=new EventEmitter();guardian.send=()=>{};guardian.request=async()=>({state:'idle',controls_visible:true});
 const r=new Runtime({guardian,driver:{async abort(){}},sessions:{register(){},close(){}},latchFile});
 try{
  r.state='active';await r.stop();guardian.emit('state','idle','normal_shutdown');guardian.emit('state','active');guardian.emit('resume','idle','human_resume');assert.equal(r.state,'stopped');
  const ready=await r.ready();assert.equal(ready.ready,false);assert.equal(ready.next_action,'awaiting_human_rearm');assert.equal(r.state,'stopped');
  r.state='idle';const staleReady=await r.ready();assert.equal(staleReady.ready,false);assert.equal(staleReady.next_action,'awaiting_human_rearm');assert.equal(r.state,'stopped');
  r.state='idle';r.stop=async()=>{r.state='stopped';r.lastControlReason='stop_persistence_failed';};const failedReady=await r.ready();assert.equal(failedReady.next_action,'inspect_stop_persistence_without_restart');assert.equal(failedReady.error.code,'stop_persistence_failed');
  r.state='active';assert.throws(()=>r.check(),e=>e.code==='control_stopped');assert.equal(r.state,'stopped');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Stop wins over a delayed successful native activation reply',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-activation-stop-')),latchFile=path.join(dir,'emergency.stop');const guardian=new EventEmitter();guardian.send=()=>{};guardian.prompt=async()=>({allowed:true});
 const r=new Runtime({guardian,driver:{info:{pid:123},async abort(){}},sessions:{register(){},close(){}},latchFile});const app={pid:11,started:'birth',path:'C:/fixture.exe',hwnd:1};r.app=async()=>app;
 guardian.request=async()=>{await r.stop();return {allowed:true};};
 try{await assert.rejects(r.grant(1,'fixture'),e=>e.code==='control_inactive');assert.equal(r.state,'stopped');assert.equal(r.grants.size,0);assert.equal(fs.readFileSync(latchFile,'utf8'),'stopped');}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('persisted Stop wins over cached grants and a soft-resume reply',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-latch-race-')),latchFile=path.join(dir,'emergency.stop');const guardian=new EventEmitter();guardian.send=()=>{};
 const r=new Runtime({guardian,driver:{async abort(){}},sessions:{register(){},close(){}},latchFile,permissionMode:'host-managed'});const app={pid:11,started:'birth',path:'C:/fixture.exe',hwnd:1};r.app=async()=>app;
 try{
  r.state='active';r.grants.set(appKey(app),app);fs.writeFileSync(latchFile,'stopped');await assert.rejects(r.grant(1,'fixture'),e=>e.code==='control_stopped');assert.equal(r.state,'stopped');assert.equal(r.grants.size,0);
  fs.unlinkSync(latchFile);r.state='paused';guardian.request=async()=>{fs.writeFileSync(latchFile,'stopped');return {allowed:true,state:'active'};};
  await assert.rejects(r.resume(),e=>e.code==='control_stopped');assert.equal(r.state,'stopped');assert.equal(fs.readFileSync(latchFile,'utf8'),'stopped');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('failed Stop persistence keeps the service stopped and refuses shutdown until repaired',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-stop-write-'));try{
  const r=fixture();r.state='active';r.latchFile=path.join(dir,'missing','emergency.stop');r.frames.set('old',{});r.grants.set('app',{});
  await assert.rejects(r.stop(),e=>e.code==='stop_persistence_failed');assert.equal(r.state,'stopped');assert.equal(r.frames.size,0);assert.equal(r.grants.size,0);assert.equal(r.driver.abortCalls,1);assert.equal(r.lastControlReason,'stop_persistence_failed');
  await assert.rejects(r.close(),e=>e.code==='stop_persistence_failed');assert.equal(r.state,'stopped');
  fs.mkdirSync(path.dirname(r.latchFile));await r.stop();assert.equal(fs.readFileSync(r.latchFile,'utf8'),'stopped');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('a native Stop event reports a missing latch while keeping control stopped',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-native-stop-'));const guardian=new EventEmitter();guardian.send=()=>{};const driver={abort:async()=>{}};
 try{const r=new Runtime({guardian,driver,sessions:{register(){},close(){}},latchFile:path.join(dir,'emergency.stop')});r.state='active';guardian.emit('state','stopped','escape');
  assert.equal(r.state,'stopped');assert.equal(r.lastControlReason,'stop_persistence_failed');assert.equal(r.diagnosticError,'stop_persistence_failed');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('persistence failure does not invite re-arm or launch a guardian from ready',async()=>{
 for(const reason of ['stop_persistence_failed','guard_persistence_failed']){const r=fixture();r.state='stopped';r.lastControlReason=reason;
  const result=await r.ready();assert.equal(result.ready,false);assert.equal(result.next_action,'inspect_stop_persistence_without_restart');assert.equal(result.controls_visible,null);assert.equal(r.guardian.messages.length,0);
  await assert.rejects(r.grant(1),e=>e.code===reason);await assert.rejects(r.launch({app:'anything.exe'}),e=>e.code===reason);assert.equal(r.guardian.messages.length,0);
 }
});
test('normal finish returns idle without requiring host restart',async()=>{
 const r=fixture();r.state='active';r.token='old';r.grants.set('app',{});const result=await r.finish();assert.equal(r.state,'idle');assert.equal(r.token,'');assert.equal(r.grants.size,0);assert.equal(result.restart_required,false);assert.equal(r.guardian.messages[0].op,'end');assert.equal(r.status().control_reason,'completed');r.guardian.emit('state','idle');assert.equal(r.status().control_reason,'completed');
});
test('native human pause notification invalidates cached observations',async()=>{
 const r=fixture();r.state='active';r.frames.set('old',{});r.guardian.emit('state','paused');assert.equal(r.state,'paused');assert.equal(r.frames.size,0);assert.equal(r.driver.abortCalls,1);
});
test('normal end cannot bypass emergency stop or human takeover',async()=>{
 for(const state of ['stopped','paused']) {
  const r=fixture();r.state=state;r.lastControlReason='human_takeover';await r.finish();assert.equal(r.state,state);assert.equal(r.status().control_reason,'human_takeover');
  await assert.rejects(r.grant(123,'cannot bypass human re-arm'),e=>e.code==='control_inactive');
 }
});
test('launch cannot restart a stopped guardian before checking the stop latch',async()=>{
 const r=fixture();r.state='stopped';let starts=0;r.guardian.start=async()=>{starts++;r.state='idle';};
 await assert.rejects(r.launch({app:'nonexistent.exe',reason:'must not re-arm'}),e=>e.code==='control_inactive');assert.equal(starts,0);
});
test('permission authority is fixed at startup and surfaced in status',()=>{
 const r=fixture();assert.equal(r.status().permission_mode,'standalone');
 assert.throws(()=>new Runtime({permissionMode:'turbo-from-model'}),/Invalid startup/);
});


test('host-authorized soft resume requires native consent and invalidates old observations',async()=>{
 const r=fixture();r.permissionMode='host-managed';r.state='paused';r.frames.set('old',{});const generation=r.generation;
 r.guardian.request=async m=>{assert.equal(m.op,'resume');return {allowed:true,state:'active'};};
 const result=await r.resume();assert.equal(r.state,'active');assert.equal(r.frames.size,0);assert(r.generation>generation);assert.equal(result.replayed_actions,0);assert.equal(r.status().control_reason,'host_authorized_resume');
});
test('chat resume never clears emergency stop or standalone human approval',async()=>{
 for(const [mode,state] of [['host-managed','stopped'],['standalone','paused'],['host-managed','idle']]){
  const r=fixture();r.permissionMode=mode;r.state=state;r.guardian.request=()=>{throw Error('must not ask native');};
  await assert.rejects(r.resume(),e=>e.code==='human_resume_required');assert.equal(r.state,state);
 }
});

test('emergency Stop wins a race with a successful native soft-resume reply',async()=>{
 const r=fixture();r.permissionMode='host-managed';r.state='paused';
 r.guardian.request=async()=>{r.guardian.emit('state','stopped','escape');return {allowed:true,state:'active'};};
 await assert.rejects(r.resume(),e=>e.code==='human_resume_required');assert.equal(r.state,'stopped');
 assert.equal(r.status().control_reason,'escape');
});

test('emergency Stop survives service replacement; ordinary idle shutdown does not create a latch',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-latch-'));const file=path.join(dir,'emergency.stop');
 const make=()=>{const r=fixture();r.latchFile=file;return r;};
 try {
  const ordinary=make();await ordinary.close();assert(!fs.existsSync(file));
  const stopped=make();await stopped.stop();assert(fs.existsSync(file));await stopped.finish();assert(fs.existsSync(file));
  const guardian=new EventEmitter();guardian.send=()=>{};guardian.request=async()=>({state:'stopped',controls_visible:true});
  const replacement=new Runtime({latchFile:file,guardian,driver:{abort:async()=>{}},sessions:{register(){}}});
  assert.equal(replacement.state,'stopped');await assert.rejects(replacement.grant(1),e=>e.code==='control_inactive');
  replacement.permissionMode='host-managed';await assert.rejects(replacement.resume(),e=>e.code==='human_resume_required');
  assert(fs.existsSync(file),'model operations must not remove the native human re-arm latch');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
