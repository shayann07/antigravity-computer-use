import test from 'node:test';
import assert from 'node:assert/strict';
import {Runtime,appKey} from '../server/runtime.mjs';
import {validate,call} from '../server/desktop-tools.mjs';
import {parseArguments,parseRunArguments} from '../scripts/arguments.mjs';
import {describeCommand} from '../scripts/desktop.mjs';

function fixture({image=true}={}){
 const sent=[];
 const app={hwnd:1,pid:20,started:'one',path:'fixture.exe',rect:[100,50,400,200]};
 const runtime={generation:1,deadline:Date.now()+10000,remaining:10,state:'active',token:'private-session',frames:new Map(),
  async grant(){return app;},async app(){return app;},check(){},stamp(){return {};},
  guardian:{send(){},async request(){return {allowed:true};}},
  sessions:{async withInput(_op,_target,execute){return execute();}},
  driver:{epoch:1,info:{},async call(op,payload){sent.push({op,payload});if(op==='authorize')return {result:{sensitive:false}};return {result:{done:true}};}},
  async observe(){return {metadata:{observation_id:'after'}};}};
 runtime.frames.set('fresh',{at:Date.now(),hwnd:1,key:appKey(app),snapshot:'s1',workerEpoch:1,elements:[{i:3,name:'Save',role:'Button'}],...(image?{image:{source:[100,50,400,200],width:200,height:100}}:{})});
 const act=(op,args)=>Runtime.prototype.action.call(runtime,op,{hwnd:1,observation_id:'fresh',risk:'routine',reason:'test',...args});
 return {runtime,sent,act,inputs:()=>sent.filter(s=>s.op!=='authorize')};
}

test('a refusal that sent no input leaves the frame usable (#49)',async()=>{
 const f=fixture();
 await assert.rejects(f.act('click',{name:'Missing',role:'Button'}),e=>e.code==='target_not_observed');
 assert.ok(f.runtime.frames.has('fresh'),'frame survives a refused named click');
 assert.equal(f.inputs().length,0);
 const ok=await f.act('click',{name:'Save',role:'Button'});
 assert.equal(ok.input_completed,true);
 assert.equal(f.runtime.frames.has('fresh'),false,'a sent action still consumes the frame');
});

test('no_image and bad points keep the frame and say what to do (#48, #53)',async()=>{
 const f=fixture({image:false});
 await assert.rejects(f.act('move',{x:5,y:5}),e=>e.code==='no_image'&&/--image/.test(e.message)&&/No input was sent/.test(e.message));
 assert.ok(f.runtime.frames.has('fresh'));
 const g=fixture();
 await assert.rejects(g.act('move',{x:9999,y:5}),e=>e.code==='bad_point');
 assert.ok(g.runtime.frames.has('fresh'));
});

test('refusals that may follow a changed window still consume the frame',async()=>{
 const f=fixture();
 f.runtime.frames.get('fresh').image.source=[0,0,1,1];
 await assert.rejects(f.act('click',{x:5,y:5}),e=>e.code==='window_moved');
 assert.equal(f.runtime.frames.has('fresh'),false);
});

test('range errors name the allowed range (#48)',()=>{
 assert.throws(()=>validate('computer_snapshot',{hwnd:1,settle_ms:2200}),/allowed range \(0 to 2000\)/);
});

test('--text is accepted for key as --keys, and a repeated array flag is explained (#46, #48)',()=>{
 const key=describeCommand('key').inputSchema;
 const args=parseArguments(key,['--hwnd','1','--observation-id','F','--text','F5','--risk','routine','--reason','r']);
 assert.equal(args.keys,'F5');assert.equal(Object.hasOwn(args,'text'),false);
 validate('computer_key',args);
 const run=parseRunArguments(describeCommand('run').inputSchema,['--hwnd','1','--observation-id','F','--reason','r','--step','key','--text','F5','--risk','routine','--step','wait_change','--timeout-ms','500'],describeCommand);
 assert.equal(run.steps[0].keys,'F5');
 const drag=describeCommand('drag').inputSchema;
 assert.throws(()=>parseArguments(drag,['--from','1','--from','2']),/Write an array once.*\[X,Y\]/);
 const parsed=parseArguments(drag,['--from','700,260','--to','[820,300]']);
 assert.deepEqual([parsed.from,parsed.to],[[700,260],[820,300]]);
});

test('a key step before a pixel click is planned with a screenshot, so the batch is accepted whole (#53)',async()=>{
 const seen=[];
 const r={async action(op,args){seen.push({op,args});return {ok:true,metadata:{observation_id:'n'+seen.length}};}};
 await call(r,'computer_run',{hwnd:1,observation_id:'F',reason:'r',steps:[{kind:'click',x:1,y:2,risk:'routine'},{kind:'key',keys:'F5',risk:'routine'},{kind:'click',x:3,y:4,risk:'routine'}]});
 assert.deepEqual(seen.map(s=>s.op),['click','key','click']);
 assert.equal(seen[0].args.observe.with_image,false,'a click followed by a non-pixel step needs no image');
 assert.equal(seen[1].args.observe.with_image,true,'the key step captures what the next pixel click needs');
 // A pixel step that follows a wait is refused before any input is sent.
 const q={async action(){throw new Error('input sent');},async wait(){throw new Error('input sent');}};
 await assert.rejects(call(q,'computer_run',{hwnd:1,observation_id:'F',reason:'r',steps:[{kind:'click',x:1,y:2,risk:'routine'},{kind:'wait',until:'Done'},{kind:'click',x:3,y:4,risk:'routine'}]}),/No input was sent/);
});
