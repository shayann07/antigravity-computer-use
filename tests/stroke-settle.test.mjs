import test from 'node:test';
import assert from 'node:assert/strict';
import {call} from '../server/desktop-tools.mjs';

const stroke=(from,to)=>({kind:'drag',from,to});
const plan=steps=>({hwnd:7,observation_id:'initial',reason:'Draw the outline',steps});
function recorder(fail){
 const seen=[];
 return {seen,runtime:{async action(op,a){
  seen.push({op,observe:a.observe,frame:a.observation_id});
  if(fail&&fail(seen.length))throw Object.assign(Error('Stopped by the user.'),{code:'stopped_by_user'});
  return {input_completed:true,metadata:{observation_id:'frame-'+seen.length}};
 }}};
}

test('a drag handing off to another stroke skips the paint settle but keeps the capture',async()=>{
 const {seen,runtime}=recorder();
 const result=await call(runtime,'computer_run',plan([stroke([1,1],[5,5]),stroke([6,6],[9,9]),stroke([9,9],[12,4])]));
 assert.equal(result.batch.completed.length,3);
 assert.deepEqual(seen.map(s=>s.op),['drag','drag','drag']);
 for(const s of seen.slice(0,2)){assert.equal(s.observe.settle_ms,0);assert.equal(s.observe.with_image,true);}
 // The last step is what the model sees, so it keeps the default settle.
 assert.equal(Object.hasOwn(seen[2].observe,'settle_ms'),false);
 assert.equal(seen[2].observe.with_image,true);
 // Each stroke still acts on the frame the previous one produced.
 assert.deepEqual(seen.map(s=>s.frame),['initial','frame-1','frame-2']);
});

test('a drag followed by a pixel click or move also skips the settle',async()=>{
 const {seen,runtime}=recorder();
 await call(runtime,'computer_run',plan([stroke([1,1],[5,5]),{kind:'move',x:3,y:3},stroke([1,1],[2,2]),{kind:'click',x:4,y:4}]));
 assert.equal(seen[0].observe.settle_ms,0);
 assert.equal(seen[2].observe.settle_ms,0);
 // A move already observes without settle in the runtime; the batch leaves it alone.
 assert.equal(Object.hasOwn(seen[1].observe,'settle_ms'),false);
});

test('clicks, selector hand-offs and the last step keep the full settle',async()=>{
 const {seen,runtime}=recorder();
 await call(runtime,'computer_run',plan([{kind:'click',x:2,y:2},stroke([1,1],[5,5]),{kind:'click',name:'OK'},stroke([1,1],[5,5])]));
 // click -> drag: a click can open UI, so the next pixel input must wait.
 assert.equal(Object.hasOwn(seen[0].observe,'settle_ms'),false);
 // drag -> selector click: the next step reads the tree, so it must be settled.
 assert.equal(Object.hasOwn(seen[1].observe,'settle_ms'),false);
 assert.equal(Object.hasOwn(seen[3].observe,'settle_ms'),false);
});

test('an explicit observe settle on a stroke wins over the hand-off shortcut',async()=>{
 const {seen,runtime}=recorder();
 await call(runtime,'computer_run',plan([{...stroke([1,1],[5,5]),observe:{settle_ms:400}},stroke([6,6],[9,9])]));
 assert.equal(seen[0].observe.settle_ms,400);
});

test('a Stop during a stroke chain still ends the batch before the next input',async()=>{
 const {seen,runtime}=recorder(n=>n===2);
 const result=await call(runtime,'computer_run',plan([stroke([1,1],[5,5]),stroke([6,6],[9,9]),stroke([9,9],[12,4])]));
 assert.equal(result.ok,false);
 assert.equal(result.error.code,'stopped_by_user');
 assert.equal(result.failed_index,1);
 assert.equal(result.skipped,1);
 assert.equal(seen.length,2);
});
