import test from 'node:test';
import assert from 'node:assert/strict';
import {Runtime,appKey} from '../server/runtime.mjs';

function fixture({answer={allowed:true},physical=true,capability=true,rect=[1120,42,30,30]}={}){
 const calls=[];let delivered=0;
 const app={hwnd:1,pid:20,started:'one',path:'fixture.exe'};
 const runtime={generation:1,deadline:Date.now()+10000,remaining:10,state:'active',token:'private-session',frames:new Map(),
  async grant(){return app;},async app(){return app;},check(){if(this.state!=='active')throw Object.assign(Error('Stopped'),{code:'control_inactive'});},stamp(){return {};},
  guardian:{send(){},async request(message){calls.push(message);return typeof answer==='function'?answer(runtime):answer;}},
  sessions:{async withInput(_op,_target,execute){return execute();}},
  driver:{epoch:1,info:{hud_avoidance:capability},async call(op){calls.push(op);if(op==='authorize')return {result:{sensitive:false}};delivered++;return {result:{clicked:true}};}},
  async observe(){return {metadata:{observation_id:'verified'}};}};
 runtime.frames.set('fresh',{at:Date.now(),hwnd:1,key:appKey(app),snapshot:'s1',workerEpoch:1,elements:[{i:3,rect}]});
 return {runtime,calls,delivered:()=>delivered,act:()=>Runtime.prototype.action.call(runtime,'click',{hwnd:1,observation_id:'fresh',index:3,risk:'routine',physical})};
}

test('physical click waits for authenticated own-HUD positioning before dispatch',async()=>{
 const f=fixture();const result=await f.act();assert(result.input_completed);assert.equal(f.delivered(),1);
 const message={op:'avoid_input',token:'private-session',rect:[1120,42,30,30]};
 assert.deepEqual(f.calls,[message,'authorize',message,'click']);
});
test('failed HUD avoidance sends no app input and does not consume the action budget',async()=>{
 const f=fixture({answer:{allowed:false}});await assert.rejects(f.act(),e=>e.code==='hud_target_obscured');
 assert.equal(f.delivered(),0);assert.equal(f.runtime.remaining,10);assert.equal(f.runtime.frames.size,0);
});
test('unknown HUD delivery sends no app input and is not retried',async()=>{
 const failure=Object.assign(Error('Unconfirmed'),{code:'guardian_request_timeout'});
 const f=fixture({answer(){throw failure;}});await assert.rejects(f.act(),e=>e===failure);
 assert.equal(f.delivered(),0);assert.equal(f.calls.length,1);
});
test('Stop during HUD positioning wins before input dispatch',async()=>{
 const f=fixture({answer(runtime){runtime.state='stopped';runtime.generation++;return {allowed:true};}});
 await assert.rejects(f.act(),e=>e.code==='control_inactive');assert.equal(f.delivered(),0);assert.equal(f.runtime.remaining,10);
});
test('explicit semantic clicks do not reposition controls',async()=>{
 const f=fixture({physical:false});await f.act();assert.deepEqual(f.calls,['authorize','click']);
});
test('older or other-platform native workers retain their existing occlusion checks',async()=>{
 const f=fixture({capability:false});await f.act();assert.deepEqual(f.calls,['authorize','click']);
});
test('large control bounds use their center instead of demanding the HUD leave the display',async()=>{
 const f=fixture({rect:[0,0,1920,1080]});await f.act();assert.deepEqual(f.calls[0].rect,[960,540,1,1]);
});

test('pixel targets preserve screenshot scaling and negative monitor origins for HUD avoidance',async()=>{
 const f=fixture();
 f.runtime.frames.get('fresh').image={source:[-1920,0,1920,1080],width:960,height:540};
 f.runtime.app=f.runtime.grant=async()=>({hwnd:1,pid:20,started:'one',path:'fixture.exe',rect:[-1920,0,1920,1080]});
 await Runtime.prototype.action.call(f.runtime,'click',{hwnd:1,observation_id:'fresh',x:500,y:100,risk:'routine'});
 assert.deepEqual(f.calls[0].rect,[-920,200,1,1]);assert.equal(f.delivered(),1);
});

test('session expiry during the final HUD acknowledgement prevents dispatch',async()=>{
 let requests=0;
 const f=fixture({answer(runtime){if(++requests===2)runtime.deadline=0;return {allowed:true};}});
 await assert.rejects(f.act(),e=>e.code==='session_limit');assert.equal(f.delivered(),0);assert.equal(f.runtime.remaining,10);
});
