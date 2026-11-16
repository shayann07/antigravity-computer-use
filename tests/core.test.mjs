import test from 'node:test';
import assert from 'node:assert/strict';
import {validate,TOOLS,content,call} from '../server/mcp.mjs';
import {appKey,imagePoint,requireObservation} from '../server/runtime.mjs';
import {targetImageSize} from '../server/upstream-utils.mjs';
test('MCP contains discovery, native actions, lifecycle and clip tools',()=>{
 for(const name of ['apps','snapshot','move','click','type','key','drag','scroll','grant','end','stop','clipboard','launch'])assert(TOOLS.some(t=>t.name==='computer_'+name));
 for(const name of ['pause','resume'])assert(!TOOLS.some(t=>t.name==='computer_'+name),'there is no Pause or Resume');
});
for(const extra of ['confirmed','preapprove','__permit','__session','mode','takeover_mode'])test('model cannot provide '+extra,()=>assert.throws(()=>validate('computer_click',{hwnd:1,observation_id:'x',reason:'test',[extra]:true})));
test('booleans/fractions cannot act as handles',()=>{for(const hwnd of [true,1.5])assert.throws(()=>validate('computer_snapshot',{hwnd}));});

test('native typing budget rejects oversized text before dispatch while explicit clipboard remains available',async()=>{
 const args={hwnd:1,observation_id:'fresh',reason:'Bounded typing'};
 validate('computer_type',{...args,text:'a'.repeat(400)});
 assert.throws(()=>validate('computer_type',{...args,text:'a'.repeat(401)}),/length/);
 validate('computer_clipboard',{text:'a'.repeat(1209),reason:'Explicit bulk clipboard'});
 validate('computer_paste',{...args,text:'a'.repeat(1209)});
 assert.throws(()=>validate('computer_paste',{...args,text:'a'.repeat(20001)}),/length/);
 let called=false;await assert.rejects(call({action(){called=true;}},'computer_type',{...args,text:'a'.repeat(401)}));assert.equal(called,false);
});

test('nested observation options and coordinate arrays are validated',()=>{
 const common={hwnd:1,observation_id:'fresh',reason:'Inspect app'};
 for(const observe of [null,[],false,{with_image:'false'},{max_nodes:-1},{max_nodes:501},{__permit:'forged'}])
  assert.throws(()=>validate('computer_click',{...common,observe}));
 for(const from of [['1',2],[NaN,2],[true,2]])assert.throws(()=>validate('computer_drag',{...common,from,to:[3,4]}));
 validate('computer_click',{...common,index:2,observe:{with_image:false,query:'Export',max_nodes:500}});
 validate('computer_snapshot',{hwnd:1,settle_ms:600});
 for(const settle_ms of [-1,2001,1.5,'600'])assert.throws(()=>validate('computer_snapshot',{hwnd:1,settle_ms}));
});

test('set_value requires an explicit indexed text or numeric value, including zero',async()=>{
 const common={hwnd:1,observation_id:'fresh',index:3,reason:'Set enhancement'};
 assert.throws(()=>validate('computer_set_value',common));
 assert.throws(()=>validate('computer_set_value',{...common,text:'',value:0}));
 let received;
 await call({async action(op,args){received={op,args};return {}; }},'computer_set_value',{...common,value:0});
 assert.equal(received.op,'set_value');assert.equal(received.args.value,0);assert(!('text' in received.args));
 validate('computer_set_value',{...common,text:''});
});
test('unbounded clicks, wheel deltas and drag interpolation are rejected',()=>{
 const common={hwnd:1,observation_id:'x',reason:'fixture'};
 for(const clicks of [0,4,1000000])assert.throws(()=>validate('computer_click',{...common,clicks}));
 assert.throws(()=>validate('computer_scroll',{...common,amount:1000000}));
 assert.throws(()=>validate('computer_drag',{...common,from:[0,0],to:[1,1],steps:121}));
 validate('computer_click',{...common,index:2,clicks:2});
});
test('MCP returns native image block',()=>{const c=content({metadata:{hwnd:1},image:{data:'xyz',mime:'image/jpeg',width:1}});assert.equal(c[1].type,'image');assert(!c[0].text.includes('xyz'));});
test('transport keeps image and indexed tree without duplicating controls or image metadata',()=>{
 const c=content({metadata:{observation_id:'fresh',tree:'[3] Edit Name',elements:[{i:3,text:'duplicate'}],image:{width:100}},image:{data:'pixels',mime:'image/jpeg',width:100,height:50,source:[0,0,100,50]}});
 const v=JSON.parse(c[0].text);assert.equal(v.metadata.observation_id,'fresh');assert.match(v.metadata.tree,/\[3\]/);assert(!('elements' in v.metadata));assert(!('image' in v.metadata));assert.equal(c[1].data,'pixels');assert.deepEqual(v.image.source,[0,0,100,50]);
});
test('process restart and same-name apps have different identity',()=>{
 assert.notEqual(appKey({pid:1,started:'10',path:'x.exe'}),appKey({pid:1,started:'11',path:'x.exe'}));
 assert.notEqual(appKey({pid:1,started:'10',path:'x.exe'}),appKey({pid:2,started:'10',path:'x.exe'}));
});
test('observation is consumed exactly once',()=>{
 const map=new Map([['x',{at:100,hwnd:2}]]);assert(requireObservation(map,'x',2,200));assert.throws(()=>requireObservation(map,'x',2,201));
});
test('stale and wrong-window observations refuse and consume',()=>{
 for(const [hwnd,now] of [[3,100],[2,90200]]){const m=new Map([['x',{at:100,hwnd:2}]]);assert.throws(()=>requireObservation(m,'x',hwnd,now));assert(!m.size);}
});
test('image coordinate mapping includes negative monitor origin',()=>{
 const image={width:1000,height:500,source:[-2000,-100,2000,1000]};assert.deepEqual(imagePoint(image,500,250),[-1000,400]);
 for(const xy of [[-1,0],[1000,0],[0,500],[1.2,3]])assert.throws(()=>imagePoint(image,...xy));
});
for(const [w,h] of [[3840,2160],[2160,3840],[800,600],[100,4000]])test('image sizing '+w+'x'+h,()=>{
 const [x,y]=targetImageSize(w,h);assert(x<=1400&&y<=1400&&x<=w&&y<=h);assert(Math.abs(x/y-w/h)<.02);
});
test('batch stops on failure and never runs later actions',async()=>{
 let n=0;const r={action:async()=>{if(++n===2)throw new Error('denied');return {metadata:{observation_id:'next'}};}};
 const result=await call(r,'computer_run',{hwnd:1,observation_id:'start',reason:'test',steps:[{kind:'type',text:'one'},{kind:'key',keys:'enter'},{kind:'type',text:'must not run'}]});
 assert.equal(n,2);assert.equal(result.completed.length,1);assert.equal(result.skipped,1);
 assert.equal(result.ok,false);assert.equal(result.error.message,'denied');
});
test('a returned failed step stops the batch and preserves possible input evidence',async()=>{
 let calls=0;const r={async action(){calls++;return {ok:false,input_completed:true,error:{code:'input_outcome_unknown'},delivery_unknown:true};}};
 const result=await call(r,'computer_run',{hwnd:1,observation_id:'fresh',reason:'test',steps:[{kind:'key',keys:'tab'},{kind:'key',keys:'enter'}]});
 assert.equal(calls,1);assert.equal(result.ok,false);assert.equal(result.input_completed,true);assert.equal(result.delivery_unknown,true);assert.equal(result.failed_index,0);assert.equal(result.skipped,1);assert.deepEqual(result.completed,[]);
});
test('a malformed step result stops the batch with unknown delivery',async()=>{
 let calls=0;const r={async action(){calls++;return null;}};
 const result=await call(r,'computer_run',{hwnd:1,observation_id:'fresh',reason:'test',steps:[{kind:'key',keys:'tab'},{kind:'key',keys:'enter'}]});
 assert.equal(calls,1);assert.equal(result.delivery_unknown,true);assert.equal(result.error.code,'input_outcome_unknown');assert.equal(result.skipped,1);
});

test('batch preflight rejects invalid later steps and frame overrides before any input',async()=>{
 let delivered=0;const r={async action(){delivered++;}};
 for(const bad of [{kind:'launch',app:'x'},{kind:'clipboard',text:'window-free'},{kind:'click'},{kind:'click',index:2,x:3,y:4},{kind:'click',x:3},{kind:'type',text:'x'.repeat(401)},{kind:'key',keys:'enter',hwnd:2},{kind:'key',keys:'enter',observation_id:'other'}]){
  await assert.rejects(call(r,'computer_run',{hwnd:1,observation_id:'fresh',reason:'test',steps:[{kind:'key',keys:'tab'},bad]}));
 }
 assert.equal(delivered,0);
});

test('a focus batch respects its real schema and binds the following action to its fresh observation',async()=>{
 const seen=[];const r={async action(op,args){seen.push({op,args});return {metadata:{observation_id:'frame'+seen.length}};}};
 const result=await call(r,'computer_run',{hwnd:1,observation_id:'initial',reason:'Focus then select',steps:[{kind:'focus',risk:'routine'},{kind:'click',index:7,risk:'routine'}]});
 assert.equal(seen.length,2);assert.equal(seen[0].op,'focus');assert(!Object.hasOwn(seen[0].args,'observation_id'));assert(!Object.hasOwn(seen[0].args,'observe'));assert.equal(seen[1].args.observation_id,'frame1');assert.equal(result.batch.completed.length,2);
});

test('batch returns final image by default and uses fresh internal observations without intermediate captures',async()=>{
 const seen=[];const r={async action(_op,args){seen.push(args);return {metadata:{observation_id:'frame'+seen.length}};}};
 const result=await call(r,'computer_run',{hwnd:1,observation_id:'initial',reason:'test',steps:[{kind:'key',keys:'tab'},{kind:'key',keys:'enter'}]});
 assert.equal(seen[0].observe.with_image,false);assert.equal(seen[1].observe.with_image,true);
 assert.equal(seen[0].observation_id,'initial');assert.equal(seen[1].observation_id,'frame1');assert.equal(result.batch.completed.length,2);
});
test('save batch passes the post-click frame to the owner dialog and stops on path mismatch',async()=>{
 const seen=[];const r={async action(op,args){seen.push({op,args});if(op==='file_dialog')throw Object.assign(Error('Filename did not match'),{code:'file_dialog_path_mismatch'});return {metadata:{observation_id:'after-save-click'}};}};
 const result=await call(r,'computer_run',{hwnd:1,observation_id:'before',reason:'Save document',steps:[{kind:'click',index:8,risk:'routine'},{kind:'file_dialog',path:'D:/result.txt',action:'save',entry_method:'clipboard'},{kind:'key',keys:'enter'}]});
 assert.equal(seen.length,2);assert.equal(seen[0].args.observation_id,'before');assert.equal(seen[1].op,'file_dialog');assert.equal(seen[1].args.hwnd,1);assert.equal(seen[1].args.observation_id,'after-save-click');
 assert.equal(result.ok,false);assert.equal(result.error.code,'file_dialog_path_mismatch');assert.equal(result.completed.length,1);assert.equal(result.skipped,1);
});

test('post-input verification failure stops the batch with delivery evidence intact',async()=>{
 let delivered=0;const r={async action(){delivered++;return {input_completed:true,verification_error:{code:'capture_failed'}};}};
 const result=await call(r,'computer_run',{hwnd:1,observation_id:'fresh',reason:'test',steps:[{kind:'key',keys:'tab'},{kind:'key',keys:'enter'}]});
 assert.equal(delivered,1);assert.equal(result.input_completed,true);assert.equal(result.batch.phase,'verification');assert.equal(result.batch.skipped,1);
});

test('uncertain provider delivery stops a batch and preserves recovery guidance without replay',async()=>{
 let calls=0;const r={async action(){calls++;throw Object.assign(Error('Provider failed after dispatch'),{code:'input_outcome_unknown',hint:'Observe actual result; do not retry'});}};
 const result=await call(r,'computer_run',{hwnd:1,observation_id:'fresh',reason:'test',steps:[{kind:'key',keys:'enter'},{kind:'key',keys:'enter'}]});
 assert.equal(calls,1);assert.equal(result.ok,false);assert.equal(result.delivery_unknown,true);assert.equal(result.error.code,'input_outcome_unknown');assert.match(result.error.hint,/do not retry/);assert.equal(result.skipped,1);
});
