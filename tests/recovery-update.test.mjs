import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {PassThrough} from 'node:stream';import {EventEmitter} from 'node:events';import {generateKeyPairSync,sign} from 'node:crypto';
import {Guardian} from '../server/guardian.mjs';import {Runtime} from '../server/runtime.mjs';import {Incidents} from '../server/incidents.mjs';import {verifyRelease,verifyStaged,sha256,acquireUpdateLock,downloadFile} from '../server/update-core.mjs';import {testDirectory} from './paths.mjs';import {controllerStartSource} from '../scripts/install.mjs';
import {failureReply} from '../scripts/desktop.mjs';import {readBoundedJSON} from '../server/update-core.mjs';
import {spawn,spawnSync} from 'node:child_process';
import {serveDesktop} from '../server/desktop-service.mjs';import {BUILD_ID,VERSION} from '../server/version.mjs';
import {priorWindowsCleanupVerified,priorMacCleanupVerified,recoveryAdvice,safeWaitMetrics} from '../server/recovery.mjs';
test('wait error metrics accept only numeric fields and discard other content',()=>{
 assert.deepEqual(safeWaitMetrics({elapsed_ms:123,observations:2,polling_budget_ms:1000,text:'private content'}),{elapsed_ms:123,observations:2,polling_budget_ms:1000});
 assert.equal(safeWaitMetrics({elapsed_ms:'private',observations:1,polling_budget_ms:1000}),undefined);
});
test('session budget exhaustion gives bounded recovery without replay',()=>{
 assert.deepEqual(recoveryAdvice({error:{code:'session_limit'}}),{next_action:'end_owned_task_then_reauthorize',replay_allowed:false});
 assert.deepEqual(recoveryAdvice({input_completed:true,verification_error:{code:'session_limit'}}),{next_action:'inspect_effect_without_replay',replay_allowed:false});
 assert.deepEqual(recoveryAdvice({delivery_unknown:true,error:{code:'session_limit'}}),{next_action:'inspect_effect_without_replay',replay_allowed:false});
});
test('a busy input fence asks for a fresh observation rather than replay',()=>{
 assert.deepEqual(recoveryAdvice({error:{code:'another_session_busy'}}),{next_action:'wait_for_controller_then_observe',replay_allowed:false});
 assert.deepEqual(recoveryAdvice({delivery_unknown:true,error:{code:'another_session_busy'}}),{next_action:'inspect_effect_without_replay',replay_allowed:false});
});
test('prior Windows cleanup requires dead recorded processes and an empty exact ledger',()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'prior-ledger-')),guard='guard-101-12345678-1234-1234-1234-123456789abc.state',file=path.join(dir,guard);
 const record={guard,children:[102,103,104,105],dispatched:true,watchdogs_complete:true},dead=()=>{throw Object.assign(Error('gone'),{code:'ESRCH'});};
 try{
  fs.writeFileSync(file,'stopped||0|');fs.writeFileSync(file+'.watchdog','104|123456');fs.writeFileSync(file+'.inputs','');
  const verify=(r=record,probe=dead,platform='win32')=>priorWindowsCleanupVerified(dir,r,{platform,probe});
  assert.equal(verify(),true);assert.equal(verify(record,()=>{},'win32'),false);assert.equal(verify(record,dead,'darwin'),false);
  for(const pid of [101,102,103,104,105])assert.equal(verify(record,n=>{if(n===pid)return;return dead();}),false);
  assert.equal(verify({...record,guard:'../escape'}),false);assert.equal(verify({...record,dispatched:false}),false);assert.equal(verify({...record,watchdogs_complete:false}),false);assert.equal(verify({...record,children:[102,103,105]}),false);assert.equal(verify({...record,children:[]}),false);
  fs.writeFileSync(file+'.inputs','k:65:0:0');assert.equal(verify(),false);fs.writeFileSync(file+'.inputs','\n');assert.equal(verify(),false);fs.writeFileSync(file+'.inputs','');
  const unrelated=path.join(dir,'unrelated-empty');fs.writeFileSync(unrelated,'');fs.unlinkSync(file+'.inputs');fs.linkSync(unrelated,file+'.inputs');assert.equal(verify(),false);fs.unlinkSync(file+'.inputs');fs.writeFileSync(file+'.inputs','');
  if(process.platform!=='win32'){fs.unlinkSync(file+'.inputs');fs.symlinkSync(unrelated,file+'.inputs');assert.equal(verify(),false);fs.unlinkSync(file+'.inputs');fs.writeFileSync(file+'.inputs','');}
  fs.writeFileSync(file,'active|token|9|');assert.equal(verify(),false);fs.writeFileSync(file,'stopped||0|');
  fs.writeFileSync(file+'.watchdog','bad');assert.equal(verify(),false);fs.unlinkSync(file+'.watchdog');assert.equal(verify(),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('prior macOS cleanup requires dead recorded processes and an empty JSON ledger',()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'prior-mac-ledger-')),guard='guard-101-12345678-1234-1234-1234-123456789abc.state',file=path.join(dir,guard);
 const record={guard,children:[102,103,104],dispatched:true,watchdogs_complete:true},dead=()=>{throw Object.assign(Error('gone'),{code:'ESRCH'});};
 try{
  fs.writeFileSync(file,'stopped||0||0|0');fs.writeFileSync(file+'.watchdog','104|1793377319.476463');fs.writeFileSync(file+'.inputs','{"buttons":[],"keys":[]}');
  const verify=(r=record,probe=dead,platform='darwin')=>priorMacCleanupVerified(dir,r,{platform,probe});
  assert.equal(verify(),true);for(const incomplete of ['stopped||0||0|1','stopped||0|']){fs.writeFileSync(file,incomplete);assert.equal(verify(),false);}fs.writeFileSync(file,'stopped||0||0|0');assert.equal(verify(record,()=>{},'darwin'),false);assert.equal(verify(record,dead,'win32'),false);
  for(const pid of [101,102,103,104])assert.equal(verify(record,n=>{if(n===pid)return;return dead();}),false);
  fs.writeFileSync(file+'.inputs','{"buttons":[0],"keys":[]}');assert.equal(verify(),false);
  fs.writeFileSync(file+'.inputs','{"buttons":[],"keys":[42]}');assert.equal(verify(),false);
  fs.writeFileSync(file+'.inputs','');assert.equal(verify(),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('native build preserves another compiler output and an older host',{skip:process.platform!=='win32',timeout:60000},()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'parallel-build-')),bin=path.join(dir,'bin');fs.mkdirSync(bin);
 const other=path.join(bin,'.build-other-process.exe'),older=path.join(bin,'AxonHost-0123456789abcdef.exe');fs.writeFileSync(other,'another compiler');fs.writeFileSync(older,'another session');
 try{
  const script=`import {ensureHost} from ${JSON.stringify(new URL('../server/build.mjs',import.meta.url).href)};ensureHost({force:true});`;
  const env={...process.env,AGCU_DATA_DIR:dir};delete env.CU_PLUGIN_DATA;delete env.CLAUDE_PLUGIN_DATA;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{env,windowsHide:true,encoding:'utf8',timeout:55000});
  assert.equal(result.status,0,result.stderr);assert.equal(fs.readFileSync(other,'utf8'),'another compiler');assert.equal(fs.readFileSync(older,'utf8'),'another session');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('concurrent guardian requests wait for one ready process',async()=>{
 let starts=0,child;const spawnProcess=()=>{starts++;child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.kill=()=>child.emit('close',1);return child;};
 const g=new Guardian({}, {spawnProcess,host:()=>({exe:'fixture'}),bootTimeout:500});const a=g.start(),b=g.start();assert.equal(starts,1);child.stdout.write('{"ev":"ready","pid":123}\n');await Promise.all([a,b]);assert(g.initialized);child.emit('close',2);assert.equal(g.proc,null);assert.equal(g.state,'stopped');
});
test('early guardian exit rejects startup promptly and permits one explicit retry',async()=>{
 let child;const spawnProcess=()=>{child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.kill=()=>child.emit('close',1);return child;};
 const g=new Guardian({}, {spawnProcess,host:()=>({exe:'fixture'}),bootTimeout:500});const first=g.start();child.emit('close',3);await assert.rejects(first,e=>e.code==='guardian_exited');const next=g.start();child.stdout.write('{"ev":"ready","pid":123}\n');await next;child.emit('close',0);
});
test('asynchronous guardian pipe failure stops runtime and rejects pending work without replay',async()=>{
 let child,aborts=0;const spawnProcess=()=>{child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.kill=()=>true;return child;};
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'guardian-async-pipe-')),latch=path.join(dir,'stop');
 const guardian=new Guardian({}, {spawnProcess,host:()=>({exe:'fixture'}),bootTimeout:500});
 const runtime=new Runtime({guardian,driver:{async abort(){aborts++;}},sessions:{register(){}},latchFile:latch});
 try{
  const boot=guardian.start();child.stdout.write('{"ev":"ready","pid":123}\n');await boot;
  runtime.state='active';runtime.frames.set('old',{});runtime.grants.set('app',{});
  const pending=guardian.request({op:'capture'},{timeoutMs:1000});await Promise.resolve();
  child.stdin.emit('error',Error('broken pipe'));
  await assert.rejects(pending,e=>e.code==='guardian_write_failed'&&/do not replay/i.test(e.message));
  assert.equal(runtime.state,'stopped');assert.equal(runtime.lastControlReason,'guardian_stop_unconfirmed');assert.equal(runtime.frames.size,0);assert.equal(runtime.grants.size,0);assert.equal(aborts,1);assert.match(fs.readFileSync(latch,'utf8'),/^unconfirmed:/);assert.equal(guardian.pending.size,0);
  child.stdout.write('{"ev":"state","state":"active"}\n{"ev":"human_resume","state":"idle"}\n');assert.equal(guardian.state,'stopped');assert.equal(runtime.state,'stopped');
  await assert.rejects(guardian.start(),e=>e.code==='guardian_cleanup_unconfirmed');
  child.emit('close',1);assert.equal(runtime.lastControlReason,'guardian_stop_unconfirmed');
 }finally{fs.unlinkSync(runtime.guardFile);fs.rmSync(dir,{recursive:true,force:true});}
});
test('guardian pipe failure during startup rejects promptly and ignores a late ready',async()=>{
 let child,kills=0;const spawnProcess=()=>{child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.kill=()=>{kills++;return true;};return child;};
 const guardian=new Guardian({}, {spawnProcess,host:()=>({exe:'fixture'}),bootTimeout:1000});
 const pending=guardian.start();child.stdin.emit('error',Error('broken pipe'));
 await assert.rejects(pending,e=>e.code==='guardian_start_failed');assert.equal(kills,1);
 child.stdout.write('{"ev":"ready","pid":123}\n');assert.equal(guardian.initialized,false);assert.equal(guardian.state,'stopped');
 await assert.rejects(guardian.start(),e=>e.code==='guardian_cleanup_unconfirmed');child.emit('close',1);
});
test('guardian readiness timeout terminates the failed helper and clears startup state',async()=>{
 let killed=0;const spawnProcess=()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.kill=()=>{killed++;child.emit('close',null,'SIGTERM');};return child;};
 const g=new Guardian({}, {spawnProcess,host:()=>({exe:'fixture'}),bootTimeout:5});await assert.rejects(g.start(),e=>e.code==='guardian_start_timeout');assert.equal(killed,1);assert.equal(g.starting,null);assert.equal(g.proc,null);
});
test('bounded guardian capture timeout sends Stop and discards its pending request',async()=>{
 const sent=[];const guardian=new Guardian({});guardian.start=async()=>{};guardian.send=m=>sent.push(m);
 await assert.rejects(guardian.request({op:'capture'},{timeoutMs:100}),e=>e.code==='guardian_request_timeout');
 assert.equal(sent[0].op,'capture');assert.equal(sent[1].op,'stop');assert.equal(guardian.pending.size,0);
});
test('guardian write failure clears its timer and attempts Stop even if Stop also throws',async()=>{
 const sent=[],states=[];const guardian=new Guardian({});guardian.on('state',(state,reason)=>states.push({state,reason}));guardian.start=async()=>{};guardian.send=m=>{sent.push(m.op);throw Error('closed pipe');};
 await assert.rejects(guardian.request({op:'capture'},{timeoutMs:100}),e=>e.code==='guardian_write_failed'&&/do not replay/i.test(e.message));
 assert.deepEqual(sent,['capture','stop']);assert.equal(guardian.pending.size,0);assert.deepEqual(states,[{state:'stopped',reason:'guardian_unresponsive'}]);
 await new Promise(resolve=>setTimeout(resolve,130));assert.deepEqual(sent,['capture','stop']);
});
test('an unconfirmed guardian Stop invalidates runtime control and aborts its driver',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'guardian-write-stop-')),latch=path.join(dir,'stop');let aborts=0;
 const guardian=new Guardian({});guardian.start=async()=>{};guardian.send=()=>{throw Error('closed pipe');};
 const runtime=new Runtime({guardian,driver:{async abort(){aborts++;}},sessions:{register(){}},latchFile:latch});
 try{
  runtime.state='active';runtime.frames.set('old',{});runtime.grants.set('app',{});
  await assert.rejects(guardian.request({op:'capture'},{timeoutMs:100}),e=>e.code==='guardian_write_failed');
  assert.equal(runtime.state,'stopped');assert.equal(runtime.frames.size,0);assert.equal(runtime.grants.size,0);assert.equal(runtime.lastControlReason,'guardian_stop_unconfirmed');assert.match(fs.readFileSync(latch,'utf8'),/^unconfirmed:/);assert.equal(aborts,1);
  const ready=await runtime.ready();assert.equal(ready.error.code,'guardian_stop_unconfirmed');assert.equal(ready.replay_allowed,false);
  guardian.emit('state','stopped','old_notification');assert.equal(runtime.lastControlReason,'guardian_stop_unconfirmed');guardian.emit('state','active');guardian.emit('resume','idle','human_resume');assert.equal(runtime.state,'stopped');
  guardian.emit('state','stopped','stop_persistence_failed');assert.equal(runtime.lastControlReason,'stop_persistence_failed');
 }finally{fs.unlinkSync(runtime.guardFile);fs.rmSync(dir,{recursive:true,force:true});}
});
test('Stop persists its latch and aborts input even if guardian delivery throws',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'guardian-stop-write-')),latch=path.join(dir,'stop');let aborts=0;
 const guardian=new EventEmitter();guardian.send=()=>{throw Error('broken pipe');};
 const runtime=new Runtime({guardian,driver:{async abort(){aborts++;}},sessions:{register(){}},latchFile:latch});
 try{
  runtime.state='active';runtime.frames.set('old',{});runtime.grants.set('app',{});
  await assert.rejects(runtime.stop(),e=>e.code==='guardian_stop_unconfirmed');
  assert.equal(runtime.state,'stopped');assert.equal(runtime.frames.size,0);assert.equal(runtime.grants.size,0);assert.match(fs.readFileSync(latch,'utf8'),/^unconfirmed:/);assert.equal(aborts,1);
  assert.equal((await runtime.ready()).error.code,'guardian_stop_unconfirmed');guardian.emit('resume','idle','human_resume');assert.equal(runtime.state,'stopped');
  guardian.send=()=>true;await assert.rejects(runtime.stop(),e=>e.code==='guardian_stop_unconfirmed');assert.equal(runtime.lastControlReason,'guardian_stop_unconfirmed');
 }finally{fs.unlinkSync(runtime.guardFile);fs.rmSync(dir,{recursive:true,force:true});}
});
test('passive Stop persists without launching an absent guardian',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'guardian-passive-stop-')),latch=path.join(dir,'stop');let aborts=0;
 const guardian=new Guardian({});const runtime=new Runtime({guardian,driver:{async abort(){aborts++;}},sessions:{register(){}},latchFile:latch});
 try{const result=await runtime.stop();assert.equal(result.stopped,true);assert.equal(fs.readFileSync(latch,'utf8'),'stopped');assert.equal(aborts,1);assert.equal(guardian.proc,undefined);}
 finally{fs.unlinkSync(runtime.guardFile);fs.rmSync(dir,{recursive:true,force:true});}
});
test('Stop still aborts input when both guardian delivery and latch persistence fail',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'guardian-double-fail-'));let aborts=0;
 const guardian=new EventEmitter();guardian.send=()=>{throw Error('broken pipe');};
 const runtime=new Runtime({guardian,driver:{async abort(){aborts++;}},sessions:{register(){}},latchFile:path.join(dir,'missing','stop')});
 try{runtime.state='active';await assert.rejects(runtime.stop(),e=>e.code==='stop_persistence_failed');assert.equal(runtime.state,'stopped');assert.equal(aborts,1);assert.equal(runtime.lastControlReason,'stop_persistence_failed');}
 finally{fs.unlinkSync(runtime.guardFile);fs.rmSync(dir,{recursive:true,force:true});}
});
test('ready prioritizes unconfirmed input cleanup over an unconfirmed guardian Stop',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'guardian-cleanup-priority-')),latch=path.join(dir,'stop');
 const guardian=new EventEmitter();guardian.send=()=>{throw Error('broken pipe');};const driver={inputMayBeHeld:true,async abort(){throw Object.assign(Error('unconfirmed'),{code:'input_cleanup_failed'});}};
 const runtime=new Runtime({guardian,driver,sessions:{register(){}},latchFile:latch});
 try{runtime.state='active';await assert.rejects(runtime.stop(),e=>e.code==='input_cleanup_failed');const ready=await runtime.ready();assert.equal(ready.next_action,'inspect_input_cleanup');assert.equal(ready.error.code,'input_cleanup_failed');assert.equal(ready.replay_allowed,false);}
 finally{fs.unlinkSync(runtime.guardFile);fs.rmSync(dir,{recursive:true,force:true});}
});
test('guardian timeout still rejects when its Stop write throws',async()=>{
 const sent=[];const guardian=new Guardian({});guardian.start=async()=>{};guardian.send=m=>{sent.push(m.op);if(m.op==='stop')throw Error('closed pipe');};
 await assert.rejects(guardian.request({op:'capture'},{timeoutMs:100}),e=>e.code==='guardian_request_timeout');
 assert.deepEqual(sent,['capture','stop']);assert.equal(guardian.pending.size,0);
});
test('guardian rejects an unavailable pipe promptly without mistaking backpressure for failure',async()=>{
 const guardian=new Guardian({});guardian.start=async()=>{};guardian.proc={killed:false,stdin:{destroyed:true}};
 await assert.rejects(guardian.request({op:'capture'},{timeoutMs:100}),e=>e.code==='guardian_write_failed');assert.equal(guardian.pending.size,0);
 let writes=0;guardian.proc={killed:false,stdin:{destroyed:false,write(){writes++;return false;}}};
 await assert.rejects(guardian.request({op:'capture'},{timeoutMs:100}),e=>e.code==='guardian_request_timeout');assert.equal(writes,2);assert.equal(guardian.pending.size,0);
});
test('guardian shutdown waits for actual exit and refuses replacement after unconfirmed cleanup',async()=>{
 let child,starts=0,kills=0;const spawnProcess=()=>{starts++;child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.kill=()=>{kills++;return true;};return child;};
 const g=new Guardian({}, {spawnProcess,host:()=>({exe:'fixture'}),bootTimeout:500,shutdownGrace:5,killTimeout:15});
 const start=g.start();child.stdout.write('{"ev":"ready","pid":123}\n');await start;
 const first=g.close({normal:true}),second=g.close({normal:true});
 for(const promise of [first,second])await assert.rejects(promise,e=>e.code==='guardian_cleanup_unconfirmed');
 assert.equal(kills,1);assert.equal(g.proc,child);await assert.rejects(g.start(),e=>e.code==='guardian_cleanup_unconfirmed');assert.equal(starts,1);
 child.emit('close',0);assert.equal(g.proc,null);
 const next=g.start();child.stdout.write('{"ev":"ready","pid":124}\n');await next;child.emit('close',0);
});
test('guardian shutdown confirms a late exit after termination request',async()=>{
 let child;const spawnProcess=()=>{child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.kill=()=>{setTimeout(()=>child.emit('close',0),5);return true;};return child;};
 const g=new Guardian({}, {spawnProcess,host:()=>({exe:'fixture'}),bootTimeout:500,shutdownGrace:5,killTimeout:100});
 const start=g.start();child.stdout.write('{"ev":"ready","pid":123}\n');await start;await g.close({normal:true});assert.equal(g.proc,null);assert.equal(g.state,'idle');
});
test('a timed-out guardian cannot be restarted while its prior process remains live',async()=>{
 let child,starts=0;const spawnProcess=()=>{starts++;child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.kill=()=>true;return child;};
 const g=new Guardian({}, {spawnProcess,host:()=>({exe:'fixture'}),bootTimeout:5});await assert.rejects(g.start(),e=>e.code==='guardian_start_timeout');
 await assert.rejects(g.start(),e=>e.code==='guardian_cleanup_unconfirmed');assert.equal(starts,1);child.emit('close',1);
});
test('ready reveals stopped controls without rearming; failure is bounded',async()=>{
 let calls=0;const r={state:'stopped',status:()=>({state:'stopped'}),guardian:{proc:{}},async showControls(){calls++;return{controls_visible:true};}};
 const ready=await Runtime.prototype.ready.call(r);assert.equal(ready.next_action,'awaiting_human_rearm');assert.equal(r.state,'stopped');
 r.showControls=async()=>{calls++;throw Error('private stderr');};assert.equal((await Runtime.prototype.ready.call(r)).next_action,'inspect_diagnostics');await Runtime.prototype.ready.call(r);assert.equal(calls,2);
 for(const platform of ['win32','darwin']){
  const source=controllerStartSource(null,platform);
  assert.match(source,/mjs" start/);assert.match(source,/mjs" controls/);
  assert(source.indexOf('mjs" start')<source.indexOf('mjs" controls'));
  assert(!source.includes('rearm'),'the human launcher reveals controls; only the local button clears Stop');
 }
});
test('ready reserves the task until end confirms input cleanup, including idle release',async()=>{
 let failAbort=false;const r={taskOpen:false,state:'idle',generation:0,frames:new Map(),grants:new Map(),token:'',guardian:{proc:{},send(){}},driver:{async abort(){if(failAbort)throw Error('cleanup failed');}},status(){return {state:this.state,task_open:this.taskOpen};},async showControls(){return {controls_visible:true,state:'idle'};}};
 await Runtime.prototype.ready.call(r);assert.equal(r.taskOpen,true);
 await Runtime.prototype.finish.call(r,{preserveTask:true});assert.equal(r.taskOpen,true);
 failAbort=true;await assert.rejects(Runtime.prototype.finish.call(r));assert.equal(r.taskOpen,true);
 failAbort=false;await Runtime.prototype.finish.call(r);assert.equal(r.taskOpen,false);
});
test('ready treats an invisible control reply as a bounded diagnostic failure',async()=>{
 let calls=0;
 const runtime={state:'stopped',status:()=>({state:'stopped'}),guardian:{proc:{},initialized:true},async showControls(){calls++;return {state:'stopped',controls_visible:false};}};
 for(let i=0;i<2;i++){
  const result=await Runtime.prototype.ready.call(runtime);
  assert.equal(result.ready,false);assert.equal(result.controls_visible,false);
  assert.equal(result.error?.code,'guardian_controls_not_visible');
  assert.equal(result.next_action,'inspect_diagnostics');
  assert.equal(result.guardian_running,true);
 }
 assert.equal(calls,1,'an unresolved episode must not repeat startup');
 assert.equal(runtime.state,'stopped');
 const directory=fs.mkdtempSync(path.join(testDirectory('tmp'),'hidden-controls-'));
 try{const incidents=new Incidents(directory);assert(incidents.record('computer_ready',await Runtime.prototype.ready.call(runtime)));assert.equal(incidents.read()[0].code,'guardian_controls_not_visible');}
 finally{fs.rmSync(directory,{recursive:true});}
});
test('ready keeps the visible-desktop handoff explicit across repeated failed calls',async()=>{
 let calls=0;
 const runtime={state:'stopped',status:()=>({state:'stopped'}),guardian:{proc:null},async showControls(){calls++;throw Object.assign(Error('Isolated desktop'),{code:'desktop_context_unavailable'});}};
 for(let i=0;i<2;i++){
  const result=await Runtime.prototype.ready.call(runtime);
  assert.equal(result.next_action,'human_start_on_visible_desktop');
  assert.equal(result.guardian_running,false);assert.equal(result.controls_visible,null);assert.equal(result.ready,false);
 }
 assert.equal(calls,1);assert.equal(runtime.state,'stopped');
});
test('a controls timeout leaves visibility unknown instead of claiming hidden',async()=>{
 const runtime={state:'stopped',status:()=>({state:'stopped'}),guardian:{proc:{}},async showControls(){throw Object.assign(Error('timeout'),{code:'guardian_request_timeout'});}};
 const result=await Runtime.prototype.ready.call(runtime);assert.equal(result.ready,false);assert.equal(result.controls_visible,null);assert.equal(result.next_action,'inspect_diagnostics');
});
test('the actual human launcher can reveal controls after cached ready failure without clearing Stop',async t=>{
 const folder=fs.mkdtempSync(path.join(testDirectory('tmp'),'human-starter-'));
 const directory=path.join(folder,'data');let shows=0;
 const runtime={state:'stopped',permissionMode:'standalone',recoveryFailure:{code:'guardian_exited'},
  status(){return {state:this.state,build_id:BUILD_ID,build_version:VERSION,permission_mode:this.permissionMode};},
  guardian:{async request(){shows++;return {state:'stopped',controls_visible:true};}},
  showControls:Runtime.prototype.showControls,async close(){}};
 const service=await serveDesktop({directory,runtime});
 try{
  const latch=path.join(directory,'emergency.stop');fs.writeFileSync(latch,'stopped');
  const starter=path.join(folder,process.platform==='win32'?'Start Computer Use.cmd':'Start Computer Use.command');
  fs.copyFileSync(process.execPath,path.join(folder,process.platform==='win32'?'cu-node.exe':'cu-node'));
  if(process.platform!=='win32')fs.chmodSync(path.join(folder,'cu-node'),0o700);
  fs.writeFileSync(path.join(folder,'cu.mjs'),`import {main} from ${JSON.stringify(new URL('../scripts/desktop.mjs',import.meta.url).href)}; await main();\n`);
  fs.writeFileSync(starter,controllerStartSource(null));
  const started=Date.now();const output=await new Promise((resolve,reject)=>{
   const child=process.platform==='win32'?spawn(process.env.ComSpec||'C:/Windows/System32/cmd.exe',['/d','/s','/c',`""${starter}""`],{windowsVerbatimArguments:true,windowsHide:true,env:{...process.env,AGCU_DATA_DIR:directory,AGCU_PERMISSION_MODE:'standalone'},stdio:['ignore','pipe','pipe']}):spawn('/bin/sh',[starter],{env:{...process.env,AGCU_DATA_DIR:directory,AGCU_PERMISSION_MODE:'standalone'},stdio:['ignore','pipe','pipe']});
   let stdout='',stderr='',timedOut=false;const timer=setTimeout(()=>{timedOut=true;
    if(process.platform==='win32'&&child.pid)spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,timeout:5000});else child.kill();
   },30000);
   child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
   child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',code=>{clearTimeout(timer);timedOut?reject(Error('Human launcher fixture timed out: '+stderr)):code===0?resolve(stdout):reject(Error(stderr||stdout));});
  });
  if(Date.now()-started>10000)t.diagnostic('Human launcher fixture exceeded the previous 10-second bound: '+(Date.now()-started)+' ms');
  assert.equal(shows,1);assert.equal(runtime.recoveryFailure,null);assert.equal(runtime.state,'stopped');
  assert.equal(fs.readFileSync(latch,'utf8'),'stopped');assert.match(output,/"controls_visible":true/);
 }finally{await service.shutdown();fs.rmSync(folder,{recursive:true,force:true});}
});
test('incidents deduplicate and never contain error messages or request text',()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'incident-'));try{const i=new Incidents(dir);for(let n=0;n<2;n++)i.record('computer_click',{error:{code:'guardian_exited',message:'SECRET C:/private'},text:'password'});const records=i.read();assert.equal(records.length,1);assert.equal(records[0].count,2);assert(!fs.readFileSync(i.file,'utf8').includes('SECRET'));}finally{fs.rmSync(dir,{recursive:true});}
});
test('incident publication preserves the prior journal if writer ownership is lost',()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'incident-fence-'));try{
  const journal=new Incidents(dir);journal.record('computer_click',{error:{code:'stale_observation'}});const original=fs.readFileSync(journal.file,'utf8');
  assert.throws(()=>journal.record('computer_ready',{error:{code:'guardian_exited'}},{guard:()=>{throw Object.assign(Error('ownership lost'),{code:'service_ownership_lost'});}}),e=>e.code==='service_ownership_lost');
  assert.equal(fs.readFileSync(journal.file,'utf8'),original);assert.deepEqual(fs.readdirSync(dir),['incidents.json']);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('signed update metadata refuses tampering, wrong platform, expired releases and unsafe paths',()=>{
 const {publicKey,privateKey}=generateKeyPairSync('ed25519');const manifest={schema:1,build_id:'a'.repeat(64),version:'1.0.0',sequence:1,platform:process.platform,arch:process.arch,min_os:'0.0.0',expires:'2099-01-01',files:{'node':{size:3,sha256:sha256('abc'),url:'https://github.com/shayann07/antigravity-computer-use/releases/download/v1/node'}}};
 const check=m=>{const bytes=Buffer.from(JSON.stringify(m));return verifyRelease(bytes,sign(null,bytes,privateKey).toString('base64'),publicKey);};assert.equal(check(manifest).version,'1.0.0');
 assert.throws(()=>verifyRelease(Buffer.from('{}'),'bad',publicKey));assert.throws(()=>check({...manifest,arch:'wrong'}));assert.throws(()=>check({...manifest,min_os:'9999.0.0'}));assert.throws(()=>check({...manifest,expires:'2020-01-01'}));assert.throws(()=>check({...manifest,files:{'../escape':manifest.files.node}}));
 for(const invalid of ['..','1..2','1.2.x','1.2.3.4','9007199254740992.0.0'])assert.throws(()=>check({...manifest,min_os:invalid}),/release_os_invalid/);
 const bytes=Buffer.from(JSON.stringify(manifest)),signature=sign(null,bytes,privateKey).toString('base64');
 for(const invalid of ['unknown','1..2','9007199254740992.0.0'])assert.throws(()=>verifyRelease(bytes,signature,publicKey,{osRelease:invalid}),/current_os_unknown/);
 assert.equal(verifyRelease(bytes,signature,publicKey,{osRelease:'1.0.0'}).version,'1.0.0');
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'update-'));try{fs.writeFileSync(path.join(dir,'node'),'abc');verifyStaged(dir,manifest);fs.writeFileSync(path.join(dir,'node'),'bad');assert.throws(()=>verifyStaged(dir,manifest));const release=acquireUpdateLock(dir);assert.throws(()=>acquireUpdateLock(dir));release();}finally{fs.rmSync(dir,{recursive:true});}
});
test('interrupted or oversized downloads never publish a partial payload',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'download-'));try{const destination=path.join(dir,'payload');await assert.rejects(downloadFile('fixture',destination,{size:3,hash:sha256('abc'),fetcher:async()=>({ok:true,body:(async function*(){yield Buffer.from('oversized');})()})}));assert(!fs.existsSync(destination));assert(!fs.existsSync(destination+'.part'));}finally{fs.rmSync(dir,{recursive:true});}
});
test('download handles short disk writes and refuses a stalled writer without publishing',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'short-write-'));try{
  const destination=path.join(dir,'payload'),fetcher=async()=>({ok:true,body:(async function*(){yield Buffer.from('abcdef');})()});
  let writes=0;const short={...fs,writeSync(fd,bytes,offset,length){writes++;return fs.writeSync(fd,bytes,offset,Math.min(2,length));}};
  await downloadFile('fixture',destination,{size:6,hash:sha256('abcdef'),fetcher,io:short});assert.equal(fs.readFileSync(destination,'utf8'),'abcdef');assert.equal(writes,3);
  const failed=path.join(dir,'stalled'),stalled={...fs,writeSync(){return 0;}};
  await assert.rejects(downloadFile('fixture',failed,{size:6,hash:sha256('abcdef'),fetcher,io:stalled}),/update_download_write_failed/);assert(!fs.existsSync(failed));assert(!fs.existsSync(failed+'.part'));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('explicit controls can recover a failed episode without clearing emergency Stop',async()=>{
 const r={state:'stopped',recoveryFailure:{code:'guardian_unavailable'},guardian:{async request(){return {state:'stopped',controls_visible:true};}}};
 const response=await Runtime.prototype.showControls.call(r);assert(response.controls_visible);assert.equal(r.recoveryFailure,null);assert.equal(r.state,'stopped');
});
test('launcher failures have a structured recovery action without exposing synthetic approval',()=>{
 const result=failureReply(Object.assign(Error('Local setup failed'),{code:'guardian_spawn_failed'}),{record:false});assert.equal(result.ok,false);assert.equal(result.next_action,'inspect_diagnostics');assert.equal(result.error.code,'guardian_spawn_failed');assert(!Object.hasOwn(result,'approved'));
});
test('isolated-desktop guardian errors survive startup and never report visible controls',async()=>{
 let child;const spawnProcess=()=>{child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.kill=()=>child.emit('close',1);return child;};
 const guardian=new Guardian({}, {spawnProcess,host:()=>({exe:'fixture'}),bootTimeout:500});const boot=guardian.start();child.stdout.write(JSON.stringify({ev:'error',code:'desktop_context_unavailable',message:'Hidden desktop'})+'\n');await assert.rejects(boot,e=>e.code==='desktop_context_unavailable');assert.equal(guardian.initialized,false);
 const runtime={guardian,state:'idle',status:()=>({state:'idle'}),async showControls(){return {controls_visible:false,error:{code:'desktop_context_unavailable',message:'Hidden desktop'}};}};
 const result=await Runtime.prototype.ready.call(runtime);assert.equal(result.ready,false);assert.equal(result.controls_visible,false);assert.equal(result.error.code,'desktop_context_unavailable');
});
test('streamed release metadata refuses oversized bodies before buffering all chunks',async()=>{
 let chunks=0;const reply={ok:true,body:(async function*(){for(let i=0;i<20;i++){chunks++;yield Buffer.alloc(8);}})()};await assert.rejects(readBoundedJSON(reply,12),/update_metadata_size/);assert.equal(chunks,2);
 assert.deepEqual(await readBoundedJSON({ok:true,body:(async function*(){yield Buffer.from('{"ok":');yield Buffer.from('true}');})()},100),{ok:true});
});

test('prior cleanup rejects one-bit file identity and nanosecond changes on both platforms',()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'prior-identity-')),guard='guard-101-12345678-1234-1234-1234-123456789abc.state',file=path.join(dir,guard);
 const record={guard,children:[102,103,104],dispatched:true,watchdogs_complete:true},probe=()=>{throw Object.assign(Error('gone'),{code:'ESRCH'});};
 try{
  fs.writeFileSync(file,'stopped||0|');fs.writeFileSync(file+'.watchdog','104|123456');
  for(const [platform,verify]of [['win32',priorWindowsCleanupVerified],['darwin',priorMacCleanupVerified]]){
   fs.writeFileSync(file,platform==='win32'?'stopped||0|':'stopped||0||0|0');fs.writeFileSync(file+'.inputs',platform==='win32'?'':JSON.stringify({keys:[],buttons:[]}));
   assert.equal(verify(dir,record,{platform,probe}),true);
   for(const field of ['ino','mtimeNs','ctimeNs','size']){
    const io=Object.create(fs);let reads=0;
    io.lstatSync=(name,options)=>{assert.equal(options.bigint,true);const stat=fs.lstatSync(name,options);if(name===file+'.inputs'&&++reads===2)stat[field]+=1n;return stat;};
    assert.equal(verify(dir,record,{platform,probe,io}),false,platform+': changed '+field+' must refuse');
   }
  }
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
