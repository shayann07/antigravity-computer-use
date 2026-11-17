import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {compact} from '../server/desktop-service.mjs';import {content} from '../server/desktop-tools.mjs';import {testDirectory} from './paths.mjs';
const jpeg=Buffer.from([0xff,0xd8,0xff,0xd9]).toString('base64');
const shot=(w)=>({data:jpeg,width:w,height:100,source:[0,0,w*2,200],scale:0.5,client:[0,10,w,90],mime:'image/jpeg'});

test('step images from images:"all" are saved as files with scale, client and retention (#52, #53)',()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'step-images-'));
 try{
  const out=compact({metadata:{observation_id:'obs1'},image:shot(300),batch:{completed:[{index:0,kind:'click',ok:true,image:shot(100)},{index:1,kind:'key',ok:true,image:shot(200)}],skipped:0}},dir);
  assert.equal(out.image.scale,0.5);assert.deepEqual(out.image.client,[0,10,300,90]);assert.match(out.image.kept,/newest 50 images/);
  assert.deepEqual(out.batch.completed.map(s=>path.basename(s.image.path)),['obs1-step0.jpg','obs1-step1.jpg']);
  for(const s of out.batch.completed){assert.equal(s.image.data,undefined);assert(fs.existsSync(s.image.path));}
  const failed=compact({ok:false,completed:[{index:0,kind:'click',ok:true,image:shot(100)}],failed_index:1},dir);
  assert(fs.existsSync(failed.completed[0].image.path),'a failed batch keeps the pictures of the steps that ran');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('MCP replies send each step image as its own block before the final image',()=>{
 const blocks=content({image:shot(300),batch:{completed:[{index:0,ok:true,image:shot(100)}]}});
 assert.equal(blocks.filter(b=>b.type==='image').length,2);
 const text=JSON.parse(blocks[0].text);assert.equal(text.batch.completed[0].image.data,undefined);assert.equal(text.batch.completed[0].image.width,100);
 assert.equal(text.image.scale,0.5);
});

test('burst captures spaced frames of an approved window without input or a frame (#56)',async()=>{
 const {Runtime}=await import('../server/runtime.mjs');const {EventEmitter}=await import('node:events');
 const guardian=new EventEmitter();guardian.messages=[];guardian.send=m=>{guardian.messages.push(m);return true;};guardian.request=async()=>({ok:true});
 const calls=[];const driver={epoch:1,info:{pid:9},async call(op,a){calls.push(op);return {result:{data:jpeg,width:400,height:300,source:[0,0,800,600],scale:0.5,capture:'screen'}};}};
 const r=new Runtime({guardian,driver,sessions:{register(){},close(){},async withInput(_o,_t,run){return run();}}});
 r.grant=async()=>({pid:1,started:1,path:'C:/x/app.exe',rect:[0,0,800,600]});r.check=()=>{};r.stamp=()=>({});
 const out=await r.burst({hwnd:5,frames:3,interval_ms:50,reason:'check a fade'});
 assert.equal(out.frames,3);assert.deepEqual(calls,['screenshot','screenshot','screenshot']);
 assert(out.images[2].at_ms>=90,'frames are spaced by the interval');
 assert.deepEqual(guardian.messages.filter(m=>m.op==='capture_end').length,1);
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'burst-'));
 try{const saved=compact(out,dir);assert.equal(saved.images.length,3);for(const i of saved.images){assert(fs.existsSync(i.path));assert.equal(i.data,undefined);}}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
 assert.equal(content(out).filter(b=>b.type==='image').length,3);
});

test('a cropped capture still passes the moved-window check: it compares the full window rect',async()=>{
 const src=fs.readFileSync(new URL('../server/runtime.mjs',import.meta.url),'utf8');
 assert.match(src,/JSON\.stringify\(f\.image\.window\|\|f\.image\.source\)!==JSON\.stringify\(w\.rect\)/);
 const cs=fs.readFileSync(new URL('../server/native/AxonHost.cs',import.meta.url),'utf8');
 assert.match(cs,/res\["window"\] = new int\[\] \{ windowRect\.Left, windowRect\.Top/);
});

test('click accepts park_cursor and the native click honours it in real-cursor mode (#49)',async()=>{
 const {validate}=await import('../server/desktop-tools.mjs');
 validate('computer_click',{hwnd:1,observation_id:'f',reason:'close hover',name:'Models',park_cursor:true});
 const cs=fs.readFileSync(new URL('../server/native/AxonHost.cs',import.meta.url),'utf8');
 assert.match(cs,/AGCU_REAL_CURSOR"\) != "1" \|\| Bool\(Get\(a, "park_cursor"\), false\)/);
});
