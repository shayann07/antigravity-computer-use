import test from 'node:test';
import assert from 'node:assert/strict';
import {Runtime,appKey} from '../server/runtime.mjs';
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

test('every drag point is mapped from screenshot pixels to the screen',async()=>{
 const f=fixture();
 const result=await f.drag({points:[[0,0],[100,50],[199,99]]});
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

test('macOS refuses a points drag instead of silently drawing a straight line',async()=>{
 const original=Object.getOwnPropertyDescriptor(process,'platform');
 Object.defineProperty(process,'platform',{value:'darwin'});
 try{
  const f=fixture();
  await assert.rejects(f.drag({points:[[0,0],[50,20],[100,50]]}),e=>e.code==='points_unsupported');
  assert.equal(f.drags().length,0);
 }finally{Object.defineProperty(process,'platform',original);}
 assert.equal(recoveryAdvice({error:{code:'points_unsupported'}}).next_action,'fix_drag_points');
});
