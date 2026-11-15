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

test('click tier allows only plain left clicks, moves, scrolls and focus; refusals name the tier',()=>{
 for(const op of ['click','move','scroll','focus','fit_window'])assert.equal(accessRefusal(ACCESS.CLICK,op,{}),null,op);
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

test('request_access asks once per app, reports tiers, and Stop revokes every approval',async()=>{
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
  await r.grant(1,'after stop');assert.equal(r.guardian.prompts,3,'after Stop the Allow prompt appears again');
  await assert.rejects(r.requestAccess({hwnds:[]}),e=>e.code==='bad_arguments');
 }finally{fs.unlinkSync(r.guardFile);}
});

test('native session expiry reaches in-flight calls as a renewable session_limit',async()=>{
 const r=runtime();
 try{
  r.state='active';r.token='t';r.guardian.emit('state','idle');
  assert.throws(()=>r.check(),e=>e.code==='session_limit');
  assert.equal(recoveryAdvice({error:{code:'session_limit'}}).next_action,'renew_task_and_continue');
  // An idle state with a reason (End, shutdown) is not an expiry.
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

test('approvals last for the conversation handle, survive End and expiry, and Stop revokes them',async()=>{
 const r=runtime({request:async m=>m.op==='activate'?{allowed:true}:{state:'idle',controls_visible:true}});
 const seen=[];r.guardian.prompt=async m=>{seen.push(m.remembered===true);return {allowed:true};};
 r.app=async()=>({hwnd:1,pid:11,started:'a',path:'C:/x/mspaint.exe',process:'mspaint',title:'Paint'});
 try{
  const first=await r.ready();assert.match(first.session_handle,/^[0-9a-f-]{36}$/);
  await r.grant(1,'first');await r.finish();
  r.guardian.emit('state','idle');
  const later=await r.ready({session_handle:first.session_handle});assert.equal(later.session_handle,first.session_handle);
  await r.grant(1,'later');assert.deepEqual(seen,[false,true],'same conversation marks the app as already approved');
  await r.stop();assert.equal(r.sessionHandle,null);
  const after=await r.ready({session_handle:first.session_handle});assert.notEqual(after.session_handle,first.session_handle,'Stop revoked the handle');
  await r.grant(1,'after stop');assert.equal(seen.at(-1),false);
  const other=await r.ready();assert.notEqual(other.session_handle,after.session_handle,'a new conversation asks again');
 }finally{fs.unlinkSync(r.guardFile);}
});

test('native controls always start in manual takeover: human input never pauses the agent',()=>{
 const r=new Runtime({guardian:Object.assign(new EventEmitter(),{send(){}}),driver:{async abort(){}},sessions:{register(){},close(){}},takeoverMode:'smart'});
 try{assert.equal(r.takeoverMode,'manual');}finally{fs.unlinkSync(r.guardFile);}
});
