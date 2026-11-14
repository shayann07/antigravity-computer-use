import test from 'node:test';
import assert from 'node:assert/strict';
import {call,TOOLS,validate} from '../server/desktop-tools.mjs';
import {Runtime,appKey,comparableView,waitUntil} from '../server/runtime.mjs';
import {parseRunArguments} from '../scripts/arguments.mjs';
const args=steps=>({hwnd:7,observation_id:'initial',reason:'Verify once, never replay',steps});
const describe=kind=>({inputSchema:TOOLS.find(tool=>tool.name==='computer_'+kind).inputSchema});

test('an early timer wake cannot complete a polling delay before its deadline',async()=>{
 let now=0,calls=0;await waitUntil(2,{now:()=>now,sleep:async requested=>{assert(requested>=1);if(++calls>4)throw Error('unbounded timer loop');now+=0.5;}});
 assert.equal(now,2);assert.equal(calls,4);
});
test('poll delay checks cancellation without triggering another observation',async()=>{
 let now=0,sleeps=0,checks=0;
 await assert.rejects(waitUntil(500,{now:()=>now,sleep:async ms=>{assert(ms<=100);sleeps++;now+=ms;},check:()=>{if(++checks===2)throw Error('stopped');}}),/stopped/);
 assert.equal(sleeps,2);assert.equal(now,200);
});

test('a batch waits then uses the freshly verified frame for its next action',async()=>{
 const seen=[];
 const runtime={async action(op,a){seen.push({op,frame:a.observation_id});return{metadata:{observation_id:'after-click'}};},async wait(){seen.push({op:'wait'});return{matched:true,metadata:{observation_id:'verified'}};}};
 const plan=parseRunArguments(describe('run').inputSchema,['--hwnd','7','--observation-id','initial','--reason','Observe processing','--step','click','--name','Start','--step','wait','--until','Ready','--timeout-ms','30000','--step','click','--name','Details'],describe);
 const result=await call(runtime,'computer_run',plan);
 assert.deepEqual(seen,[{op:'click',frame:'initial'},{op:'wait'},{op:'click',frame:'verified'}]);
 assert.equal(result.batch.completed.length,3);
});

test('batch waits skip intermediate images and reject unseen pixel targets before input',async()=>{
 let inputs=0;const imageFlags=[];
 const runtime={async action(){inputs++;return{metadata:{observation_id:'next'}};},async wait(a){imageFlags.push(a.with_image);return{matched:true,metadata:{observation_id:'wait-frame'}};}};
 await call(runtime,'computer_run',args([{kind:'wait',until:'Ready'},{kind:'click',name:'Details'}]));
 await call(runtime,'computer_run',args([{kind:'wait',until:'Ready'}]));
 await call(runtime,'computer_run',args([{kind:'wait',until:'Ready',with_image:true},{kind:'click',name:'Details'}]));
 assert.deepEqual(imageFlags,[false,true,true]);
 const before=inputs;
 await assert.rejects(call(runtime,'computer_run',args([{kind:'click',name:'Start'},{kind:'wait',until:'Ready',with_image:true},{kind:'click',x:2,y:3}])),/unseen batch observation/);
 assert.equal(inputs,before,'invalid batch must refuse before any input');
 await assert.rejects(call(runtime,'computer_run',args([{kind:'click',name:'Start'},{kind:'wait_change'},{kind:'click',x:2,y:3}])),/unseen batch observation/);
 assert.equal(inputs,before,'text-only change wait cannot feed a pixel action');
 const parsed=parseRunArguments(describe('run').inputSchema,['--hwnd','7','--observation-id','initial','--reason','Wait','--step','wait','--until','Ready','--image','--step','click','--x','2','--y','3'],describe);
 assert.equal(parsed.steps[0].with_image,true);
});

test('a text-only wait confirms the final tree without capturing a screenshot',async()=>{
 const flags=[],frames=new Map();let count=0;
 const runtime={frames,check(){},async observe(a){flags.push(a.with_image);const id='s'+(++count);frames.set(id,{});return{metadata:{observation_id:id,tree:'Ready'}};}};
 const result=await Runtime.prototype.wait.call(runtime,{hwnd:7,until:'Ready',with_image:false});
 assert.equal(result.matched,true);assert.deepEqual(flags,[false,false]);assert(!frames.has('s1'));assert(frames.has('s2'));assert.equal(result.wait_metrics.observations,2);assert.equal(result.wait_metrics.polling_budget_ms,15000);assert(result.wait_metrics.elapsed_ms>=0);
});

test('successful batch retains bounded wait timing without task contents',async()=>{
 const metrics={elapsed_ms:30,observations:2,polling_budget_ms:1000};
 const runtime={async wait(){return{matched:true,wait_metrics:metrics,metadata:{observation_id:'ready'}};},async action(){return{metadata:{observation_id:'after'}};}};
 const result=await call(runtime,'computer_run',args([{kind:'wait',until:'Ready'},{kind:'click',name:'Continue'}]));
 assert.deepEqual(result.batch.completed[0].wait_metrics,metrics);assert.equal(result.batch.completed[1].wait_metrics,undefined);
});
test('wait timeout stays bounded when the wall clock moves backwards',async()=>{
 const frames=new Map();let reads=0,clock=100000;const original=Date.now;
 const runtime={frames,check(){},async observe(){if(++reads>6)throw Error('unbounded wait');const id='s'+reads;frames.set(id,{});return{metadata:{observation_id:id,tree:'Loading'}};}};
 try{Date.now=()=>clock-=10000;const result=await Runtime.prototype.wait.call(runtime,{hwnd:7,until:'Ready',timeout_ms:100});assert.equal(result.timed_out,true);assert(reads<=6);}
 finally{Date.now=original;}
});
test('change-wait timeout stays bounded when the wall clock moves backwards',async()=>{
 const app={hwnd:7,pid:9,started:'one',path:'example.exe'},key=appKey(app),original=Date.now;let clock=original(),ticks=0;
 const frames=new Map([['initial',{at:clock,hwnd:7,key,workerEpoch:1,viewTree:'"App" hwnd=7\nLoading'}]]);let reads=0;
 const runtime={frames,generation:1,driver:{epoch:1},check(){},async grant(){return app;},async observe(){if(++reads>6)throw Error('unbounded wait');const id='s'+reads;frames.set(id,{key,workerEpoch:1});return {metadata:{observation_id:id,tree:id+' "App" hwnd=7\nLoading'}};}};
 try{Date.now=()=>++ticks===1?clock:(clock-=10000);const result=await Runtime.prototype.waitChange.call(runtime,{hwnd:7,observation_id:'initial',reason:'Wait',timeout_ms:100});assert.equal(result.timed_out,true);assert(reads<=6);}
 finally{Date.now=original;}
});

test('an unmet wait retains completed actions and never sends following input',async()=>{
 let inputs=0;
 const runtime={async action(){inputs++;return{metadata:{observation_id:'after'}};},async wait(){return{matched:false,timed_out:true,metadata:{observation_id:'inspect-this'}};}};
 const result=await call(runtime,'computer_run',args([{kind:'click',name:'Start'},{kind:'wait',until:'Ready'},{kind:'click',name:'Publish'}]));
 assert.equal(inputs,1);assert.equal(result.ok,false);assert.equal(result.verification_error.code,'wait_condition_timeout');
 assert.equal(result.batch.completed.length,1);assert.equal(result.batch.failed_index,1);assert.equal(result.batch.skipped,1);assert.equal(result.metadata.observation_id,'inspect-this');
});

test('Stop during a wait prevents later actions, and invalid wait budgets refuse before input',async()=>{
 let inputs=0;
 const runtime={async action(){inputs++;return{};},async wait(){throw Object.assign(Error('Human stopped'),{code:'control_inactive'});}};
 const stopped=await call(runtime,'computer_run',args([{kind:'wait',until:'Ready'},{kind:'click',name:'Publish'}]));
 assert.equal(inputs,0);assert.equal(stopped.error.code,'control_inactive');assert.equal(stopped.skipped,1);
 await assert.rejects(call(runtime,'computer_run',args([{kind:'click',name:'Start'},{kind:'wait',until:'Ready',timeout_ms:20000},{kind:'wait',until:'Saved',timeout_ms:20000}])),/Combined batch waits/);
 assert.equal(inputs,0);
 await assert.rejects(call(runtime,'computer_run',args([{kind:'click',name:'Start'},{kind:'wait',until:' '}])));assert.equal(inputs,0);
});

test('known failure wins over success, returns a fresh frame and prevents subsequent batch input',async()=>{
 let inputs=0,observations=0;
 const runtime={frames:new Map(),check(){},async action(){inputs++;return{metadata:{observation_id:'after'}};},
  async observe(){const id='frame'+(++observations);this.frames.set(id,{});return{metadata:{observation_id:id,tree:'Completed — Failed'}};}};
 runtime.wait=Runtime.prototype.wait.bind(runtime);
 const result=await call(runtime,'computer_run',args([{kind:'click',name:'Start'},{kind:'wait',until:'Completed',abort_on:['Failed','Cancelled']},{kind:'click',name:'Publish'}]));
 assert.equal(inputs,1);assert.equal(result.aborted,true);assert.equal(result.abort_match,'Failed');assert.equal(result.matched,false);
 assert.equal(result.verification_error.code,'wait_failure_observed');assert.equal(result.batch.skipped,1);assert.equal(result.metadata.observation_id,'frame1');assert.equal(observations,1);assert(runtime.frames.has('frame1'));
});
test('an image-requested failure wait still takes its final image observation',async()=>{
 let observations=0;const frames=new Map();
 const runtime={frames,check(){},async observe(args){const id='frame'+(++observations);frames.set(id,{});return{metadata:{observation_id:id,tree:'Failed'},...(args.with_image?{image:{data:'fixture'}}:{})};}};
 const result=await Runtime.prototype.wait.call(runtime,{hwnd:7,until:'Ready',abort_on:['Failed'],with_image:true});
 assert.equal(result.aborted,true);assert.equal(observations,2);assert.equal(result.metadata.observation_id,'frame2');assert.equal(result.image.data,'fixture');assert(!frames.has('frame1'));
});

test('wait abort labels are bounded and success remains compatible',async()=>{
 const schema=describe('wait').inputSchema;
 const plan=parseRunArguments(describe('run').inputSchema,['--hwnd','7','--observation-id','initial','--reason','Wait safely','--step','wait','--until','Ready','--abort-on','["Failed","Cancelled"]'],describe);
 assert.deepEqual(plan.steps[0].abort_on,['Failed','Cancelled']);
 for(const abort_on of [[],[''],Array(9).fill('Failed')])assert.throws(()=>validate('computer_wait',{hwnd:7,until:'Ready',reason:'test',abort_on}));
 assert(schema.properties.abort_on);
 let count=0;const runtime={frames:new Map(),check(){},async observe(){const id='s'+(++count);this.frames.set(id,{});return{metadata:{observation_id:id,tree:'Ready'}};}};
 const result=await Runtime.prototype.wait.call(runtime,{hwnd:7,until:'ready',abort_on:['Failed']});
 assert.equal(result.matched,true);assert.equal(result.metadata.observation_id,'s2');assert(!runtime.frames.has('s1'));
});

test('filtered failure-aware wait is refused before any batch input',async()=>{
 let inputs=0;
 const runtime={async action(){inputs++;return{};},async wait(){throw Error('unexpected wait');}};
 await assert.rejects(call(runtime,'computer_run',args([{kind:'click',name:'Start'},{kind:'wait',until:'Ready',abort_on:['Failed'],query:'Ready'}])),/query can hide failure labels/);
 assert.equal(inputs,0);
 assert.throws(()=>validate('computer_wait',{hwnd:7,until:'Ready',abort_on:['Failed'],query:'Ready',reason:'Wait'}),/query can hide failure labels/);
 validate('computer_wait',{hwnd:7,until:'Ready',query:'Ready',reason:'Wait'});
 validate('computer_wait',{hwnd:7,until:'Ready',abort_on:['Failed'],reason:'Wait'});
});

test('failure-aware wait stops a batch when the verified tree is incomplete',async()=>{
 let reads=0,inputs=0;const frames=new Map();
 const runtime={frames,check(){},async action(){inputs++;return{};},async observe(a){assert.equal(a.max_nodes,500);const id='v'+(++reads);frames.set(id,{});return{metadata:{observation_id:id,tree:'Ready',tree_incomplete:reads===2}};}};
 runtime.wait=Runtime.prototype.wait.bind(runtime);
 const result=await call(runtime,'computer_run',args([{kind:'click',name:'Start'},{kind:'wait',until:'Ready',abort_on:['Failed']},{kind:'click',name:'Publish'}]));
 assert.equal(inputs,1);assert.equal(result.incomplete,true);assert.equal(result.verification_error.code,'wait_observation_incomplete');assert.equal(result.batch.skipped,1);assert.equal(result.metadata.observation_id,'v2');
});

test('failure-aware wait catches captured failure text omitted from the displayed tree',async()=>{
 let inputs=0;const frames=new Map();
 const runtime={frames,check(){},async action(){inputs++;return{};},async observe(){frames.set('v',{});return{metadata:{observation_id:'v',tree:'Ready',elements:[{name:'A long message with a Failed result omitted by rendering'}]}};}};
 runtime.wait=Runtime.prototype.wait.bind(runtime);
 const result=await call(runtime,'computer_run',args([{kind:'wait',until:'Ready',abort_on:['Failed']},{kind:'click',name:'Continue'}]));
 assert.equal(result.aborted,true);assert.equal(result.abort_match,'Failed');assert.equal(result.batch.skipped,1);assert.equal(inputs,0);
});

test('wait rechecks the returned frame and aborts a batch if failure replaces a transient success',async()=>{
 let input=0,reads=0;const frames=new Map();
 const runtime={frames,check(){},async action(){input++;return{metadata:{observation_id:'post-action'}};},
  async observe(){const id='v'+(++reads);frames.set(id,{});return{metadata:{observation_id:id,tree:reads===1?'Ready':'Failed'}};}};
 runtime.wait=Runtime.prototype.wait.bind(runtime);
 const result=await call(runtime,'computer_run',args([{kind:'click',name:'Start'},{kind:'wait',until:'Ready',abort_on:['Failed']},{kind:'click',name:'Publish'}]));
 assert.equal(input,1);assert.equal(result.aborted,true);assert.equal(result.abort_match,'Failed');assert.equal(result.verification_error.code,'wait_failure_observed');assert.equal(result.batch.skipped,1);assert.equal(result.metadata.observation_id,'v2');assert(!frames.has('v1'));
});

test('wait does not treat a vanished success label as confirmation',async()=>{
 let reads=0;const frames=new Map();
 const runtime={frames,check(){},async observe(){const id='v'+(++reads);frames.set(id,{});return{metadata:{observation_id:id,tree:reads===1?'Ready':'Loading'}};}};
 const result=await Runtime.prototype.wait.call(runtime,{hwnd:7,until:'Ready',timeout_ms:100});
 assert.equal(result.matched,false);assert.equal(result.timed_out,true);assert.equal(result.metadata.tree,'Loading');
});

test('wait returns the last frame when the timeout expires before a later failure observation',async()=>{
 let reads=0;const frames=new Map();
 const runtime={frames,check(){},async observe(){const id='v'+(++reads);frames.set(id,{});if(reads===1)await new Promise(r=>setTimeout(r,120));return{metadata:{observation_id:id,tree:reads===1?'Loading':'Failed'}};}};
 const result=await Runtime.prototype.wait.call(runtime,{hwnd:7,until:'Ready',abort_on:['Failed'],timeout_ms:100});
 assert.equal(result.matched,false);assert.equal(result.timed_out,true);assert.equal(result.metadata.observation_id,'v1');assert.equal(reads,1);assert(!frames.has('v1'));
});
test('text-only timeout returns the last observed frame without a second slow capture',async()=>{
 let reads=0;const frames=new Map();
 const runtime={frames,check(){},async observe(){const id='v'+(++reads);frames.set(id,{});await new Promise(r=>setTimeout(r,120));return{metadata:{observation_id:id,tree:'Loading'}};}};
 const result=await Runtime.prototype.wait.call(runtime,{hwnd:7,until:'Ready',timeout_ms:100,with_image:false});
 assert.equal(result.matched,false);assert.equal(result.timed_out,true);assert.equal(result.metadata.observation_id,'v1');assert.equal(reads,1);assert(frames.has('v1'));assert.equal(result.wait_metrics.observations,1);assert.equal(result.wait_metrics.polling_budget_ms,100);assert(result.wait_metrics.elapsed_ms>=100);
});
test('image wait returns its last frame when the deadline expires without a final capture',async()=>{
 let observations=0;
 const runtime={frames:new Map(),generation:1,driver:{epoch:1},check(){},async observe(){observations++;await new Promise(resolve=>setTimeout(resolve,20));return{metadata:{observation_id:'image-'+observations,tree:'[1] Loading',elements:[]},image:{width:10,height:10,data:'fixture'}};}};
 const result=await Runtime.prototype.wait.call(runtime,{hwnd:7,until:'Ready',timeout_ms:100});
 assert.equal(result.timed_out,true);assert.equal(result.metadata.observation_id,'image-1');assert.equal(observations,1);
});
test('text-only wait reuses its last frame when the budget expires during sleep',async()=>{
 let reads=0;const frames=new Map();
 const runtime={frames,generation:1,driver:{epoch:1},check(){},async observe(){const id='v'+(++reads);frames.set(id,{});return{metadata:{observation_id:id,tree:'Loading'}};}};
 const result=await Runtime.prototype.wait.call(runtime,{hwnd:7,until:'Ready',timeout_ms:100,with_image:false});
 assert.equal(result.timed_out,true);assert.equal(result.metadata.observation_id,'v1');assert.equal(reads,1);assert.equal(result.wait_metrics.observations,1);assert(frames.has('v1'));
});
test('a wait can start its first worker without misclassifying startup as a restart',async()=>{
 const frames=new Map();const runtime={frames,generation:1,driver:{epoch:0},check(){},async observe(){this.driver.epoch=1;frames.set('v',{});return{metadata:{observation_id:'v',tree:'Loading'}};}};
 const result=await Runtime.prototype.wait.call(runtime,{hwnd:7,until:'Ready',timeout_ms:100,with_image:false});
 assert.equal(result.timed_out,true);assert.equal(result.metadata.observation_id,'v');assert(frames.has('v'));
});
test('a worker restart during a wait invalidates the retained frame',async()=>{
 const frames=new Map();const runtime={frames,generation:1,driver:{epoch:1},check(){},async observe(){frames.set('v',{});setTimeout(()=>{this.driver.epoch++;this.frames.clear();},20);return{metadata:{observation_id:'v',tree:'Loading'}};}};
 await assert.rejects(Runtime.prototype.wait.call(runtime,{hwnd:7,until:'Ready',timeout_ms:100,with_image:false}),e=>e.code==='control_changed');assert.equal(frames.size,0);
});
test('a worker restart during success verification discards the new frame',async()=>{
 let reads=0;const frames=new Map();const runtime={frames,generation:1,driver:{epoch:1},check(){},async observe(){const id='v'+(++reads);if(reads===2)this.driver.epoch++;frames.set(id,{});return{metadata:{observation_id:id,tree:'Ready'}};}};
 await assert.rejects(Runtime.prototype.wait.call(runtime,{hwnd:7,until:'Ready',timeout_ms:1000,with_image:false}),e=>e.code==='control_changed');assert.equal(frames.size,0);
});
test('text-only wait discards its retained frame if control changes during sleep',async()=>{
 const frames=new Map();const runtime={frames,generation:1,driver:{epoch:1},check(){},async observe(){frames.set('v',{});setTimeout(()=>{this.generation++;this.frames.clear();},20);return{metadata:{observation_id:'v',tree:'Loading'}};}};
 await assert.rejects(Runtime.prototype.wait.call(runtime,{hwnd:7,until:'Ready',timeout_ms:100,with_image:false}),e=>e.code==='control_changed');assert.equal(frames.size,0);
});
test('text-only wait retains the verification frame after a transient match',async()=>{
 let reads=0;const frames=new Map();const runtime={frames,check(){},async observe(){const id='v'+(++reads);frames.set(id,{});return{metadata:{observation_id:id,tree:reads===1?'Ready':'Loading'}};}};
 const result=await Runtime.prototype.wait.call(runtime,{hwnd:7,until:'Ready',timeout_ms:100,with_image:false});
 assert.equal(result.timed_out,true);assert.equal(result.metadata.observation_id,'v2');assert.equal(reads,2);assert(!frames.has('v1'));assert(frames.has('v2'));
});
test('a text-only timeout in a real batch never sends the next action',async()=>{
 let reads=0,inputs=0;const frames=new Map();
 const runtime={frames,check(){},async action(){inputs++;return {};},async observe(){const id='v'+(++reads);frames.set(id,{});await new Promise(r=>setTimeout(r,120));return{metadata:{observation_id:id,tree:'Loading'}};}};
 runtime.wait=Runtime.prototype.wait.bind(runtime);
 const result=await call(runtime,'computer_run',args([{kind:'wait',until:'Ready',timeout_ms:100,with_image:false},{kind:'click',name:'Publish'}]));
 assert.equal(result.verification_error.code,'wait_condition_timeout');assert.equal(result.batch.skipped,1);assert.equal(result.metadata.observation_id,'v1');assert.equal(reads,1);assert.equal(inputs,0);
});
test('expired text-only verification returns its last frame and stops the batch',async()=>{
 let reads=0,inputs=0;const frames=new Map();
 const runtime={frames,check(){},async action(){inputs++;return {};},async observe(){const id='v'+(++reads);frames.set(id,{});if(reads===2)await new Promise(r=>setTimeout(r,120));return{metadata:{observation_id:id,tree:reads===1?'Ready':'Loading'}};}};
 runtime.wait=Runtime.prototype.wait.bind(runtime);
 const result=await call(runtime,'computer_run',args([{kind:'wait',until:'Ready',timeout_ms:100,with_image:false},{kind:'click',name:'Publish'}]));
 assert.equal(result.verification_error.code,'wait_condition_timeout');assert.equal(result.batch.skipped,1);assert.equal(result.metadata.observation_id,'v2');assert.equal(reads,2);assert.equal(inputs,0);assert(!frames.has('v1'));assert(frames.has('v2'));
});

test('wait_change compares the original view and returns a fresh usable observation',async()=>{
 const app={hwnd:7,pid:9,started:'one',path:'example.exe'};const key=appKey(app);
 const frames=new Map([['initial',{at:Date.now(),hwnd:7,key,workerEpoch:1,viewTree:'"App" hwnd=7\nLoading',viewQuery:'Status',viewMaxNodes:250}]]);let observed;
 const runtime={frames,generation:1,driver:{epoch:1},check(){},async grant(){return app;},async observe(a){observed=a;frames.set('fresh',{key,workerEpoch:1});return{metadata:{observation_id:'fresh',tree:'new-snapshot "App" hwnd=7\nComplete'}};}};
 const result=await Runtime.prototype.waitChange.call(runtime,{hwnd:7,observation_id:'initial',reason:'Inspect view'});
 assert.equal(result.changed,true);assert.equal(result.metadata.observation_id,'fresh');assert(!frames.has('initial'));assert(frames.has('fresh'));
 assert.equal(result.wait_metrics.observations,1);assert.equal(result.wait_metrics.polling_budget_ms,15000);assert(result.wait_metrics.elapsed_ms>=0);
 assert.equal(observed.query,'Status');assert.equal(observed.max_nodes,250);assert.equal(observed.with_image,false);
 const dispatched=await call({async waitChange(a){return {received:a.observation_id};}},'computer_wait_change',{hwnd:7,observation_id:'fresh',reason:'Observe'});
 assert.equal(dispatched.received,'fresh');
 assert.throws(()=>validate('computer_wait_change',{hwnd:7,reason:'No frame'}));
});

test('wait_change refuses incomplete baselines and does not treat truncated observations as change',async()=>{
 const app={hwnd:7,pid:9,started:'one',path:'example.exe'},key=appKey(app);
 const frames=new Map([['initial',{at:Date.now(),hwnd:7,key,workerEpoch:1,viewTree:'old',viewIncomplete:true}]]);
 const runtime={frames,generation:1,driver:{epoch:1},check(){},async grant(){return app;},async observe(a){assert(Number.isFinite(a.native_snapshot_deadline));frames.set('new',{key,workerEpoch:1});return{metadata:{observation_id:'new',tree:'different',tree_incomplete:true}};}};
 await assert.rejects(Runtime.prototype.waitChange.call(runtime,{hwnd:7,observation_id:'initial',reason:'Wait'}),e=>e.code==='wait_observation_incomplete');
 frames.set('initial',{at:Date.now(),hwnd:7,key,workerEpoch:1,viewTree:'old'});
 const result=await Runtime.prototype.waitChange.call(runtime,{hwnd:7,observation_id:'initial',reason:'Wait',timeout_ms:100});
 assert.equal(result.changed,false);assert.equal(result.incomplete,true);assert.equal(result.metadata.observation_id,'new');
});

test('change wait cannot return its retained frame after control changes during sleep',async()=>{
 const app={hwnd:7,pid:9,started:'one',path:'example.exe'},key=appKey(app);
 const frames=new Map([['initial',{at:Date.now(),hwnd:7,key,workerEpoch:1,viewTree:'"App" hwnd=7\nLoading'}]]);
 const runtime={frames,generation:1,driver:{epoch:1},check(){},async grant(){return app;},async observe(){frames.set('v',{key,workerEpoch:1});setTimeout(()=>{this.generation++;this.frames.clear();},20);return{metadata:{observation_id:'v',tree:'s1 "App" hwnd=7\nLoading'}};}};
 await assert.rejects(Runtime.prototype.waitChange.call(runtime,{hwnd:7,observation_id:'initial',reason:'Wait',timeout_ms:100}),e=>e.code==='control_changed');
 assert.equal(frames.size,0);
});

test('change wait returns its last valid frame if the budget expires during sleep',async()=>{
 const app={hwnd:7,pid:9,started:'one',path:'example.exe'},key=appKey(app);let reads=0;
 const frames=new Map([['initial',{at:Date.now(),hwnd:7,key,workerEpoch:1,viewTree:'"App" hwnd=7\nLoading'}]]);
 const runtime={frames,generation:1,driver:{epoch:1},check(){},async grant(){return app;},async observe(){reads++;frames.set('v',{key,workerEpoch:1});return{metadata:{observation_id:'v',tree:'s1 "App" hwnd=7\nLoading'}};}};
 const result=await Runtime.prototype.waitChange.call(runtime,{hwnd:7,observation_id:'initial',reason:'Wait',timeout_ms:100});
 assert.equal(result.timed_out,true);assert.equal(result.metadata.observation_id,'v');assert.equal(reads,1);assert(frames.has('v'));
});

test('an incomplete change wait never dispatches the following batch action',async()=>{
 let inputs=0;const runtime={async waitChange(){return{changed:false,incomplete:true,metadata:{observation_id:'new'}};},async action(){inputs++;return{};}};
 const result=await call(runtime,'computer_run',args([{kind:'wait_change',timeout_ms:1000},{kind:'click',name:'Continue'}]));
 assert.equal(result.verification_error.code,'wait_observation_incomplete');assert.equal(result.batch.skipped,1);assert.equal(inputs,0);
});

test('wait_change refuses stale frames and stops on identity or control changes',async()=>{
 const app={hwnd:7,pid:9,started:'one',path:'example.exe'},key=appKey(app);
 const runtime={frames:new Map(),generation:1,driver:{epoch:1},check(){},async grant(){return app;},async observe(){this.frames.set('fresh',{key:'different',workerEpoch:1});return{metadata:{observation_id:'fresh',tree:'new-snapshot "App" hwnd=7\nChanged'}};}};
 await assert.rejects(Runtime.prototype.waitChange.call(runtime,{hwnd:7,observation_id:'missing'}),e=>e.code==='stale_observation');
 runtime.frames.set('initial',{at:Date.now(),hwnd:7,key,workerEpoch:1,viewTree:'Loading'});
 await assert.rejects(Runtime.prototype.waitChange.call(runtime,{hwnd:7,observation_id:'initial'}),e=>e.code==='identity_changed');assert(!runtime.frames.has('fresh'));
 runtime.frames.set('initial',{at:Date.now(),hwnd:7,key,workerEpoch:1,viewTree:'Loading'});
 runtime.observe=async()=>{runtime.generation++;return{metadata:{observation_id:'new',tree:'Changed'}};};
 await assert.rejects(Runtime.prototype.waitChange.call(runtime,{hwnd:7,observation_id:'initial'}),e=>e.code==='control_changed');
});

test('wait_change times out with a fresh frame without sending input or retaining polling frames',async()=>{
 const app={hwnd:7,pid:9,started:'one',path:'example.exe'},key=appKey(app),frames=new Map();let reads=0;
 frames.set('initial',{at:Date.now(),hwnd:7,key,workerEpoch:1,viewTree:'"App" hwnd=7\nLoading'});
 const runtime={frames,generation:1,driver:{epoch:1},check(){},async grant(){return app;},async observe(){const id='poll'+(++reads);frames.set(id,{key,workerEpoch:1});return{metadata:{observation_id:id,tree:id+' "App" hwnd=7\nLoading'}};}};
 const result=await Runtime.prototype.waitChange.call(runtime,{hwnd:7,observation_id:'initial',timeout_ms:100,reason:'Wait for a view'});
 assert.equal(result.changed,false);assert.equal(result.timed_out,true);assert(frames.has(result.metadata.observation_id));assert.equal(frames.size,1);
});

test('real rendered snapshots do not count new snapshot IDs or element indexes as view changes',async()=>{
 const app={hwnd:7,pid:9,started:'one',path:'example.exe'},frames=new Map();let capture=0,label='Loading';
 const runtime={frames,generation:1,driver:{epoch:1,async call(op){assert.equal(op,'snapshot');const index=++capture;return{result:{snapshot_id:'s'+index,title:'App',hwnd:7,nodes:[{i:index,role:'Text',name:label,depth:0}]}};}},
  guardian:{send(){}},check(){},stamp(){return{};},async grant(){return app;}};
 runtime.observe=Runtime.prototype.observe.bind(runtime);
 const first=await runtime.observe({hwnd:7,with_image:false});
 const unchanged=await Runtime.prototype.waitChange.call(runtime,{hwnd:7,observation_id:first.metadata.observation_id,timeout_ms:100,reason:'Wait'});
 assert.equal(unchanged.changed,false);assert.equal(unchanged.timed_out,true);assert(capture>=2);
 const next=await runtime.observe({hwnd:7,with_image:false});label='Complete';
 const changed=await Runtime.prototype.waitChange.call(runtime,{hwnd:7,observation_id:next.metadata.observation_id,timeout_ms:100,reason:'Wait'});
 assert.equal(changed.changed,true);assert.match(changed.metadata.tree,/Complete/);
});

test('change comparison preserves user text and focus details while ignoring transport indexes',()=>{
 const first='s1 "App" hwnd=7 | focus [2] Edit "Name"\n[2] Edit "Order [12]" = "One"';
 const same='s2 "App" hwnd=7 | focus [99] Edit "Name"\n[99] Edit "Order [12]" = "One"';
 assert.equal(comparableView(first),comparableView(same));
 assert.notEqual(comparableView(first),comparableView(same.replace('Order [12]','Order [13]')));
 assert.notEqual(comparableView(first),comparableView(same.replace('Edit "Name"','Edit "Other"')));
});

test('batched wait_change passes the fresh frame forward and stops after timeout',async()=>{
 const seen=[];let changed=true;
 const runtime={async action(op,a){seen.push({op,frame:a.observation_id});return{metadata:{observation_id:'after-click'}};},
  async waitChange(a){seen.push({op:'wait_change',frame:a.observation_id});return{changed,timed_out:!changed,wait_metrics:{elapsed_ms:20,observations:1,polling_budget_ms:5000},metadata:{observation_id:'after-change'}};}};
 const plan=args([{kind:'click',name:'Start'},{kind:'wait_change',timeout_ms:5000},{kind:'click',name:'Details'}]);
 const result=await call(runtime,'computer_run',plan);
 assert.deepEqual(seen,[{op:'click',frame:'initial'},{op:'wait_change',frame:'after-click'},{op:'click',frame:'after-change'}]);assert.equal(result.batch.completed.length,3);assert.equal(result.batch.completed[1].wait_metrics.observations,1);
 seen.length=0;changed=false;const timeout=await call(runtime,'computer_run',plan);
 assert.equal(seen.length,2);assert.equal(timeout.ok,false);assert.equal(timeout.verification_error.code,'wait_change_timeout');assert.equal(timeout.batch.skipped,1);assert.equal(timeout.metadata.observation_id,'after-change');
 seen.length=0;await assert.rejects(call(runtime,'computer_run',args([{kind:'click',name:'Start'},{kind:'wait',until:'Ready',timeout_ms:20000},{kind:'wait_change',timeout_ms:20000}])),/Combined batch waits/);assert.equal(seen.length,0);
});

test('until_gone returns once observed text disappears, confirmed on a fresh frame',async()=>{
 const trees=['Upscaling 40% Stop upscaling','Upscaling 90% Stop upscaling','Done in 25 s','Done in 25 s'];const frames=new Map();let n=0;
 const caps=[];const runtime={frames,generation:0,check(){},async observe(o){caps.push(o.max_nodes);const id='s'+(++n);frames.set(id,{});return{metadata:{observation_id:id,tree:trees[Math.min(n-1,trees.length-1)]}};}};
 const result=await Runtime.prototype.wait.call(runtime,{hwnd:7,until_gone:'Stop upscaling',timeout_ms:5000,with_image:false});
 assert.equal(result.matched,true);assert.equal(result.metadata.tree,'Done in 25 s');assert.equal(result.wait_metrics.observations,4);
 assert.deepEqual([...new Set(caps)],[500],'absence is judged on a whole view, not an 80-row reply');
});

test('until_gone never treats an incomplete tree as gone',async()=>{
 const frames=new Map();let n=0;
 const runtime={frames,generation:0,check(){},async observe(){const id='s'+(++n);frames.set(id,{});return n===1?{metadata:{observation_id:id,tree:'Stop upscaling'}}:{metadata:{observation_id:id,tree:'',tree_incomplete:true}};}};
 const result=await Runtime.prototype.wait.call(runtime,{hwnd:7,until_gone:'Stop upscaling',timeout_ms:300,with_image:false});
 assert.equal(result.matched,false);assert.equal(result.timed_out,true);
});

test('until_gone refuses text that never appeared and returns the fresh frame',async()=>{
 const frames=new Map();let n=0;
 const runtime={frames,generation:0,check(){},async observe(){const id='s'+(++n);frames.set(id,{});return{metadata:{observation_id:id,tree:'Done in 25 s'}};}};
 const result=await Runtime.prototype.wait.call(runtime,{hwnd:7,until_gone:'Stop upscaling',timeout_ms:700,with_image:false});
 assert.equal(result.ok,false);assert.equal(result.matched,false);assert.equal(result.error.code,'wait_label_not_observed');
 assert.ok(n>=2,'the grace period polls more than once');
 assert.ok(frames.has(result.metadata.observation_id),'the returned frame stays usable');assert.equal(result.metadata.tree,'Done in 25 s');
 const {recoveryAdvice}=await import('../server/recovery.mjs');
 assert.equal(recoveryAdvice(result).next_action,'use_returned_frame');
 assert.equal(recoveryAdvice({error:{code:'wait_label_not_observed'}}).next_action,'observe_again');
});

test('until_gone waits briefly for a label that appears just after the click',async()=>{
 const trees=['Upscale','Upscaling 10% Stop upscaling','Done in 25 s','Done in 25 s'];const frames=new Map();let n=0;
 const runtime={frames,generation:0,check(){},async observe(){const id='s'+(++n);frames.set(id,{});return{metadata:{observation_id:id,tree:trees[Math.min(n-1,trees.length-1)]}};}};
 const result=await Runtime.prototype.wait.call(runtime,{hwnd:7,until_gone:'Stop upscaling',timeout_ms:5000,with_image:false});
 assert.equal(result.matched,true);assert.equal(result.metadata.tree,'Done in 25 s');
});

test('a batched until_gone refusal keeps the frame and does not demand another snapshot',async()=>{
 const runtime={async action(){return{input_completed:true,metadata:{observation_id:'after-click'}};},
  async wait(){return{matched:false,label_not_observed:true,ok:false,error:{code:'wait_label_not_observed',message:'The wait itself sent no input; never replay earlier steps.'},metadata:{observation_id:'fresh',tree:'Done'}};}};
 const plan=args([{kind:'click',name:'Upscale'},{kind:'wait',until_gone:'Stop upscaling',timeout_ms:30000}]);
 const result=await call(runtime,'computer_run',plan);
 assert.equal(result.ok,false);assert.equal(result.error.code,'wait_label_not_observed');assert.equal(result.failed_index,1);
 assert.equal(result.metadata.observation_id,'fresh');assert.equal(result.observe_before_continuing,undefined);
 assert.match(result.error.message,/never replay earlier steps/);
 const {recoveryAdvice}=await import('../server/recovery.mjs');
 assert.equal(recoveryAdvice(result).next_action,'use_returned_frame');
});

test('until_gone on an incomplete tree that never shows the label refuses without a frame',async()=>{
 const frames=new Map();let n=0;
 const runtime={frames,generation:0,check(){},async observe(){const id='s'+(++n);frames.set(id,{});return{metadata:{observation_id:id,tree:'',tree_incomplete:true}};}};
 await assert.rejects(Runtime.prototype.wait.call(runtime,{hwnd:7,until_gone:'Stop upscaling',timeout_ms:600,with_image:false}),error=>error.code==='wait_label_not_observed');
 assert.equal(frames.size,0);
});

test('wait takes exactly one of until or until_gone, and until_gone works as a batch step',async()=>{
 assert.throws(()=>validate('computer_wait',{hwnd:7,reason:'r'}),/exactly one of until or until_gone/);
 assert.throws(()=>validate('computer_wait',{hwnd:7,reason:'r',until:'Done',until_gone:'Stop'}),/exactly one of until or until_gone/);
 validate('computer_wait',{hwnd:7,reason:'r',until_gone:'Stop'});
 const seen=[];
 const runtime={async action(op){seen.push(op);return{metadata:{observation_id:'after-click'}};},async wait(a){seen.push('wait:'+a.until_gone);return{matched:true,metadata:{observation_id:'verified'}};}};
 const plan=parseRunArguments(describe('run').inputSchema,['--hwnd','7','--observation-id','initial','--reason','Start and wait','--step','click','--name','Upscale','--step','wait','--until-gone','Stop upscaling','--timeout-ms','30000'],describe);
 const result=await call(runtime,'computer_run',plan);
 assert.deepEqual(seen,['click','wait:Stop upscaling']);assert.equal(result.batch.completed.length,2);
});
