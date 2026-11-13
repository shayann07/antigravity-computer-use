import {testDirectory} from './paths.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import {Runtime} from '../server/runtime.mjs';
import {parseArguments} from '../scripts/arguments.mjs';import {TOOLS,validate} from '../server/desktop-tools.mjs';
import {spawnSync} from 'node:child_process';
const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-launch-'));
const app=path.join(dir,process.platform==='darwin'?'OwnedTest.app':'OwnedTest.exe');
const executable=process.platform==='darwin'?path.join(app,'Contents/MacOS/OwnedTest'):app;
if(process.platform==='darwin'){
 fs.mkdirSync(path.dirname(executable),{recursive:true});
 fs.writeFileSync(path.join(app,'Contents/Info.plist'),'<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>OwnedTest</string></dict></plist>');
}
fs.writeFileSync(executable,'not executed: mock tests only');
process.on('exit',()=>{fs.rmSync(dir,{recursive:true,force:true});});
function harness(windows){
 let launches=0,observations=0,attached=false;
 const r={state:'idle',generation:1,token:'',check(){if(this.state!=='active')throw Object.assign(Error('stopped'),{code:'control_inactive'});},stamp(){return {};},sessions:{async withInput(_op,_target,run){return run();}},
 guardian:{send(message){assert.deepEqual(message,{op:'attach',pid:99});attached=true;},async start(){},async request(){return {allowed:true};},async prompt(){assert.equal(attached,true,'Register the worker before permission/dispatch');return {allowed:true,permit:'native-permit'};}},
 driver:{epoch:1,info:{pid:99},async start(){},async call(op,args){if(op==='launch'){assert.equal(args.__permit,'native-permit');assert.equal(args.__worker_epoch,1);launches++;return {result:{pid:123,path:app}};}assert.equal(op,'list_apps');return {result:{windows}};}},
 async observe(args){observations++;assert.equal(args.hwnd,8);return {metadata:{hwnd:8,observation_id:'fresh'},image:{data:'actual-mock-image'}};}};
 return {r,counts:()=>({launches,observations})};
}
test('launch --observe uses boolean schema and observes only exact PID and executable',async()=>{
 const schema=TOOLS.find(t=>t.name==='computer_launch').inputSchema;
 const args=parseArguments(schema,['--app',app,'--observe','--reason','Open owned app']);validate('computer_launch',args);assert.equal(args.observe,true);
 const {r,counts}=harness([{hwnd:7,pid:124,path:executable,rect:[0,0,100,100]},{hwnd:9,pid:123,path:executable+'other',rect:[0,0,100,100]},{hwnd:8,pid:123,path:executable,rect:[0,0,100,100]}]);
 const result=await Runtime.prototype.launch.call(r,args);assert.equal(result.input_completed,true);assert.equal(result.metadata.observation_id,'fresh');assert.deepEqual(counts(),{launches:1,observations:1});
});
test('ambiguous post-launch windows return pending without guessing or relaunching',async()=>{
 const {r,counts}=harness([8,9].map(hwnd=>({hwnd,pid:123,path:executable,rect:[0,0,100,100]})));
 const result=await Runtime.prototype.launch.call(r,{app,observe:true,reason:'test'});assert.equal(result.observe_pending,true);assert.equal(result.input_completed,true);assert.deepEqual(counts(),{launches:1,observations:0});
});
test('post-launch Stop and observation failure retain delivery evidence without replay',async()=>{
 for(const stopped of [true,false]){
  const {r,counts}=harness([{hwnd:8,pid:123,path:executable,rect:[0,0,100,100]}]);
  if(stopped){const original=r.driver.call;r.driver.call=async(...args)=>{const reply=await original(...args);if(args[0]==='launch'){r.state='stopped';r.generation++;}return reply;};}
  else r.observe=async()=>{throw Object.assign(Error('capture unavailable'),{code:'window_capture_unavailable'});};
  const result=await Runtime.prototype.launch.call(r,{app,observe:true,reason:'test'});assert.equal(result.input_completed,true);assert.equal(result.verification_error.code,stopped?'control_inactive':'window_capture_unavailable');assert.equal(counts().launches,1);
 }
});
test('legacy launch remains a launch-only operation',async()=>{
 const {r,counts}=harness([]);const result=await Runtime.prototype.launch.call(r,{app,reason:'test'});assert.deepEqual(result,{pid:123,path:app});assert.deepEqual(counts(),{launches:1,observations:0});
 assert.equal(r.remaining,199);
});
test('launch respects an exhausted session budget before native dispatch',async()=>{
 const {r,counts}=harness([]);r.token='existing';r.deadline=Date.now()+10000;r.remaining=0;
 await assert.rejects(Runtime.prototype.launch.call(r,{app,reason:'test'}),e=>e.code==='session_limit');assert.equal(counts().launches,0);
});
test('launch rechecks the budget after waiting for the input fence',async()=>{
 const {r,counts}=harness([]);r.sessions.withInput=async(_op,_target,run)=>{r.remaining=0;return run();};
 await assert.rejects(Runtime.prototype.launch.call(r,{app,reason:'test'}),e=>e.code==='session_limit');assert.equal(counts().launches,0);
});
test('launch does not spend budget when the input fence is unavailable',async()=>{
 const {r,counts}=harness([]);r.sessions.withInput=async()=>{throw Object.assign(Error('busy'),{code:'another_session_busy'});};
 await assert.rejects(Runtime.prototype.launch.call(r,{app,reason:'test'}),e=>e.code==='another_session_busy');assert.equal(r.remaining,200);assert.equal(counts().launches,0);
});
test('a launch with unknown delivery still spends one action',async()=>{
 const {r}=harness([]);r.driver.call=async()=>{throw Object.assign(Error('unknown'),{code:'input_outcome_unknown'});};
 await assert.rejects(Runtime.prototype.launch.call(r,{app,reason:'test'}),e=>e.code==='input_outcome_unknown');assert.equal(r.remaining,199);
});
test('Stop while launch waits for input ownership prevents process creation',async()=>{
 const {r,counts}=harness([]);r.sessions.withInput=async(_op,_target,run)=>{r.state='stopped';r.generation++;return run();};
 await assert.rejects(Runtime.prototype.launch.call(r,{app,reason:'test'}),e=>e.code==='control_inactive');assert.equal(counts().launches,0);
});

test('an exited starter returns pending promptly without guessing a handoff or relaunching',async()=>{
 const exited=spawnSync(process.execPath,['-e',''],{windowsHide:true});assert.equal(exited.status,0);
 const {r,counts}=harness([]),original=r.driver.call;
 r.driver.call=async(op,args)=>{const reply=await original(op,args);if(op==='launch')reply.result.pid=exited.pid;return reply;};
 const started=Date.now(),result=await Runtime.prototype.launch.call(r,{app,observe:true,reason:'Owned exited starter'});
 assert.equal(result.launcher_exited,true);assert.equal(result.observe_pending,true);assert.equal(result.input_completed,true);assert(Date.now()-started<2000,'Do not wait out8seconds after definite starter exit');assert.deepEqual(counts(),{launches:1,observations:0});
});
test('launch discovery remains bounded if the wall clock moves backwards',async()=>{
 const {r,counts}=harness([]),original=r.driver.call,realDate=Date.now,ownNow=Object.getOwnPropertyDescriptor(performance,'now');let checks=0;
 r.driver.call=async(op,args)=>{const reply=await original(op,args);if(op==='launch')reply.result.pid=process.pid;if(op==='list_apps')Date.now=()=>1;return reply;};
 Object.defineProperty(performance,'now',{configurable:true,value:()=>checks++?9000:0});
 try{const result=await Runtime.prototype.launch.call(r,{app,observe:true,reason:'Clock change'});assert.equal(result.observe_pending,true);assert.equal(result.input_completed,true);assert.equal(counts().launches,1);}
 finally{Date.now=realDate;if(ownNow)Object.defineProperty(performance,'now',ownNow);else delete performance.now;}
});

// Feed list_apps a timeline of window sets keyed by elapsed milliseconds.
function timeline(steps){
 const {r,counts}=harness([]),original=r.driver.call,started=performance.now();const seen=[];
 r.driver.call=async(op,args)=>{if(op!=='list_apps')return original(op,args);const t=performance.now()-started;let windows=steps[0][1];for(const [at,set] of steps)if(t>=at)windows=set;return {result:{windows}};};
 r.observe=async a=>{seen.push(a.hwnd);return {metadata:{hwnd:a.hwnd,observation_id:'fresh'}};};
 return {r,counts,seen};
}
const win=(hwnd,w,h)=>({hwnd,pid:123,path:executable,rect:[0,0,w,h]});
test('launch --observe waits past a splash screen and observes the main window',async()=>{
 const {r,seen}=timeline([[0,[win(5,600,350)]],[700,[win(6,1280,800)]]]);
 const result=await Runtime.prototype.launch.call(r,{app,observe:true,reason:'Splash then main'});
 assert.equal(result.input_completed,true);assert.deepEqual(seen,[6]);
});
test('a lone small window waits for the main window, but is used if none appears',async()=>{
 const later=timeline([[0,[win(5,413,210)]],[1500,[win(5,413,210),win(6,1280,800)]]]);
 await Runtime.prototype.launch.call(later.r,{app,observe:true,reason:'Widget then main'});
 assert.deepEqual(later.seen,[6]);
 const only=timeline([[0,[win(5,413,210)]]]),started=performance.now();
 await Runtime.prototype.launch.call(only.r,{app,observe:true,reason:'Small app'});
 assert.deepEqual(only.seen,[5]);assert(performance.now()-started<6500,'small-window wait stays bounded');
});
test('a clearly dominant window is chosen; comparable windows stay ambiguous',async()=>{
 const dominant=timeline([[0,[win(5,1280,800),win(6,300,200)]]]);
 const chosen=await Runtime.prototype.launch.call(dominant.r,{app,observe:true,reason:'Main plus palette'});
 assert.deepEqual(dominant.seen,[5]);assert.equal(chosen.input_completed,true);
 const close=timeline([[0,[win(5,800,600),win(6,700,600)]]]);
 const pending=await Runtime.prototype.launch.call(close.r,{app,observe:true,reason:'Two documents'});
 assert.equal(pending.observe_pending,true);assert.deepEqual(close.seen,[]);assert.equal(close.counts().launches,1);
});
