import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath} from 'node:url';import {BUILD_ID,VERSION} from '../server/version.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {TaskOwnership} from '../server/task-ownership.mjs';import {serveDesktop} from '../server/desktop-service.mjs';import {request} from '../scripts/desktop.mjs';import {testDirectory} from './paths.mjs';
test('passive End is idempotent but cannot revoke an open task or grant',()=>{
 const owner=new TaskOwnership();owner.authorize('computer_end',undefined,{state:'idle',task_open:false,approved_apps:[]});
 owner.authorize('computer_end',undefined,{state:'stopped',task_open:false,approved_apps:[]});
 for(const state of [{state:'active',task_open:false},{state:'idle',task_open:true},{state:'idle',task_open:false,approved_apps:['app']}])assert.throws(()=>owner.authorize('computer_end',undefined,state),{code:'task_required'});
 owner.claim({state:'idle',task_open:false});assert.throws(()=>owner.authorize('computer_end',undefined,{state:'idle',task_open:false}),{code:'task_owned'});
});
test('unused claims expire; used claims never expire or transfer by age',()=>{
 let now=0;const owner=new TaskOwnership({now:()=>now}),idle={state:'idle',task_open:false};const old=owner.claim(idle);now=30001;const token=owner.claim(idle);assert.notEqual(token,old);assert.throws(()=>owner.authorize('computer_end',old,idle),{code:'task_owned'});owner.authorize('computer_ready',token,idle);now+=86400000;assert.throws(()=>owner.claim(idle),{code:'task_owned'});owner.authorize('computer_stop',null,idle);owner.ended();assert(owner.claim(idle));
});
test('two authenticated IPC clients cannot share grants or end another task',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'task-owner-'));let open=false,ends=0,stops=0;
 const runtime={status:()=>({state:'idle',task_open:open,build_id:BUILD_ID,build_version:VERSION,permission_mode:'standalone'}),async ready(){open=true;return {ready:true};},async finish(){ends++;open=false;return {ended:true};},async stop(){stops++;return {stopped:true};},async close(){}};
 const service=await serveDesktop({directory:dir,runtime,requireTaskOwnership:true});
 try{
  const saved=JSON.parse(fs.readFileSync(service.file)),a={...saved},b={...saved};
  const ready=await request(a,'ready');assert.equal(ready.ready,true);assert.match(ready.task_token,/^[a-f0-9]{64}$/);
  for(const command of ['ready','end','snapshot','shutdown']){const result=await request(b,command);assert.equal(result.ok,false,command);assert.equal(result.error.code,'task_owned');}
  assert.equal(ends,0);assert.equal(open,true);assert.equal((await request(b,'stop')).stopped,true);assert.equal(stops,1);
  assert.equal((await request(a,'end')).ended,true);assert.equal(ends,1);
  const next=await request(b,'ready');assert.equal(next.ready,true);assert.notEqual(next.task_token,ready.task_token);
  assert.equal((await request(a,'end')).error.code,'task_owned');await request(b,'end');
  const env={...process.env,AGCU_DATA_DIR:dir,AGCU_PERMISSION_MODE:'standalone'};delete env.CU_PLUGIN_DATA;delete env.CLAUDE_PLUGIN_DATA;
  const cli=async args=>JSON.parse((await promisify(execFile)(process.execPath,[fileURLToPath(new URL('../scripts/desktop.mjs',import.meta.url)),...args],{env,windowsHide:true,timeout:10000})).stdout);
  const cliReady=await cli(['ready']);assert.match(cliReady.task_token,/^[a-f0-9]{64}$/);assert.equal(cliReady.ready,true);
  assert(cliReady.task_command_prefix.endsWith('--task '+cliReady.task_token));
  assert.equal((await cli(['--task',cliReady.task_token,'end'])).ended,true);

  assert(!fs.readFileSync(path.join(dir,'desktop-receipts.jsonl'),'utf8').includes(ready.task_token),'task capability must not be logged');
 }finally{await service.shutdown();fs.rmSync(dir,{recursive:true,force:true});}
});
import {EventEmitter} from 'node:events';
test('trusted local End releases an abandoned capability only after cleanup, keeping Stop',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'local-end-owner-'));let open=false,state='idle';const guardian=new EventEmitter();
 const runtime={guardian,status:()=>({state,task_open:open}),async ready(){open=true;return {ready:state!=='stopped',state};},async stop(){state='stopped';return {stopped:true};},async finish(){open=false;return {ended:true,state};},async close(){}};
 const service=await serveDesktop({directory:dir,runtime,requireTaskOwnership:true});
 try{const session=JSON.parse(fs.readFileSync(service.file)),a={...session},b={...session};const first=await request(a,'ready');
  // Inert protocol event only: no native UI click or physical re-arm is simulated.
  guardian.emit('human_end');for(let i=0;i<40&&open;i++)await new Promise(r=>setTimeout(r,5));assert.equal(open,false);assert.equal(state,'stopped');
  const next=await request(b,'ready');assert.equal(next.ready,false);assert.equal(next.state,'stopped');assert.notEqual(next.task_token,first.task_token);assert.equal((await request(a,'end')).error.code,'task_owned');await request(b,'end');
 }finally{await service.shutdown();fs.rmSync(dir,{recursive:true,force:true});}
});
