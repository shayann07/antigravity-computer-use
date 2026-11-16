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
