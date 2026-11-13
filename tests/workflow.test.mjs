import {testDirectory} from './paths.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {Runtime,savedTakeoverMode,appKey,queryNodes} from '../server/runtime.mjs';
import {Driver} from '../server/driver.mjs';
import {failureReply} from '../scripts/desktop.mjs';
import {EventEmitter} from 'node:events';import fs from 'node:fs';
import path from 'node:path';import {dataDir} from '../server/build.mjs';
import {spawn} from 'node:child_process';

test('native action dispatch follows durable child recording and refuses a failed record',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'dispatch-record-')),file=path.join(dir,'task-state.json');let sent=0;
 const guardian=new EventEmitter();guardian.pid=111;guardian.send=()=>{};
 const driver={info:{pid:222},epoch:1,async start(){},async abort(){},async call(op){if(op==='authorize')return {result:{sensitive:false}};sent++;const saved=JSON.parse(fs.readFileSync(file));assert.equal(saved.dispatched,true);assert.deepEqual(saved.children,[111,222]);return {result:{ok:true}};}};
 const r=new Runtime({guardian,driver,sessions:{register(){},close(){},async withInput(_op,_target,execute){return execute();}},taskFile:file});
 try{
  r.beginTask();r.state='active';r.deadline=Date.now()+10000;assert.equal((await r.action('clipboard',{reason:'inert fixture'})).input_completed,true);assert.equal(sent,1);
  r.dispatchStarted=false;r.dispatchChildren=[];r.taskFile=path.join(dir,'missing','state.json');
  await assert.rejects(r.action('clipboard',{reason:'inert fixture'}),e=>e.code==='task_state_write_failed');assert.equal(sent,1);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('passive startup, status, End and shutdown preserve Stop without opening controls',async()=>{
 const folder=fs.mkdtempSync(path.join(testDirectory('tmp'),'passive-stop-'));
 const latch=path.join(folder,'emergency.stop');fs.writeFileSync(latch,'stopped');
 const guardian=new EventEmitter();let starts=0,requests=0,aborts=0;
 Object.assign(guardian,{async start(){starts++;},async request(){requests++;},send(){},async close(){}});
 const r=new Runtime({guardian,driver:{async abort(){aborts++;}},sessions:{register(){},close(){}},latchFile:latch});
 try {
  await r.prepare();assert.equal(r.status().state,'stopped');
  await r.finish();assert.equal(r.status().state,'stopped');
  await r.close();assert.equal(r.status().state,'stopped');
  assert.equal(starts,0);assert.equal(requests,0);assert(aborts>0);
  assert(fs.existsSync(latch));assert.equal(r.frames.size,0);assert.equal(r.grants.size,0);
 }finally{fs.unlinkSync(r.guardFile);fs.rmSync(folder,{recursive:true,force:true});}
});

test('blocked control request explicitly reveals human re-arm without granting or launching',async()=>{
 for(const operation of ['grant','launch']){
  const sent=[];const guardian=new EventEmitter();Object.assign(guardian,{async request(m){sent.push(m);return {state:'stopped',human_rearm_required:true};}});
  const r=new Runtime({guardian,driver:{async abort(){},async call(){assert.fail('No desktop input or discovery while stopped');}},sessions:{register(){}}});
  try{
   r.state='stopped';
   await assert.rejects(operation==='grant'?r.grant(1,'Explicit task'):r.launch({app:'unused.exe',reason:'Explicit task'}),e=>e.code==='control_inactive');
   assert.deepEqual(sent,[{op:'show_controls'}]);assert.equal(r.state,'stopped');assert.equal(r.grants.size,0);
  }finally{fs.unlinkSync(r.guardFile);}
 }
});

test('unconfirmed held-input recovery requests Stop and returns an actionable failure',async()=>{
 for(const recovery of [async()=>false,async()=>{throw Error('helper missing');}]){
  const events=[];const driver={epoch:1,proc:null,pending:new Map(),inputMayBeHeld:true,info:null,ready:null,
   _failAll(){},releaseHeldInputs:recovery,onEvent:event=>events.push(event),onLog(){}};
  await assert.rejects(Driver.prototype._abort.call(driver),e=>e.code==='input_cleanup_failed');
  assert.deepEqual(events,[{event:'input_cleanup_failed'}]);assert.equal(driver.epoch,2);assert.equal(driver.inputMayBeHeld,true);
 }
});
test('held input stays pending across failed cleanup attempts until release is confirmed',async()=>{
 let attempts=0,allowed=false;const driver={epoch:1,proc:null,pending:new Map(),inputMayBeHeld:true,info:null,ready:null,_failAll(){},onEvent(){},onLog(){},async releaseHeldInputs(){attempts++;return allowed;}};
 for(let n=0;n<2;n++){await assert.rejects(Driver.prototype._abort.call(driver),e=>e.code==='input_cleanup_failed');assert.equal(driver.inputMayBeHeld,true);}
 await assert.rejects(Driver.prototype.start.call(driver),e=>e.code==='input_cleanup_failed');assert.equal(attempts,2);
 allowed=true;await Driver.prototype._abort.call(driver);assert.equal(attempts,3);assert.equal(driver.inputMayBeHeld,false);
 await Driver.prototype._abort.call(driver);assert.equal(attempts,3);
});
test('unconfirmed worker termination keeps cleanup pending and blocks native restart',async()=>{
 const child=new EventEmitter();child.exitCode=null;child.signalCode=null;child.stdin={destroy(){}};let kills=0;child.kill=()=>{kills++;return false;};
 const order=[];const driver=new Driver({onEvent:()=>order.push('stop')});driver.proc=child;driver.exitTimeoutMs=10;driver.inputMayBeHeld=true;let releases=0;driver.releaseHeldInputs=async()=>{order.push('release');releases++;return true;};
 for(let i=0;i<2;i++){
  await assert.rejects(driver.abort(),e=>e.code==='input_cleanup_failed');assert.equal(driver.retiring,child);assert.equal(driver.inputMayBeHeld,true);await assert.rejects(driver.start(),e=>e.code==='input_cleanup_failed');
 }
 assert.equal(kills,2);assert.equal(releases,2);assert.deepEqual(order,['stop','release','stop','release']);child.exitCode=0;child.emit('exit',0);
 await driver.abort();assert.equal(driver.retiring,null);assert.equal(driver.inputMayBeHeld,false);assert.equal(releases,3);
});
test('worker error retains a possibly live child until its exit is confirmed',async()=>{
 const child=new EventEmitter();child.pid=123;child.exitCode=null;child.signalCode=null;child.stdin={destroy(){}};child.kill=()=>false;
 const driver=new Driver();driver.proc=child;driver.exitTimeoutMs=10;let releases=0;driver.releaseHeldInputs=async()=>{releases++;return true;};
 driver.workerFailed(child,Error('worker error'));assert.equal(driver.retiring,child);assert.equal(driver.inputMayBeHeld,true);
 await assert.rejects(driver.aborting,e=>e.code==='input_cleanup_failed');assert.equal(driver.retiring,child);assert.equal(releases,1);
 child.exitCode=1;child.emit('exit',1);await driver.abort();assert.equal(driver.retiring,null);assert.equal(driver.inputMayBeHeld,false);assert.equal(releases,2);
});
test('lost worker responses mark effects unknown without misclassifying observations',async()=>{
 for(const op of ['click','close_window','clipboard','open','launch','snapshot']){
  const child=new EventEmitter();child.exitCode=1;child.signalCode=null;child.stdin={write(){}};
  const driver=new Driver();driver.proc=child;driver.info={};driver.releaseHeldInputs=async()=>true;
  const request=driver.call(op,{});await new Promise(resolve=>setImmediate(resolve));
  driver.workerFailed(child,Object.assign(Error('worker exited'),{code:'host_exited'}));
  await assert.rejects(request,e=>e.code===(op==='snapshot'?'host_exited':'input_outcome_unknown')&&(op==='snapshot'||/do not repeat/i.test(e.hint)));
  if(driver.aborting)await driver.aborting;
 }
});
test('timeouts and failed writes do not invite replay of effectful operations',async()=>{
 for(const failure of ['timeout','write'])for(const op of ['click','launch','snapshot']){
  const driver=new Driver({timeoutMs:10});driver.info={};driver.proc={stdin:{write(){if(failure==='write')throw Error('broken pipe');}}};
  let aborts=0;driver.abort=async()=>{aborts++;};
  await assert.rejects(driver.call(op,{}),e=>e.code===(op==='snapshot'?(failure==='write'?'host_write_failed':'op_timeout'):'input_outcome_unknown'));
  assert.equal(aborts,failure==='timeout'||op!=='snapshot'?1:0);
 }
});
test('timed-out read-only snapshot fences replacement until worker exit is confirmed',async()=>{
 const child=new EventEmitter();child.pid=123;child.exitCode=null;child.signalCode=null;child.stdin={write(){},destroy(){}};child.kill=()=>false;
 const driver=new Driver({timeoutMs:10});driver.proc=child;driver.info={};driver.exitTimeoutMs=30;let releases=0;driver.releaseHeldInputs=async()=>{releases++;return true;};
 await assert.rejects(driver.call('snapshot',{}),e=>e.code==='op_timeout');
 const retiring=driver.aborting;assert(retiring);await assert.rejects(retiring,e=>e.code==='input_cleanup_failed');
 assert.equal(driver.retiring,child);assert.equal(driver.inputMayBeHeld,true);assert.equal(releases,1);await assert.rejects(driver.start(),e=>e.code==='input_cleanup_failed');
 child.exitCode=1;child.emit('exit',1);await driver.abort();assert.equal(driver.retiring,null);assert.equal(driver.inputMayBeHeld,false);
});
test('wait observation timeout retires the actual Driver before replacement',async()=>{
 const child=new EventEmitter();child.pid=123;child.exitCode=null;child.signalCode=null;child.stdin={write(){},destroy(){}};child.kill=()=>false;
 const driver=new Driver();driver.proc=child;driver.info={};driver.exitTimeoutMs=3000;let launches=0;driver._launch=async()=>{launches++;return {pid:456};};
 const runtime={driver,frames:new Map(),async grant(){return{hwnd:1,pid:9,started:'one',path:'app.exe'};},check(){},guardian:{send(){}},stamp(){return{};}};
 await assert.rejects(Runtime.prototype.observe.call(runtime,{hwnd:1,with_image:false,native_snapshot_deadline:performance.now()+100,require_native_budget:true}),e=>e.code==='op_timeout');
 const replacement=driver.start();await new Promise(resolve=>setImmediate(resolve));assert.equal(launches,0);assert.equal(driver.retiring,child);
 child.exitCode=1;child.emit('exit',1);assert.deepEqual(await replacement,{pid:456});assert.equal(launches,1);
});
test('stalled wait screenshot restores overlay and fences the actual Driver',async()=>{
 const child=new EventEmitter();child.pid=123;child.exitCode=null;child.signalCode=null;child.kill=()=>false;const calls=[];let driver;
 child.stdin={destroy(){},write(payload){const request=JSON.parse(payload);calls.push(request.op);if(request.op==='snapshot')setImmediate(()=>driver._onLine(JSON.stringify({id:request.id,ok:true,result:{snapshot_id:'s',nodes:[]}})));}};
 driver=new Driver();driver.proc=child;driver.info={};driver.exitTimeoutMs=3000;let launches=0;driver._launch=async()=>{launches++;return{pid:456};};
 const sent=[];const runtime={driver,frames:new Map(),async grant(){return{hwnd:1,pid:9,started:'one',path:'app.exe',rect:[0,0,800,600]};},check(){},guardian:{send(m){sent.push(m.op);},async request(){}},stamp(){return{};}};
 await assert.rejects(Runtime.prototype.observe.call(runtime,{hwnd:1,native_snapshot_deadline:performance.now()+1000,require_native_budget:true}),e=>e.code==='op_timeout');
 assert.deepEqual(calls,['snapshot','screenshot']);assert(sent.includes('capture_end'));
 const replacement=driver.start();await new Promise(resolve=>setImmediate(resolve));assert.equal(launches,0);assert.equal(driver.retiring,child);
 child.exitCode=1;child.emit('exit',1);assert.deepEqual(await replacement,{pid:456});assert.equal(launches,1);
});
test('partial launch write prevents worker replacement until prior exit',async()=>{
 const child=new EventEmitter();child.pid=123;child.exitCode=null;child.signalCode=null;child.stdin={write(){throw Error('partial write');},destroy(){}};child.kill=()=>false;
 const driver=new Driver();driver.proc=child;driver.info={};driver.exitTimeoutMs=1000;let starts=0;
 driver._launch=async()=>{starts++;return {pid:456};};
 await assert.rejects(driver.call('launch',{}),e=>e.code==='input_outcome_unknown');
 const restart=driver.start();await new Promise(resolve=>setImmediate(resolve));assert.equal(starts,0);
 child.exitCode=1;child.emit('exit',1);assert.deepEqual(await restart,{pid:456});assert.equal(starts,1);
});
test('driver observes a real child exit before reporting cleanup',async()=>{
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['pipe','ignore','ignore'],windowsHide:true});const closed=new Promise(resolve=>child.once('close',resolve));
 const driver=new Driver();driver.proc=child;driver.inputMayBeHeld=true;driver.exitTimeoutMs=5000;let releases=0;
 driver.releaseHeldInputs=async()=>{assert(child.exitCode!==null||child.signalCode!==null);releases++;return true;};
 try{await driver.abort();assert.equal(releases,1);assert.equal(driver.retiring,null);assert.equal(driver.inputMayBeHeld,false);}
 finally{if(child.exitCode===null&&child.signalCode===null)child.kill();await closed;}
});

test('failed file-picker keyboard input requests held-input cleanup before rejecting',async()=>{
 let recoveries=0;
 const driver={seq:0,epoch:1,pending:new Map(),timeoutMs:1000,inputMayBeHeld:false,async start(){},onLog(){},
  async abort(){assert.equal(this.inputMayBeHeld,true);recoveries++;this.inputMayBeHeld=false;},
  proc:{stdin:{write(payload){const request=JSON.parse(payload);Driver.prototype._onLine.call(driver,JSON.stringify({id:request.id,ok:false,error:{code:'input_rejected',message:'Partial file dialog key delivery'}}));}}}};
 await assert.rejects(Driver.prototype.call.call(driver,'file_dialog',{}),error=>error.code==='input_rejected');
 assert.equal(recoveries,1);assert.equal(driver.pending.size,0);
});
test('a failed cleanup preserves both the stop reason and uncertain delivery',async()=>{
 for(const nativeCode of ['input_outcome_unknown','input_cleanup_failed']){
  const driver=new Driver();driver.info={};driver.proc={stdin:{write(payload){const {id}=JSON.parse(payload);driver._onLine(JSON.stringify({id,ok:false,error:{code:nativeCode,message:'Native operation failed'}}));}}};
  driver.abort=async()=>{throw Object.assign(Error('Cleanup unconfirmed'),{code:'input_cleanup_failed'});};
  await assert.rejects(driver.call('click',{}),e=>e.code==='input_cleanup_failed'&&e.delivery_unknown===true);
 }
});

test('window-free clipboard action registers its restarted worker and binds its epoch before approval',async()=>{
 const events=[];const r={generation:1,deadline:Date.now()+10000,remaining:10,check(){},stamp(){return {};},
  guardian:{send(message){events.push(message);},async prompt(){assert.deepEqual(events,[{op:'attach',pid:42}]);return {allowed:true,permit:'one-use'};}},
  sessions:{async withInput(_op,_target,run){return run();}},
  driver:{epoch:2,info:{pid:42},async start(){},async call(op,args){if(op==='authorize')return {result:{sensitive:true}};assert.equal(op,'clipboard');assert.equal(args.__worker_epoch,2);return {result:{has_text:false}};}}};
 const result=await Runtime.prototype.action.call(r,'clipboard',{reason:'Explicit clipboard read'});assert.equal(result.input_completed,true);
});
test('an unavailable input fence does not spend the native action budget',async()=>{
 let sent=0;const r={generation:1,deadline:Date.now()+10000,remaining:1,check(){},stamp(){return{};},guardian:{send(){}},
  driver:{epoch:1,info:{pid:42},async start(){},async call(op){if(op==='authorize')return {result:{sensitive:false}};sent++;}},
  sessions:{async withInput(){throw Object.assign(Error('busy'),{code:'another_session_busy'});}}};
 await assert.rejects(Runtime.prototype.action.call(r,'clipboard',{reason:'Read clipboard'}),e=>e.code==='another_session_busy');
 assert.equal(r.remaining,1);assert.equal(sent,0);
});
test('an action queued behind the fence rechecks its budget before dispatch',async()=>{
 let sent=0;const r={generation:1,deadline:Date.now()+10000,remaining:1,check(){},stamp(){return{};},guardian:{send(){}},
  driver:{epoch:1,info:{pid:42},async start(){},async call(op){if(op==='authorize')return {result:{sensitive:false}};sent++;}},
  sessions:{async withInput(_op,_target,run){r.remaining=0;return run();}}};
 await assert.rejects(Runtime.prototype.action.call(r,'clipboard',{reason:'Read clipboard'}),e=>e.code==='session_limit');
 assert.equal(r.remaining,0);assert.equal(sent,0);
});
test('an action whose session expires while queued never reaches the native worker',async()=>{
 let sent=0;const r={generation:1,deadline:Date.now()+10000,remaining:1,check(){},stamp(){return{};},guardian:{send(){}},
  driver:{epoch:1,info:{pid:42},async start(){},async call(op){if(op==='authorize')return {result:{sensitive:false}};sent++;}},
  sessions:{async withInput(_op,_target,run){r.deadline=Date.now()-1;return run();}}};
 await assert.rejects(Runtime.prototype.action.call(r,'clipboard',{reason:'Read clipboard'}),e=>e.code==='session_limit');
 assert.equal(r.remaining,1);assert.equal(sent,0);
});
test('uncertain native delivery still spends one action',async()=>{
 let sent=0;const r={generation:1,deadline:Date.now()+10000,remaining:1,check(){},stamp(){return{};},guardian:{send(){}},
  driver:{epoch:1,info:{pid:42},async start(){},async call(op){if(op==='authorize')return {result:{sensitive:false}};sent++;throw Object.assign(Error('unknown'),{code:'input_outcome_unknown'});}},
  sessions:{async withInput(_op,_target,run){return run();}}};
 await assert.rejects(Runtime.prototype.action.call(r,'clipboard',{reason:'Read clipboard'}),e=>e.code==='input_outcome_unknown');
 assert.equal(r.remaining,0);assert.equal(sent,1);
});
test('status fallback reads the same persisted takeover preference as the native UI',()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'mode-'));const file=path.join(dir,'control-preferences.json');
 try {
  assert.equal(savedTakeoverMode(file,'manual'),'manual');
  for(const mode of ['manual','smart']){fs.writeFileSync(file,JSON.stringify({takeover_mode:mode}));assert.equal(savedTakeoverMode(file,'manual'),mode);}
  fs.writeFileSync(file,'\uFEFF'+JSON.stringify({takeover_mode:'smart'}));assert.equal(savedTakeoverMode(file,'manual'),'smart');
  for(const invalid of ['{broken',JSON.stringify({takeover_mode:'unknown'})]){fs.writeFileSync(file,invalid);assert.equal(savedTakeoverMode(file,'manual'),'manual');}
 }finally{fs.unlinkSync(file);fs.rmdirSync(dir);}
});
test('duplicate stop event preserves the emergency stop reason; resume starts fresh observations',()=>{
 const guardian=new EventEmitter();const r=new Runtime({guardian,driver:{abort:async()=>{}},sessions:{register(){}}});
 try {
  guardian.emit('state','active');r.frames.set('old',{});r.grants.set('app',{});r.token='old';
  guardian.emit('state','stopped','escape');guardian.emit('state','stopped');
  assert.equal(r.status().control_reason,'escape');assert.equal(r.frames.size,0);assert.equal(r.grants.size,0);assert.equal(r.token,'');
  guardian.emit('state','active');assert.equal(r.state,'stopped');r.frames.set('pre-resume',{});guardian.emit('resume','idle','human_resume');
  assert.equal(r.state,'idle');assert.equal(r.frames.size,0);assert.equal(r.status().control_reason,'human_resume');
 }finally{fs.unlinkSync(r.guardFile);}
});

test('queries search a bounded larger hierarchy before compacting results',async()=>{
 let requested;const r={async grant(){return {pid:1,started:'one',path:'app.exe'};},check(){},guardian:{send(){}},stamp(){return {};},frames:new Map(),driver:{async call(op,args){assert.equal(op,'snapshot');requested=args.max_nodes;return {result:{snapshot_id:'s',nodes:[{i:1,name:'Toolbar',role:'Button'},{i:300,name:'Export PNG',role:'Button'}]}};}}};
 const result=await Runtime.prototype.observe.call(r,{hwnd:1,query:'PNG',with_image:false});
 assert.equal(requested,500);assert.match(result.metadata.tree,/Export PNG/);assert(!result.metadata.tree.includes('Toolbar'));
});

test('native wait budget is recalculated after a slow grant',async()=>{
 let received,options;const r={async grant(){await new Promise(resolve=>setTimeout(resolve,100));return {pid:1,started:'one',path:'app.exe'};},check(){},guardian:{send(){}},stamp(){return {};},frames:new Map(),driver:{async call(op,args,opts){received=args;options=opts;return {result:{snapshot_id:'s',nodes:[]}};}}};
 await Runtime.prototype.observe.call(r,{hwnd:1,with_image:false,native_snapshot_deadline:performance.now()+500});
 assert(received.time_budget_ms>=100&&received.time_budget_ms<=450);assert.equal(options.timeoutMs,received.time_budget_ms+100);
});

test('an expired wait budget refuses a new native snapshot after a slow grant',async()=>{
 let snapshots=0;const r={async grant(){await new Promise(resolve=>setTimeout(resolve,120));return {pid:1,started:'one',path:'app.exe'};},check(){},guardian:{send(){}},stamp(){return {};},frames:new Map(),driver:{async call(){snapshots++;return {result:{snapshot_id:'s',nodes:[]}};}}};
 await assert.rejects(Runtime.prototype.observe.call(r,{hwnd:1,with_image:false,native_snapshot_deadline:performance.now()+100,require_native_budget:true}),e=>e.code==='wait_observation_timeout');
 assert.equal(snapshots,0);
});
test('expired wait during capture preparation restores overlay without starting a screenshot',async()=>{
 const sent=[];let screenshots=0;
 const r={async grant(){return{pid:1,started:'one',path:'app.exe',rect:[0,0,800,600]};},check(){},guardian:{send(m){sent.push(m.op);},async request(){await new Promise(resolve=>setTimeout(resolve,120));}},stamp(){return{};},frames:new Map(),driver:{async call(op){if(op==='screenshot')screenshots++;return{result:{snapshot_id:'s',nodes:[]}};}}};
 await assert.rejects(Runtime.prototype.observe.call(r,{hwnd:1,native_snapshot_deadline:performance.now()+100,require_native_budget:true}),e=>e.code==='wait_observation_timeout');
 assert.equal(screenshots,0);assert(sent.includes('capture_end'));
});
test('capture preparation timeout reports Stop requested and never starts a screenshot',async()=>{
 let screenshots=0;
 const r={async grant(){return{pid:1,started:'one',path:'app.exe',rect:[0,0,800,600]};},check(){},guardian:{send(){},async request(){throw Object.assign(Error('timeout'),{code:'guardian_request_timeout'});}},stamp(){return{};},frames:new Map(),driver:{async call(op){if(op==='screenshot')screenshots++;return{result:{snapshot_id:'s',nodes:[]}};}}};
 await assert.rejects(Runtime.prototype.observe.call(r,{hwnd:1,native_snapshot_deadline:performance.now()+5000,require_native_budget:true}),e=>e.code==='capture_preparation_timeout'&&/Stop was attempted but is unconfirmed/.test(e.message));assert.equal(screenshots,0);
});
test('wait screenshot gets a bounded driver timeout and restores overlay',async()=>{
 const sent=[];let options,prepareOptions;
 const r={async grant(){return{pid:1,started:'one',path:'app.exe',rect:[0,0,800,600]};},check(){},guardian:{send(m){sent.push(m.op);},async request(_m,opts){prepareOptions=opts;}},stamp(){return{};},frames:new Map(),driver:{async call(op,args,opts){if(op==='snapshot')return{result:{snapshot_id:'s',nodes:[]}};options=opts;return{result:{capture:'window',data:'fixture',source:[0,0,800,600]}};}}};
 await Runtime.prototype.observe.call(r,{hwnd:1,native_snapshot_deadline:performance.now()+5000,require_native_budget:true});
 assert(options.timeoutMs>=200&&options.timeoutMs<=5100);assert(prepareOptions.timeoutMs>=1100&&prepareOptions.timeoutMs<=6000);assert(sent.includes('capture_end'));
});

test('observation flags native and rendered tree truncation without claiming accessibility completeness',async()=>{
 let snapshot={snapshot_id:'s',truncated:true,nodes:[{i:1,name:'Ready',role:'Button'}]};
 const r={async grant(){return {pid:1,started:'one',path:'app.exe'};},check(){},guardian:{send(){}},stamp(){return {};},frames:new Map(),driver:{async call(){return {result:snapshot};}}};
 assert.equal((await Runtime.prototype.observe.call(r,{hwnd:1,with_image:false})).metadata.tree_incomplete,true);
 snapshot={snapshot_id:'s2',nodes:Array.from({length:81},(_,i)=>({i,name:'Control '+i,role:'Button'}))};
 assert.equal((await Runtime.prototype.observe.call(r,{hwnd:1,with_image:false})).metadata.tree_incomplete,true);
 snapshot={snapshot_id:'s3',nodes:[{i:1,name:'Ready',role:'Button',text_unread:true}]};
 assert.equal((await Runtime.prototype.observe.call(r,{hwnd:1,with_image:false})).metadata.tree_incomplete,true);
 snapshot={snapshot_id:'s4',nodes:[{i:1,name:'Ready',role:'Button'}]};
 assert.equal((await Runtime.prototype.observe.call(r,{hwnd:1,with_image:false})).metadata.tree_incomplete,false);
});

test('a section query includes its real child controls without unrelated siblings or invented labels',()=>{
 const nodes=[{i:0,depth:0,role:'Window',name:'App'},{i:1,depth:1,role:'Group',name:'Export format'},{i:2,depth:2,role:'Button',name:'PNG'},{i:3,depth:2,role:'Button',name:'JPEG',offscreen:true},{i:4,depth:1,role:'Group',name:'Security'},{i:5,depth:2,role:'Button',name:'Delete'}];
 const selected=queryNodes(nodes,'FORMAT');assert.deepEqual(selected.map(n=>n.i),[1,2,3]);assert.equal(selected[2],nodes[3]);assert.equal(selected[2].offscreen,true);assert.deepEqual(queryNodes(nodes,'JPEG').map(n=>n.i),[3]);
 assert.deepEqual(queryNodes([{i:1,role:'Slider',value:0},{i:2,name:'Other'}],'0').map(n=>n.i),[1]);
 assert.deepEqual(queryNodes(nodes,'missing'),[]);
});

test('explicit window fitting invalidates old frames and refuses a different virtual desktop before input',async()=>{
 const window={hwnd:1,pid:5,started:'one',path:'app.exe'};let delivered=0,observed=0;
 const r={frames:new Map([['old',{}]]),deadline:Date.now()+10000,remaining:10,generation:1,async grant(){return window;},check(){},stamp(){return {};},async app(){return window;},guardian:{send(){}},driver:{epoch:1,info:{pid:10},async start(){},async call(op){if(op==='authorize')return{result:{sensitive:false}};assert.equal(op,'fit_window');delivered++;return{result:{fully_visible:true}};}},sessions:{async withInput(_op,_meta,fn){return fn();}},async observe(){assert(!r.frames.has('old'));observed++;return{metadata:{observation_id:'fresh'}};}};
 const result=await Runtime.prototype.action.call(r,'fit_window',{hwnd:1,risk:'routine',reason:'Fit approved app'});assert.equal(delivered,1);assert.equal(observed,1);assert.equal(result.metadata.observation_id,'fresh');
 window.other_desktop=true;await assert.rejects(Runtime.prototype.action.call(r,'fit_window',{hwnd:1,risk:'routine',reason:'Must refuse'}),e=>e.code==='other_desktop');assert.equal(delivered,1);
});

test('an older helper cannot return covering-window pixels to the agent',async()=>{
 const r={generation:1,frames:new Map(),async grant(){return {pid:1,started:'one',path:'app.exe',rect:[0,0,100,100]};},check(){},guardian:{send(){},async request(){}},stamp(){return {};},driver:{epoch:1,async call(op){return op==='snapshot'?{result:{snapshot_id:'s',nodes:[]}}:{result:{capture:'screen_occluded',data:'private-cover-pixels'}};}}};
 await assert.rejects(Runtime.prototype.observe.call(r,{hwnd:1}),error=>error.code==='window_capture_unavailable');assert.equal(r.frames.size,0);
});
test('wait observes completion without repeating input',async()=>{
 let n=0;const r={check(){},frames:new Map(),async observe(){n++;return {metadata:{observation_id:String(n),tree:n===1?'Completed':'Completed'},image:{data:'screenshot'}};}};
 const result=await Runtime.prototype.wait.call(r,{hwnd:1,until:'Completed',timeout_ms:100});assert(result.matched);assert(result.image.data);assert.equal(n,2);
});
test('wait refuses work while paused instead of rearming control',async()=>{
 const r={check(){throw Object.assign(Error('paused'),{code:'control_inactive'});}};
 await assert.rejects(Runtime.prototype.wait.call(r,{hwnd:1,until:'Completed'}),e=>e.code==='control_inactive');
});

test('pause/resume during a pending observation cannot recreate an old frame',async()=>{
 let release;const pending=new Promise(resolve=>release=resolve);
 const r={generation:1,frames:new Map(),async grant(){return {pid:1,started:'one',path:'app.exe'};},check(){},guardian:{send(){}},stamp(){return {};},driver:{async call(){await pending;return {result:{snapshot_id:'old',nodes:[]}};}}};
 const observing=Runtime.prototype.observe.call(r,{hwnd:1,with_image:false});
 await new Promise(resolve=>setImmediate(resolve));r.generation++;release();
 await assert.rejects(observing,e=>e.code==='control_changed');assert.equal(r.frames.size,0);
});

test('worker restart during capture invalidates that observation even while control stays active',async()=>{
 const driver={epoch:1,async call(){this.epoch++;return {result:{snapshot_id:'s1',nodes:[]}};}};
 const r={generation:1,frames:new Map(),async grant(){return {pid:1,started:'one',path:'app.exe'};},check(){},guardian:{send(){}},stamp(){return {};},driver};
 await assert.rejects(Runtime.prototype.observe.call(r,{hwnd:1,with_image:false}),e=>e.code==='control_changed');assert.equal(r.frames.size,0);
});

test('last-moment worker restart refuses input before writing a command',async()=>{
 const driver={epoch:1,async start(){this.epoch=2;}};
 await assert.rejects(Driver.prototype.call.call(driver,'click',{__worker_epoch:1}),e=>e.code==='stale_observation');
});

test('post-click screenshot failure preserves delivery evidence instead of inviting replay',async()=>{
 const w={hwnd:1,pid:2,started:'one',path:'test.exe'};let clicks=0;
 const r={generation:1,deadline:Date.now()+10000,remaining:10,frames:new Map([['fresh',{at:Date.now(),hwnd:1,key:appKey(w),snapshot:'s1',workerEpoch:1}]]),
  async grant(){return w;},async app(){return w;},check(){},stamp(){return {};},guardian:{send(){}},sessions:{async withInput(_op,_target,run){return run();}},
  driver:{epoch:1,async call(op){if(op==='authorize')return {result:{sensitive:false}};assert.equal(op,'click');clicks++;return {result:{clicked:true}};}},
  async observe(){throw Object.assign(Error('App is transitioning'),{code:'op_timeout'});}};
 const result=await Runtime.prototype.action.call(r,'click',{hwnd:1,observation_id:'fresh',index:3,risk:'routine'});
 assert.equal(clicks,1);assert.equal(result.input_completed,true);assert.equal(result.result.clicked,true);assert.equal(result.verification_error.code,'op_timeout');
});

test('Stop invalidates an action waiting for the shared input lease before it can send input',async()=>{
 let release,entered;const waiting=new Promise(resolve=>release=resolve),inLease=new Promise(resolve=>entered=resolve);let delivered=0;
 const guardian=new EventEmitter();guardian.send=()=>{};
 const driver={epoch:1,async abort(){},async call(op){if(op==='authorize')return {result:{sensitive:false}};delivered++;return {result:{clicked:true}};}};
 const r=new Runtime({guardian,driver,sessions:{register(){},async withInput(_op,_target,run){entered();await waiting;return run();}}});
 const w={hwnd:1,pid:2,started:'one',path:'test.exe'};
 r.state='active';r.token='fixture';r.deadline=Date.now()+10000;r.app=r.grant=async()=>w;
 r.frames.set('fresh',{at:Date.now(),hwnd:1,key:appKey(w),snapshot:'s1',workerEpoch:1});
 try{
  const action=r.action('click',{hwnd:1,observation_id:'fresh',index:3,risk:'routine',reason:'Fixture only'});
  await inLease;await r.stop();release();
  await assert.rejects(action,error=>error.code==='control_inactive');assert.equal(delivered,0);assert.equal(r.state,'stopped');
 }finally{release();fs.unlinkSync(r.guardFile);}
});

test('Space mismatch and full-screen windows fail closed with distinct classifications and refuse repeated polling',async()=>{
 let snapshots=0,screenshots=0,delivered=0;
 const w={hwnd:11,pid:50,started:'one',path:'/Applications/Google Chrome.app',rect:[0,0,1200,800],other_desktop:true,fullscreen:false};
 const r={generation:1,deadline:Date.now()+10000,remaining:10,frames:new Map(),async grant(){return w;},async app(){return w;},check(){},stamp(){return {};},
  guardian:{send(){},async request(){}},sessions:{async withInput(_op,_meta,fn){return fn();}},
  driver:{epoch:1,info:{pid:99},async start(){},async call(op){if(op==='snapshot')snapshots++;if(op==='screenshot')screenshots++;if(op==='focus'||op==='fit_window')delivered++;return {result:{}};}}};
 await assert.rejects(Runtime.prototype.observe.call(r,{hwnd:11}),err=>{
  const reply=failureReply(err);
  assert.equal(reply.error.code,'other_desktop');
  assert.equal(reply.next_action,'await_human_space_switch');
  assert.equal(reply.recovery_attempts_remaining,0);
  assert.equal(reply.replay_allowed,false);
  assert.equal(reply.repeated_failure,undefined);
  return true;
 });
 await assert.rejects(Runtime.prototype.observe.call(r,{hwnd:11}),err=>{
  const reply=failureReply(err);
  assert.equal(reply.error.code,'other_desktop');
  assert.equal(reply.next_action,'await_human_space_switch');
  assert.equal(reply.repeated_failure,true);
  assert.equal(reply.recovery_attempts_remaining,0);
  return true;
 });
 await assert.rejects(Runtime.prototype.action.call(r,'focus',{hwnd:11,risk:'routine',reason:'Must not switch Space'}),err=>err.code==='other_desktop'&&err.recovery_attempts_remaining===0);
 assert.equal(snapshots,0);assert.equal(screenshots,0);assert.equal(delivered,0);

 w.other_desktop=false;w.fullscreen=true;
 await assert.rejects(Runtime.prototype.observe.call(r,{hwnd:11}),err=>{
  const reply=failureReply(err);
  assert.equal(reply.error.code,'window_fullscreen');
  assert.equal(reply.next_action,'await_human_fullscreen_exit');
  assert.equal(reply.recovery_attempts_remaining,0);
  assert.equal(reply.replay_allowed,false);
  return true;
 });
 await assert.rejects(Runtime.prototype.observe.call(r,{hwnd:11}),err=>{
  const reply=failureReply(err);
  assert.equal(reply.error.code,'window_fullscreen');
  assert.equal(reply.repeated_failure,true);
  assert.equal(reply.recovery_attempts_remaining,0);
  return true;
 });
 await assert.rejects(Runtime.prototype.action.call(r,'fit_window',{hwnd:11,risk:'routine',reason:'Must not exit full-screen'}),err=>err.code==='window_fullscreen');
 assert.equal(snapshots,0);assert.equal(screenshots,0);assert.equal(delivered,0);
});

test('minimized and hidden windows allow one bounded focus recovery attempt and refuse repeated polling without replay',async()=>{
 let focused=0;
 const w={hwnd:22,pid:60,started:'one',path:'/System/Applications/TextEdit.app',rect:[10,10,600,400],minimized:true,hidden:false};
 const r={generation:1,deadline:Date.now()+10000,remaining:10,frames:new Map(),async grant(){return w;},async app(){return w;},check(){},recordDispatch(){},stamp(){return {};},observe:Runtime.prototype.observe,
  guardian:{send(){},async request(){}},sessions:{async withInput(_op,_meta,fn){return fn();}},
  driver:{epoch:1,info:{pid:99},async start(){},async call(op){
   if(op==='authorize')return {result:{sensitive:false}};
   if(op==='focus'){focused++;return {result:{focused:true}};}
   if(op==='snapshot')return {result:{snapshot_id:'s1',nodes:[{i:1,role:'Window',name:'Doc'}]}};
   if(op==='screenshot')return {result:{capture:'window',width:600,height:400,source:[10,10,600,400],data:'img'}};
   throw Error('unexpected op '+op);
  }}};
 // First observe on minimized window returns 1 bounded recovery attempt.
 await assert.rejects(Runtime.prototype.observe.call(r,{hwnd:22}),err=>{
  const reply=failureReply(err);
  assert.equal(reply.error.code,'window_minimized');
  assert.equal(reply.next_action,'focus_target_then_observe');
  assert.equal(reply.recovery_attempts_remaining,1);
  assert.equal(reply.replay_allowed,false);
  return true;
 });
 // Polling observe again without focusing refuses as repeated_failure.
 await assert.rejects(Runtime.prototype.observe.call(r,{hwnd:22}),err=>{
  const reply=failureReply(err);
  assert.equal(reply.error.code,'window_minimized');
  assert.equal(reply.repeated_failure,true);
  assert.equal(reply.recovery_attempts_remaining,0);
  assert.equal(reply.next_action,'await_human_window_recovery');
  return true;
 });
 // One bounded focus attempt is permitted; if window stays minimized, post-action verification records window_minimized without inviting replay, and a second focus refuses before dispatch.
 const focusOutcome=await Runtime.prototype.action.call(r,'focus',{hwnd:22,risk:'routine',reason:'Bounded focus attempt',observe:{settle_ms:0}});
 assert.equal(focused,1);
 assert.equal(focusOutcome.input_completed,true);
 assert.equal(focusOutcome.verification_error.code,'window_minimized');
 await assert.rejects(Runtime.prototype.action.call(r,'focus',{hwnd:22,risk:'routine',reason:'Second focus must refuse'}),err=>{
  const reply=failureReply(err);
  assert.equal(reply.error.code,'window_minimized');
  assert.equal(reply.repeated_failure,true);
  assert.equal(reply.recovery_attempts_remaining,0);
  return true;
 });
 assert.equal(focused,1);

 // Hidden app classification and recovery when unhidden:
 w.minimized=false;w.hidden=true;r.windowFailures.clear();
 await assert.rejects(Runtime.prototype.observe.call(r,{hwnd:22}),err=>{
  const reply=failureReply(err);
  assert.equal(reply.error.code,'window_hidden');
  assert.equal(reply.next_action,'focus_target_then_observe');
  assert.equal(reply.recovery_attempts_remaining,1);
  return true;
 });
 w.hidden=false;
 const recovered=await Runtime.prototype.observe.call(r,{hwnd:22});
 assert.ok(recovered.metadata.observation_id);
 assert.equal(r.windowFailures.has(22),false);
});

test('stale window handles and missing capture permissions classify precisely and stop repeated polling',async()=>{
 let identityCalls=0;
 let alive=true;
 const r={generation:1,frames:new Map(),guardian:{send(){}},driver:{info:{pid:99},async call(op){
  if(op==='identity'){
   identityCalls++;
   if(!alive)throw Object.assign(Error('No window matched hwnd/title.'),{code:'window_not_found'});
   return {result:{hwnd:33,pid:70,started:'birth-1',path:'/Applications/Calculator.app',title:'Calculator',rect:[0,0,230,400]}};
  }
  if(op==='list_apps')return {result:{windows:alive?[{hwnd:33,pid:70,title:'Calculator',path:'/Applications/Calculator.app'}]:[]}};
  throw Error('unexpected op '+op);
 }},identity:Runtime.prototype.identity};
 const first=await Runtime.prototype.app.call(r,33);
 assert.equal(first.hwnd,33);assert.equal(identityCalls,1);
 // Window closes -> handle 33 is now a stale window handle, classified as identity_changed.
 alive=false;
 await assert.rejects(Runtime.prototype.app.call(r,33),err=>{
  const reply=failureReply(err);
  assert.equal(reply.error.code,'identity_changed');
  assert.equal(reply.next_action,'discover_apps_then_observe');
  assert.equal(reply.recovery_attempts_remaining,0);
  return true;
 });
 assert.equal(identityCalls,2);
 // Polling stale handle 33 again refuses immediately without calling native identity again.
 await assert.rejects(Runtime.prototype.app.call(r,33),err=>{
  const reply=failureReply(err);
  assert.equal(reply.error.code,'identity_changed');
  assert.equal(reply.repeated_failure,true);
  assert.equal(reply.recovery_attempts_remaining,0);
  return true;
 });
 assert.equal(identityCalls,2);

 // Screen Recording permission unavailable classification:
 const permRuntime={generation:1,frames:new Map(),async grant(){return {hwnd:44,pid:80,started:'one',path:'/Applications/Safari.app',rect:[0,0,800,600]};},check(){},stamp(){return {};},
  guardian:{send(){},async request(){}},driver:{epoch:1,async call(op){
   if(op==='snapshot')return {result:{snapshot_id:'s1',nodes:[]}};
   throw Object.assign(Error('Screen Recording permission needs human setup.'),{code:'mac_permissions_required'});
  }}};
 await assert.rejects(Runtime.prototype.observe.call(permRuntime,{hwnd:44}),err=>{
  const reply=failureReply(err);
  assert.equal(reply.error.code,'mac_permissions_required');
  assert.equal(reply.next_action,'await_human_permission_grant');
  assert.equal(reply.recovery_attempts_remaining,0);
  return true;
 });
});

test('long web snapshots retain both top navigation and bottom composer controls and attach OCR when blind',async()=>{
 const nodes=[
  {i:0,depth:0,role:'Window',name:'Slack - Google Chrome'},
  {i:1,depth:1,role:'Document',name:'Slack',text:'https://app.slack.com/client/T1/dms'},
  ...Array.from({length:95},(_,idx)=>({i:idx+2,depth:2,role:'Text',name:`Message line ${idx+1}`})),
  {i:97,depth:2,role:'Edit',name:'Message to Shayan',patterns:['Value']},
  {i:98,depth:2,role:'Button',name:'Send now',patterns:['Invoke']}
 ];
 const r={generation:1,frames:new Map(),async grant(){return {hwnd:55,pid:90,started:'one',path:'/Applications/Google Chrome.app',rect:[0,0,1400,800]};},check(){},stamp(){return {};},
  guardian:{send(){},async request(){}},driver:{epoch:1,async call(op){
   if(op==='snapshot')return {result:{snapshot_id:'s-web',hwnd:55,title:'Slack - Google Chrome',web:true,nodes}};
   return {result:{capture:'window',width:1400,height:800,source:[0,0,1400,800],data:'fixture'}};
  }}};
 const observed=await Runtime.prototype.observe.call(r,{hwnd:55,with_image:false});
 assert.match(observed.metadata.tree,/Message line 1/);
 assert.match(observed.metadata.tree,/\[97\].*Edit "Message to Shayan"/);
 assert.match(observed.metadata.tree,/\[98\].*Button "Send now"/);
 assert.equal(observed.metadata.tree_incomplete,true);

 const blindRuntime={generation:1,frames:new Map(),async grant(){return {hwnd:56,pid:91,started:'one',path:'/Applications/Canvas.app',rect:[0,0,1200,700]};},check(){},stamp(){return {};},
  guardian:{send(){},async request(){}},driver:{epoch:1,async call(op){
   if(op==='snapshot')return {result:{snapshot_id:'s-blind',hwnd:56,title:'Canvas',nodes:[{i:0,depth:0,role:'Window',name:'Canvas'}]}};
   return {result:{capture:'window',width:1200,height:700,source:[0,0,1200,700],data:'fixture',screen_text:[{text:'Message Shayan',x:610,y:650}]}};
  }}};
 const blindObs=await Runtime.prototype.observe.call(blindRuntime,{hwnd:56});
 assert.match(blindObs.metadata.tree,/\[Screen text \(OCR @x,y\)\]/);
 assert.match(blindObs.metadata.tree,/@610,650 "Message Shayan"/);
});
