import test from 'node:test';import assert from 'node:assert/strict';
import {Runtime,observedIndex,appKey} from '../server/runtime.mjs';import {validate,TOOLS,call} from '../server/desktop-tools.mjs';import {parseArguments,parseRunArguments} from '../scripts/arguments.mjs';
test('exact selectors resolve one real observed node and refuse missing or ambiguous targets',()=>{
 const elements=[{i:7,name:'JPEG',role:'Button',aid:'format-jpeg'},{i:8,name:'JPEG',role:'Text'},{i:9,name:'اردو 😀',role:'Edit',aid:'sample'}];
 assert.equal(observedIndex(elements,{name:'JPEG',role:'Button'}),7);assert.equal(observedIndex(elements,{automation_id:'sample'}),9);
 assert.throws(()=>observedIndex(elements,{name:'JPEG'}),e=>e.code==='ambiguous_observed_target');
 assert.throws(()=>observedIndex(elements,{name:'jpeg',role:'Button'}),e=>e.code==='target_not_observed');
 assert.throws(()=>observedIndex(elements,{}),e=>e.code==='bad_selector');
 assert.throws(()=>observedIndex(elements,{name:' '}),e=>e.code==='bad_selector');
 assert.throws(()=>observedIndex([{name:'JPEG',role:'Button'}],{name:'JPEG'}),e=>e.code==='bad_observed_target');
 assert.throws(()=>observedIndex([{i:1,id:'not-an-automation-id'}],{automation_id:'not-an-automation-id'}),e=>e.code==='target_not_observed');
});
test('named flags and named batches preserve targeting exclusivity without JSON plan files',()=>{
 const describe=name=>({inputSchema:TOOLS.find(t=>t.name==='computer_'+name).inputSchema});
 const click=parseArguments(describe('click').inputSchema,['--hwnd','1','--observation-id','f','--name','JPEG','--role','Button','--reason','Select observed format']);validate('computer_click',click);assert.equal(click.name,'JPEG');
 const plan=parseRunArguments(describe('run').inputSchema,['--hwnd','1','--observation-id','f','--reason','Predictable controls','--step','click','--name','Settings','--role','Button','--max-nodes','500','--step','click','--name','JPEG','--role','Button'],describe);validate('computer_run',plan);assert.equal(plan.steps[1].name,'JPEG');
 for(const bad of [{...click,index:7},{...click,x:1,y:2},{...click,name:' '},{...click,confirmed:true}])assert.throws(()=>validate('computer_click',bad));
 assert.throws(()=>validate('computer_set_value',{hwnd:1,observation_id:'f',text:'x',reason:'No target'}));
 assert.doesNotThrow(()=>validate('computer_set_value',{hwnd:1,observation_id:'f',automation_id:'name',text:'x',reason:'Observed field'}));
});
test('runtime translates a name to the same observation-scoped native index and snapshot',async()=>{
 const w={hwnd:1,pid:5,started:'one',path:'app.exe',rect:[0,0,100,100]},sent=[];
 const r={frames:new Map([['f',{at:Date.now(),hwnd:1,key:appKey(w),snapshot:'native-frame',workerEpoch:1,elements:[{i:7,name:'JPEG',role:'Button'}]}]]),deadline:Date.now()+10000,remaining:10,generation:1,async grant(){return w;},check(){},stamp(){return{};},async app(){return w;},guardian:{send(){}},driver:{epoch:1,info:{pid:10},async start(){},async call(op,args){sent.push({op,args});return{result:op==='authorize'?{sensitive:false}:{method:'invoke_pattern'}};}},sessions:{async withInput(_op,_meta,fn){return fn();}},async observe(){return{metadata:{observation_id:'fresh'}};}};
 await Runtime.prototype.action.call(r,'click',{hwnd:1,observation_id:'f',name:'JPEG',role:'Button',risk:'routine',reason:'Observed choice'});
 const native=sent.find(x=>x.op==='click').args;assert.equal(native.index,7);assert.equal(native.snapshot_id,'native-frame');assert.equal(native.physical,true);assert(!Object.hasOwn(native,'name'));assert(!Object.hasOwn(native,'role'));assert(!r.frames.has('f'));
 await assert.rejects(Runtime.prototype.action.call(r,'click',{hwnd:1,observation_id:'f',name:'JPEG',reason:'Consumed'}),e=>e.code==='stale_observation');
 r.frames.set('semantic',{at:Date.now(),hwnd:1,key:appKey(w),snapshot:'native-frame-2',workerEpoch:1,elements:[{i:7,name:'JPEG',role:'Button'}]});
 await Runtime.prototype.action.call(r,'click',{hwnd:1,observation_id:'semantic',name:'JPEG',physical:false,reason:'Explicit semantic action'});
 assert.equal(sent.filter(x=>x.op==='click').at(-1).args.physical,false);
 r.frames.set('pixel',{at:Date.now(),hwnd:1,key:appKey(w),snapshot:'native-frame-3',workerEpoch:1,elements:[],image:{width:100,height:100,source:[0,0,100,100]}});
 await Runtime.prototype.action.call(r,'click',{hwnd:1,observation_id:'pixel',x:12,y:30,physical:false,reason:'Observed image target'});
 const pixel=sent.filter(x=>x.op==='click').at(-1).args;assert.equal(pixel.physical,true);assert.deepEqual(pixel.point,[12,30]);
});
test('later named batch steps resolve against fresh internal observations',async()=>{
 const seen=[];const r={async action(op,args){seen.push({op,args});return{metadata:{observation_id:'frame'+seen.length}};}};
 const result=await call(r,'computer_run',{hwnd:1,observation_id:'initial',reason:'Bounded semantic plan',steps:[{kind:'click',name:'Settings',role:'Button'},{kind:'click',name:'JPEG',role:'Button'}]});
 assert.equal(seen[0].args.observation_id,'initial');assert.equal(seen[1].args.observation_id,'frame1');assert.equal(result.batch.completed.length,2);
});

test('unobserved and ambiguous names refuse before native authorization or input',async()=>{
 const w={hwnd:1,pid:5,started:'one',path:'app.exe'};let native=0;
 const r={frames:new Map(),deadline:Date.now()+10000,remaining:10,generation:1,async grant(){return w;},check(){},stamp(){return{};},driver:{epoch:1,async call(){native++;}}};
 for(const elements of [[{i:1,name:'Other'}],[{i:1,name:'JPEG'},{i:2,name:'JPEG'}]]){
  r.frames.set('f',{at:Date.now(),hwnd:1,key:appKey(w),snapshot:'s',workerEpoch:1,elements});
  await assert.rejects(Runtime.prototype.action.call(r,'click',{hwnd:1,observation_id:'f',name:'JPEG',reason:'Must not guess'}),e=>['target_not_observed','ambiguous_observed_target'].includes(e.code));assert(r.frames.has('f'),'a refusal that sent no input keeps the frame (#49)');r.frames.delete('f');
 }
 assert.equal(native,0);assert.equal(r.remaining,10);
});

test('a real runtime batch resolves the next named control from its newly observed layout',async()=>{
 const w={hwnd:1,pid:5,started:'one',path:'app.exe'},sent=[];
 const frame=(snapshot,elements)=>({at:Date.now(),hwnd:1,key:appKey(w),snapshot,workerEpoch:1,elements});
 const r={frames:new Map([['initial',frame('s1',[{i:7,name:'Settings',role:'Button'}])]]),deadline:Date.now()+10000,remaining:10,generation:1,async grant(){return w;},check(){},stamp(){return{};},async app(){return w;},guardian:{send(){}},driver:{epoch:1,info:{pid:10},async start(){},async call(op,args){if(op==='authorize')return{result:{sensitive:false}};sent.push(args);return{result:{method:'invoke_pattern'}};}},sessions:{async withInput(_op,_meta,fn){return fn();}},async observe(){const id='fresh'+sent.length;r.frames.set(id,frame('s'+(sent.length+1),[{i:42,name:'JPEG',role:'Button'}]));return{metadata:{observation_id:id}};}};
 r.action=Runtime.prototype.action.bind(r);
 const result=await call(r,'computer_run',{hwnd:1,observation_id:'initial',reason:'Open then select',steps:[{kind:'click',name:'Settings',role:'Button',risk:'routine'},{kind:'click',name:'JPEG',role:'Button',risk:'routine'}]});
 assert.deepEqual(sent.map(x=>[x.index,x.snapshot_id,x.physical]),[[7,'s1',true],[42,'s2',true]]);assert.equal(result.batch.completed.length,2);
});

test('selector observation cache is bounded and drops expired or restarted-worker frames',async()=>{
 const frames=new Map([['expired',{at:0,workerEpoch:2}],['old-worker',{at:Date.now(),workerEpoch:1}]]);
 const r={frames,generation:1,async grant(){return{pid:1,started:'one',path:'app.exe'};},check(){},guardian:{send(){}},stamp(){return{};},driver:{epoch:2,async call(){return{result:{snapshot_id:'s',nodes:[{i:7,name:'Settings',role:'Button'}]}};}}};
 for(let i=0;i<20;i++)await Runtime.prototype.observe.call(r,{hwnd:1,with_image:false});
 assert.equal(frames.size,16);assert(!frames.has('expired'));assert(!frames.has('old-worker'));assert([...frames.values()].every(f=>f.elements[0].i===7&&f.workerEpoch===2&&Number.isFinite(f.atMono)));
});
