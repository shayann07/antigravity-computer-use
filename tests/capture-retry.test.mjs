import test from 'node:test';
import assert from 'node:assert/strict';
import {Runtime,appKey} from '../server/runtime.mjs';

// Window at [100,50] sized 400x200, screenshot 200x100.
function fixture(failures){
 const sent=[];let observes=0;
 const app={hwnd:1,pid:20,started:'one',path:'fixture.exe',rect:[100,50,400,200]};
 const runtime={generation:1,deadline:Date.now()+10000,remaining:10,state:'active',token:'t',frames:new Map(),
  async grant(){return app;},async app(){return app;},check(){},stamp(){return {};},
  guardian:{send(){},async request(){return {allowed:true};}},
  sessions:{async withInput(_op,_target,execute){return execute();}},
  driver:{epoch:1,info:{},async call(op,payload){sent.push({op,payload});if(op==='authorize')return {result:{sensitive:false}};return {result:{clicked:true}};}},
  async observe(){observes++;if(failures.length){const code=failures.shift();throw Object.assign(Error(code),{code});}return {metadata:{observation_id:'after'}};}};
 runtime.frames.set('fresh',{at:Date.now(),hwnd:1,key:appKey(app),snapshot:'s1',workerEpoch:1,elements:[],image:{source:[100,50,400,200],width:200,height:100}});
 const click=()=>Runtime.prototype.action.call(runtime,'click',{hwnd:1,observation_id:'fresh',x:10,y:10,risk:'routine',reason:'test'});
 return {click,sent,observes:()=>observes};
}

test('a check capture spoiled by a passing overlay is retried once',async()=>{
 const f=fixture(['capture_changed']);
 const r=await f.click();
 assert.equal(r.verification_error,undefined);
 assert.equal(r.metadata.observation_id,'after');
 assert.equal(f.observes(),2);
 assert.equal(f.sent.filter(s=>s.op==='click').length,1);
});

test('a second spoiled capture is reported, never retried again',async()=>{
 const f=fixture(['capture_changed','capture_changed']);
 const r=await f.click();
 assert.equal(r.verification_error.code,'capture_changed');
 assert.equal(f.observes(),2);
});

test('other observation failures are not retried',async()=>{
 const f=fixture(['window_gone']);
 const r=await f.click();
 assert.equal(r.verification_error.code,'window_gone');
 assert.equal(f.observes(),1);
});
