import test from 'node:test';import assert from 'node:assert/strict';
import {actionPoint} from '../server/runtime.mjs';

test('the glow is told the screen point a native action reports',()=>{
 assert.deepEqual(actionPoint({point:[640,-12],method:'physical'}),[640,-12]);
 assert.deepEqual(actionPoint({point:[0,0]}),[0,0]);
});
test('a missing or malformed point is not passed to native controls',()=>{
 for(const result of [undefined,null,{},{point:null},{point:[1]},{point:[1,2,3]},{point:['1',2]},{point:[1.5,2]},{point:[1e9,2]},{point:{x:1,y:2}}])
  assert.equal(actionPoint(result),null,JSON.stringify(result));
});
test('the point message carries the Mac glow target and adds nothing on Windows',async()=>{
 const {Runtime}=await import('../server/runtime.mjs');const fs=await import('node:fs');
 const w={hwnd:7,pid:321,rect:[10,20,300,200]},original=Object.getOwnPropertyDescriptor(process,'platform');
 try{
  Object.defineProperty(process,'platform',{value:'darwin'});assert.deepEqual(Runtime.prototype.glowTarget(w),{pid:321,rect:[10,20,300,200]});
  Object.defineProperty(process,'platform',{value:'win32'});assert.deepEqual(Runtime.prototype.glowTarget(w),{});
 }finally{Object.defineProperty(process,'platform',original);}
 // The Mac guardian moves the glow only with the window's pid and frame.
 const source=fs.readFileSync(new URL('../server/runtime.mjs',import.meta.url),'utf8');
 assert.match(source,/point:landed,\.\.\.Runtime\.prototype\.glowTarget\.call\(this,w\)/);
});
