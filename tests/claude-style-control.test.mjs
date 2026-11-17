import {testDirectory} from './paths.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import fs from 'node:fs';import path from 'node:path';
import {Runtime,appKey} from '../server/runtime.mjs';
import {accessTier,accessRefusal,ACCESS} from '../server/policy.mjs';
import {clearConfirmedStop,recoveryAdvice} from '../server/recovery.mjs';

function runtime({latchFile=null,request=async()=>({state:'idle',controls_visible:true})}={}){
 const guardian=new EventEmitter();guardian.messages=[];guardian.send=m=>{guardian.messages.push(m);return true;};guardian.request=request;guardian.prompts=0;
 guardian.prompt=async()=>{guardian.prompts++;return {allowed:true};};
 const driver={epoch:1,info:{pid:999},async abort(){},async call(op){if(op==='authorize')return {result:{sensitive:false}};return {result:{ok:true}};}};
 const r=new Runtime({guardian,driver,sessions:{register(){},close(){},async withInput(_o,_t,run){return run();}},latchFile});
 return r;
}

test('terminals and IDEs are click tier, browsers and other apps are full, protected apps have no tier',()=>{
 assert.equal(accessTier({process:'WindowsTerminal',path:'C:/x/WindowsTerminal.exe'}),ACCESS.CLICK);
 assert.equal(accessTier({process:'Code',path:'C:/x/Code.exe'}),ACCESS.CLICK);
 assert.equal(accessTier({process:'chrome',path:'C:/x/chrome.exe'}),ACCESS.FULL);
 assert.equal(accessTier({process:'msedge',path:'C:/x/msedge.exe'}),ACCESS.FULL);
 assert.equal(accessTier({process:'mspaint',path:'C:/x/mspaint.exe'}),ACCESS.FULL);
 assert.equal(accessTier({process:'consent',path:'C:/Windows/System32/consent.exe'}),null);
});

test('macOS terminals and IDEs are click tier by app name or bundle executable; Mac browsers and editors stay full',()=>{
 for(const [process,exe] of [['Terminal','Terminal'],['iTerm2','iTerm2'],['Warp','stable'],['Ghostty','ghostty'],['Xcode','Xcode'],
  ['Code','Electron'],['Visual Studio Code','Electron'],['Cursor','Cursor'],['Zed','zed'],['Sublime Text','sublime_text'],
  ['IntelliJ IDEA','idea'],['IntelliJ IDEA CE','idea'],['PyCharm','pycharm'],['WebStorm','webstorm'],['Android Studio','studio'],
  ['GoLand','goland'],['RustRover','rustrover'],['Nova','Nova']])
  assert.equal(accessTier({process,path:`/Applications/${process}.app/Contents/MacOS/${exe}`}),ACCESS.CLICK,process);
 for(const [process,exe] of [['Safari','Safari'],['Google Chrome','Google Chrome'],['Firefox','firefox'],['TextEdit','TextEdit'],
  ['Calculator','Calculator'],['Preview','Preview'],['Pages','Pages'],['Notes','Notes']])
  assert.equal(accessTier({process,path:`/Applications/${process}.app/Contents/MacOS/${exe}`}),ACCESS.FULL,process);
 assert.equal(accessTier({process:'1Password',path:'/Applications/1Password.app/Contents/MacOS/1Password'}),null);
});

test('click tier allows only plain left clicks, moves, scrolls and focus; refusals name the tier',()=>{
 for(const op of ['click','move','scroll','focus','fit_window','resize_window'])assert.equal(accessRefusal(ACCESS.CLICK,op,{}),null,op);
 assert.equal(accessRefusal(ACCESS.CLICK,'click',{button:'left'}),null);
 for(const [op,args] of [['type',{}],['key',{}],['paste',{}],['set_value',{}],['drag',{}],['paste_files',{}],['file_dialog',{}],['open',{}],['click',{button:'right'}],['click',{button:'middle'}],['click',{modifiers:'ctrl'}]]){
  const refusal=accessRefusal(ACCESS.CLICK,op,args);assert.equal(refusal?.code,'app_tier_click',op);assert.match(refusal.message,/tier "click"/);assert.match(refusal.message,/no input was sent/);
 }
 assert.equal(accessRefusal(ACCESS.READ,'click',{}).code,'app_tier_read');assert.equal(accessRefusal(ACCESS.READ,'focus',{}),null);
 for(const op of ['type','key','drag','click'])assert.equal(accessRefusal(ACCESS.FULL,op,{button:'right'}),null);
 assert.equal(recoveryAdvice({error:{code:'app_tier_click'}}).next_action,'choose_permitted_target');
});

test('runtime refuses typing into a click-tier app before any input',async()=>{
 const r=runtime();const w={hwnd:5,pid:20,started:'s',path:'C:/x/WindowsTerminal.exe',process:'WindowsTerminal'};
 r.state='active';r.token='t';r.deadline=Date.now()+10000;r.grant=async()=>w;let calls=0;r.driver.call=async()=>{calls++;return {result:{}};};
 try{
  await assert.rejects(r.action('type',{hwnd:5,observation_id:'none',text:'rm -rf',reason:'fixture'}),e=>e.code==='app_tier_click'&&e.tier==='click');
  await assert.rejects(r.action('click',{hwnd:5,observation_id:'none',index:1,button:'right',reason:'fixture'}),e=>e.code==='app_tier_click');
  assert.equal(calls,0);
 }finally{fs.unlinkSync(r.guardFile);}
});

test('request_access asks once per app, reports tiers, and Stop ends the grants of the task',async()=>{
 const r=runtime({request:async m=>m.op==='activate'?{allowed:true}:{state:'idle',controls_visible:true}});
 const apps={1:{hwnd:1,pid:11,started:'a',path:'C:/x/mspaint.exe',process:'mspaint',title:'Paint'},2:{hwnd:2,pid:12,started:'b',path:'C:/x/Code.exe',process:'Code',title:'Editor'}};
 r.app=async h=>apps[h];
 try{
  const result=await r.requestAccess({hwnds:[1,2,1],reason:'fixture'});
  assert.equal(result.approved,2);assert.deepEqual(result.apps.map(a=>a.tier),['full','click']);assert.equal(r.guardian.prompts,2);
  assert.deepEqual(r.status().approved_apps.map(a=>a.tier),['full','click']);
  await r.grant(1,'again');assert.equal(r.guardian.prompts,2,'an approved app is not asked again');
  await r.stop();assert.equal(r.grants.size,0);assert.equal(r.status().approved_apps.length,0);
  const ready=await r.ready();assert.equal(ready.ready,true);assert.equal(ready.task_started,true);
  await r.grant(1,'after stop');assert.equal(r.guardian.prompts,3,'a new conversation (no handle) is asked again');
  await assert.rejects(r.requestAccess({hwnds:[]}),e=>e.code==='bad_arguments');
 }finally{fs.unlinkSync(r.guardFile);}
});

test('native session expiry reaches in-flight calls as a renewable session_limit',async()=>{
 const r=runtime();
 try{
  r.state='active';r.token='t';r.guardian.emit('state','idle');
  assert.throws(()=>r.check(),e=>e.code==='session_limit');
  assert.equal(recoveryAdvice({error:{code:'session_limit'}}).next_action,'renew_task_and_continue');
  // Native controls that name the reason report the same renewable limit.
  const named=runtime();named.state='active';named.token='t';named.guardian.emit('state','idle','session_expired');assert.throws(()=>named.check(),e=>e.code==='session_limit');fs.unlinkSync(named.guardFile);
  // An idle state with another reason (End, shutdown) is not an expiry.
  const other=runtime();other.state='active';other.token='t';other.guardian.emit('state','idle','completed');assert.throws(()=>other.check(),e=>e.code==='control_inactive');fs.unlinkSync(other.guardFile);
 }finally{fs.unlinkSync(r.guardFile);}
});

test('ready clears a confirmed Stop only after a live guardian confirms input release',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-clear-stop-')),latchFile=path.join(dir,'emergency.stop');
 const r=runtime({latchFile});
 try{
  r.state='active';await r.stop();assert(fs.existsSync(latchFile));
  let closed=0;r.guardian.proc={};r.guardian.initialized=true;r.guardian.close=async()=>{closed++;r.guardian.proc=null;};
  r.guardian.stopAcknowledged=async()=>{throw Object.assign(Error('no receipt'),{code:'guardian_stop_unconfirmed'});};
  const refused=await r.ready();assert.equal(refused.ready,false);assert.equal(refused.error.code,'stop_cleanup_unverified');assert.equal(refused.next_action,'inspect_input_cleanup');assert(fs.existsSync(latchFile));assert.equal(closed,0);
  r.guardian.stopAcknowledged=async nonce=>({stop_nonce:nonce,workers_stopped:true,input_cleanup_confirmed:true});
  const ready=await r.ready();assert.equal(ready.ready,true);assert.equal(closed,1,'old controls restart without the marker');assert(!fs.existsSync(latchFile));
  r.state='stopped';r.lastControlReason='requested_stop';r.driver.inputMayBeHeld=true;fs.writeFileSync(latchFile,'stopped');
  const held=await r.ready();assert.equal(held.error.code,'input_cleanup_failed');assert(fs.existsSync(latchFile));
 }finally{fs.unlinkSync(r.guardFile);fs.rmSync(dir,{recursive:true,force:true});}
});

test('ready clears a confirmed Stop through native clear_stop without restarting the controls',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-native-clear-')),latchFile=path.join(dir,'emergency.stop');
 const ops=[];let answer={cleared:false,state:'stopped',reason:'input_cleanup_unverified'};
 const r=runtime({latchFile,request:async m=>{ops.push(m.op);if(m.op==='clear_stop'){if(answer.cleared)fs.unlinkSync(latchFile);return answer;}return m.op==='activate'?{allowed:true}:{state:'idle',controls_visible:true};}});
 try{
  r.state='active';await r.stop();assert(fs.existsSync(latchFile));
  let closed=0;r.guardian.proc={};r.guardian.initialized=true;r.guardian.capabilities={clear_stop:true};r.guardian.close=async()=>{closed++;};
  r.guardian.stopAcknowledged=async nonce=>({stop_nonce:nonce,workers_stopped:true,input_cleanup_confirmed:true});
  const refused=await r.ready();assert.equal(refused.ready,false);assert.equal(refused.error.code,'stop_cleanup_unverified');assert(fs.existsSync(latchFile),'a refused clear leaves the marker');
  answer={cleared:false,state:'stopped',reason:'guardian_stop_unconfirmed'};
  const unconfirmed=await r.ready();assert.equal(unconfirmed.error.code,'guardian_stop_unconfirmed');assert(fs.existsSync(latchFile));
  r.lastControlReason='requested_stop';answer={cleared:true,state:'idle',reason:null};
  const ready=await r.ready();assert.equal(ready.ready,true);assert.equal(closed,0,'the controls are not restarted');assert(!fs.existsSync(latchFile));assert(ops.includes('clear_stop'));
  // A reply that claims success while the marker is still there is refused.
  r.state='stopped';r.lastControlReason='requested_stop';fs.writeFileSync(latchFile,'stopped');
  r.guardian.request=async m=>m.op==='clear_stop'?{cleared:true,state:'idle'}:{state:'idle',controls_visible:true};
  const lied=await r.ready();assert.equal(lied.error.code,'stop_persistence_failed');
 }finally{fs.unlinkSync(r.guardFile);fs.rmSync(dir,{recursive:true,force:true});}
});

test('every app prompt carries the tier and the conversation handle, and End returns the handle for renewal',async()=>{
 const r=runtime({request:async m=>m.op==='activate'?{allowed:true}:{state:'idle',controls_visible:true}});
 const prompts=[];r.guardian.prompt=async m=>{prompts.push(m);return {allowed:true};};
 r.app=async()=>({hwnd:2,pid:12,started:'b',path:'C:/x/Code.exe',process:'Code',title:'Editor'});
 try{
  const first=await r.ready();await r.grant(2,'first');
  assert.equal(prompts[0].tier,'click');assert.equal(prompts[0].session_handle,first.session_handle);assert.equal(prompts[0].remembered,undefined);
  const ended=await r.finish();assert.equal(ended.session_handle,first.session_handle);
 }finally{fs.unlinkSync(r.guardFile);}
});

test('clearConfirmedStop never removes an unconfirmed or invalid marker',()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-clear-marker-')),file=path.join(dir,'emergency.stop');
 try{
  assert.equal(clearConfirmedStop(file),false);
  fs.writeFileSync(file,'stopped');assert.equal(clearConfirmedStop(file),true);assert(!fs.existsSync(file));
  fs.writeFileSync(file,'unconfirmed:'+'b'.repeat(32));assert.throws(()=>clearConfirmedStop(file),e=>e.code==='guardian_stop_unconfirmed');assert(fs.existsSync(file));fs.unlinkSync(file);
  fs.writeFileSync(file,'stopped');fs.writeFileSync(file+'.unconfirmed','unconfirmed:'+'c'.repeat(32));assert.throws(()=>clearConfirmedStop(file));assert(fs.existsSync(file));
  fs.unlinkSync(file+'.unconfirmed');fs.unlinkSync(file);fs.writeFileSync(file,'garbage');assert.throws(()=>clearConfirmedStop(file),e=>e.code==='stop_persistence_failed');assert(fs.existsSync(file));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('approvals last for the conversation handle and survive End, expiry and Stop',async()=>{
 const r=runtime({request:async m=>m.op==='activate'?{allowed:true}:{state:'idle',controls_visible:true}});
 const seen=[];r.guardian.prompt=async m=>{seen.push(m.remembered===true);return {allowed:true};};
 r.app=async()=>({hwnd:1,pid:11,started:'a',path:'C:/x/mspaint.exe',process:'mspaint',title:'Paint'});
 try{
  const first=await r.ready();assert.match(first.session_handle,/^[0-9a-f-]{36}$/);
  await r.grant(1,'first');await r.finish();
  r.guardian.emit('state','idle');
  const later=await r.ready({session_handle:first.session_handle});assert.equal(later.session_handle,first.session_handle);
  await r.grant(1,'later');assert.deepEqual(seen,[false,true],'same conversation marks the app as already approved');
  // Owner rule: Esc or Stop ends the task but no approval card follows it.
  await r.stop();assert.equal(r.sessionHandle,first.session_handle);
  const after=await r.ready({session_handle:first.session_handle});assert.equal(after.session_handle,first.session_handle,'Stop keeps the conversation');
  await r.grant(1,'after stop');assert.equal(seen.at(-1),true,'the app is still marked as approved after Stop');
  const other=await r.ready();assert.notEqual(other.session_handle,after.session_handle,'a new conversation asks again');
  await r.grant(1,'new conversation');assert.equal(seen.at(-1),false);
 }finally{fs.unlinkSync(r.guardFile);}
});

test('native controls always start in manual takeover: human input never pauses the agent',()=>{
 const r=new Runtime({guardian:Object.assign(new EventEmitter(),{send(){}}),driver:{async abort(){}},sessions:{register(){},close(){}},takeoverMode:'smart'});
 try{assert.equal(r.takeoverMode,'manual');}finally{fs.unlinkSync(r.guardFile);}
});

test('a refused second copy opens no task and is asked again on the next ready',async()=>{
 let held=true;
 const r=runtime({request:async m=>{if(m.op==='show_controls'&&held)throw Object.assign(Error('held'),{code:'input_lease_held'});return m.op==='activate'?{allowed:true}:{state:'idle',controls_visible:true};}});
 try{
  const refused=await r.ready();assert.equal(refused.ready,false);assert.equal(refused.error.code,'input_lease_held');assert.match(refused.error.message,/Another copy of Computer Use is controlling this PC; multiple copies are not supported yet\./);
  assert.equal(refused.next_action,'human_close_other_copy');assert.equal(r.taskOpen,false,'nothing was started, so no task stays open');
  held=false;const ready=await r.ready();assert.equal(ready.ready,true);assert.equal(ready.task_started,true);
 }finally{fs.unlinkSync(r.guardFile);}
});

test('on macOS the activity message names the approved window by process and frame for the glow',()=>{
 const descriptor=Object.getOwnPropertyDescriptor(process,'platform');
 try{
  Object.defineProperty(process,'platform',{value:'darwin'});
  assert.deepEqual(Runtime.prototype.glowTarget.call({},{pid:42,rect:[1,2,300,200]}),{pid:42,rect:[1,2,300,200]});
  for(const w of [null,{pid:42},{pid:'42',rect:[1,2,3,4]},{pid:42,rect:[1,2,3]}])assert.deepEqual(Runtime.prototype.glowTarget.call({},w),{});
  Object.defineProperty(process,'platform',{value:'win32'});
  assert.deepEqual(Runtime.prototype.glowTarget.call({},{pid:42,rect:[1,2,300,200]}),{});
 }finally{Object.defineProperty(process,'platform',descriptor);}
});
