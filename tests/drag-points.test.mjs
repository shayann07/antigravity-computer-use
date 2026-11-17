import test from 'node:test';
import assert from 'node:assert/strict';
import {Runtime,appKey,dragBudgetMs} from '../server/runtime.mjs';
import {recoveryAdvice} from '../server/recovery.mjs';
import {recoveryFor} from '../server/recovery-guide.mjs';

// A window at screen [100,50] sized 400x200, captured as a 200x100 screenshot.
function fixture(){
 const sent=[];
 const app={hwnd:1,pid:20,started:'one',path:'fixture.exe',rect:[100,50,400,200]};
 const runtime={generation:1,deadline:Date.now()+10000,remaining:10,state:'active',token:'private-session',frames:new Map(),
  async grant(){return app;},async app(){return app;},check(){},stamp(){return {};},
  guardian:{send(){},async request(){return {allowed:true};}},
  sessions:{async withInput(_op,_target,execute){return execute();}},
  driver:{epoch:1,info:{},async call(op,payload){sent.push({op,payload});if(op==='authorize')return {result:{sensitive:false}};return {result:{dragged:true}};}},
  async observe(){return {metadata:{observation_id:'after'}};}};
 runtime.frames.set('fresh',{at:Date.now(),hwnd:1,key:appKey(app),snapshot:'s1',workerEpoch:1,elements:[],image:{source:[100,50,400,200],width:200,height:100}});
 const drag=args=>Runtime.prototype.action.call(runtime,'drag',{hwnd:1,observation_id:'fresh',risk:'routine',reason:'test',...args});
 return {runtime,sent,drag,drags:()=>sent.filter(s=>s.op==='drag')};
}

// Points drags are Windows-only today, so the mapping is checked as on Windows
// whichever platform runs the suite.
async function asPlatform(platform,body){
 const original=Object.getOwnPropertyDescriptor(process,'platform');
 Object.defineProperty(process,'platform',{value:platform});
 try{return await body();}finally{Object.defineProperty(process,'platform',original);}
}

test('every drag point is mapped from screenshot pixels to the screen',async()=>{
 const f=fixture();
 const result=await asPlatform('win32',()=>f.drag({points:[[0,0],[100,50],[199,99]]}));
 assert.equal(result.input_completed,true);
 const [{payload}]=f.drags();
 assert.deepEqual(payload.points,[[100,50],[300,150],[498,248]]);
 assert.deepEqual(payload.from,[100,50]);assert.deepEqual(payload.to,[498,248]);
});

test('a straight from/to drag is unchanged',async()=>{
 const f=fixture();await f.drag({from:[0,0],to:[100,50]});
 const [{payload}]=f.drags();
 assert.deepEqual(payload.from,[100,50]);assert.deepEqual(payload.to,[300,150]);assert.equal(payload.points,undefined);
});

test('points together with from/to, or neither, is refused before any input',async()=>{
 for(const args of [{points:[[0,0],[10,10]],from:[0,0],to:[10,10]},{}]){
  const f=fixture();
  await assert.rejects(f.drag(args),e=>e.code==='bad_points');
  assert.equal(f.drags().length,0);
 }
 assert.equal(recoveryAdvice({error:{code:'bad_points'}}).next_action,'fix_drag_points');
 assert.ok(recoveryFor('fix_drag_points'));
});

test('macOS sends a points drag to the host as one stroke, like Windows',async()=>{
 const f=fixture();
 await asPlatform('darwin',()=>f.drag({points:[[0,0],[50,20],[100,50]]}));
 assert.equal(f.drags().length,1);
 const [{payload:sent}]=f.drags();assert.equal(sent.points.length,3);assert.deepEqual(sent.from,sent.points[0]);assert.deepEqual(sent.to,sent.points.at(-1));
 // Older builds still refuse with points_unsupported; its advice stays.
 assert.equal(recoveryAdvice({error:{code:'points_unsupported'}}).next_action,'fix_drag_points');
});

// On 2026-11-14 a long brush stroke started about 9 s before the 10-minute
// session deadline; the guardian ended the session mid-stroke by terminating
// the worker (exit -1, host_exited). A stroke that cannot finish must not start.
test('a long stroke that cannot finish before the session deadline is refused before any input',async()=>{
 const points=Array.from({length:400},(_,i)=>[i%2?199:0,Math.floor(i/4)]);
 const f=fixture();f.runtime.deadline=Date.now()+9000;
 await asPlatform('win32',()=>assert.rejects(f.drag({points}),e=>e.code==='session_limit'&&/No input was sent/.test(e.message)));
 assert.equal(f.drags().length,0);
 assert.equal(f.runtime.remaining,10);
 const roomy=fixture();roomy.runtime.deadline=Date.now()+60000;
 await asPlatform('win32',()=>roomy.drag({points}));
 assert.equal(roomy.drags().length,1);
});

test('the drag budget covers the capped hop plan at the Windows timer tick',()=>{
 const long=Array.from({length:400},(_,i)=>[i%2?2000:0,i]);
 assert.ok(dragBudgetMs({points:long})>=1500*16+120);
 assert.ok(dragBudgetMs({from:[0,0],to:[10,10],steps:12})<3000);
 assert.ok(dragBudgetMs({from:[0,0],to:[10,10],hold_ms:2000})>=4000);
});

test('a bad launch path is the agent\'s to fix, not an operator incident',()=>{
 assert.equal(recoveryAdvice({error:{code:'invalid_application'}}).next_action,'fix_app_path');
 assert.equal(recoveryFor('fix_app_path').actor,'agent');
});

test('a spoiled or blocked capture sends the agent back to observe, not to diagnostics',()=>{
 assert.equal(recoveryAdvice({error:{code:'capture_changed'}}).next_action,'observe_again');
 assert.equal(recoveryAdvice({error:{code:'window_capture_unavailable'}}).next_action,'focus_target_then_observe');
});
