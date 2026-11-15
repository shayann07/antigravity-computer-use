import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {Runtime,TASK_IDLE_MS} from '../server/runtime.mjs';import {TaskOwnership} from '../server/task-ownership.mjs';import {serveDesktop} from '../server/desktop-service.mjs';import {request} from '../scripts/desktop.mjs';
import {BUILD_ID,VERSION} from '../server/version.mjs';import {testDirectory} from './paths.mjs';
const info=(fields,now=1e6)=>Runtime.prototype.taskInfo.call({taskOpen:false,recoveredTask:false,grants:new Map(),driver:{},token:'',...fields},now);
const sensitive=value=>/token|secret|nonce|title/i.test(JSON.stringify(value));

test('no open task reports none with null ages',()=>{
 const r=info({});assert.equal(r.task_liveness,'none');assert.equal(r.task_age_ms,null);assert.equal(r.last_activity_ms_ago,null);assert.equal(r.task_origin,'none');
});
test('a fresh task is active with age, activity and zero held resources',()=>{
 const r=info({taskOpen:true,taskOpenedAt:1e6-500,lastActivityAt:1e6-500});
 assert.equal(r.task_liveness,'active');assert.equal(r.task_age_ms,500);assert.equal(r.last_activity_ms_ago,500);assert.equal(r.task_origin,'this_controller');
 assert.deepEqual(r.held_resources,{grants:0,input_held:false});assert(r.task_liveness_rule.length>10);assert(!sensitive(r));
});
test('an acting task with grants stays active, then idle once quiet but still holding resources',()=>{
 const grants=new Map([['k',{pid:1,path:'secret-looking-title'}]]);
 const live=info({taskOpen:true,taskOpenedAt:0,lastActivityAt:1e6-1000,grants,token:'t',remaining:5});
 assert.equal(live.task_liveness,'active');assert.equal(live.held_resources.grants,1);assert(live.actions_used>=0);assert.equal(live.actions_limit>0,true);
 const idle=info({taskOpen:true,taskOpenedAt:0,lastActivityAt:1e6-TASK_IDLE_MS-1,grants});
 assert.equal(idle.task_liveness,'idle');assert(!sensitive(idle));
});
test('input possibly held counts as a held resource and blocks orphaned',()=>{
 const r=info({taskOpen:true,taskOpenedAt:0,lastActivityAt:0,driver:{inputMayBeHeld:true}});assert.equal(r.held_resources.input_held,true);assert.equal(r.task_liveness,'idle');
});
test('a task idle beyond the threshold with nothing held is orphaned with its evidence',()=>{
 const r=info({taskOpen:true,taskOpenedAt:0,lastActivityAt:1e6-TASK_IDLE_MS-1});
 assert.equal(r.task_liveness,'orphaned');assert.match(r.task_liveness_rule,/no grant or input held/i);assert(r.last_activity_ms_ago>TASK_IDLE_MS);
});
test('a recovered task after restart is orphaned, reads file age, and has no opener time',()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'liveness-'));const file=path.join(dir,'task-state.json');fs.writeFileSync(file,'{}');
 try{
  const mtime=fs.statSync(file).mtimeMs,r=info({taskOpen:true,recoveredTask:true,taskFile:file},mtime+2000);
  assert.equal(r.task_liveness,'orphaned');assert.equal(r.task_origin,'previous_controller');assert.equal(r.task_age_ms,null);assert.equal(r.last_activity_ms_ago,2000);assert.match(r.task_liveness_rule,/restart/);
  assert.equal(info({taskOpen:true,recoveredTask:true,taskFile:path.join(dir,'missing.json')}).last_activity_ms_ago,null);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('markActivity only moves the clock of an open task',()=>{
 const closed={taskOpen:false,lastActivityAt:1};Runtime.prototype.markActivity.call(closed);assert.equal(closed.lastActivityAt,1);
 const open={taskOpen:true,lastActivityAt:1};Runtime.prototype.markActivity.call(open);assert(open.lastActivityAt>1);
});
test('beginTask stamps the opening time once and a repeat does not reset it',()=>{
 const fake={taskOpen:false,taskDurable:false,finishing:false,taskFile:null};Runtime.prototype.beginTask.call(fake);
 const opened=fake.taskOpenedAt;assert.equal(typeof opened,'number');fake.taskOpenedAt=opened-5000;Runtime.prototype.beginTask.call(fake);assert.equal(fake.taskOpenedAt,opened-5000);
});
test('ownership relation answers self, other, unknown or none without exposing the token',()=>{
 const owner=new TaskOwnership(),idle={state:'idle',task_open:false},open={state:'idle',task_open:true};
 assert.equal(owner.relation(undefined,idle),'none');assert.equal(owner.relation(undefined,open),'unknown');
 const token=owner.claim(idle);assert.equal(owner.relation(token,open),'self');assert.equal(owner.relation('0'.repeat(64),open),'other');assert.equal(owner.relation(undefined,open),'other');assert.equal(owner.relation('short',open),'other');
 owner.ended();assert.equal(owner.relation(token,open),'unknown');
});
test('status and ready carry the owner hint over IPC: self for the opener, other for a second caller',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'liveness-ipc-'));let open=false;
 const runtime={status:()=>({state:'idle',task_open:open,build_id:BUILD_ID,build_version:VERSION,permission_mode:'standalone',task_liveness:open?'active':'none'}),async ready(){open=true;return {ready:true};},async finish(){open=false;return {ended:true};},async stop(){return {stopped:true};},async close(){}};
 const service=await serveDesktop({directory:dir,runtime,requireTaskOwnership:true});
 try{
  const saved=JSON.parse(fs.readFileSync(service.file)),a={...saved},b={...saved};
  assert.equal((await request(b,'status')).owner,'none');
  const ready=await request(a,'ready');assert.equal(ready.owner,'self');
  assert.equal((await request(a,'status')).owner,'self');assert.equal((await request(b,'status')).owner,'other');
  assert.equal((await request(b,'status')).task_liveness,'active');assert(!JSON.stringify(await request(b,'status')).includes(ready.task_token));
  await request(a,'end');
 }finally{await service.shutdown();fs.rmSync(dir,{recursive:true,force:true});}
});
test('the real Runtime status and ready include the task block additively',()=>{
 const status=Runtime.prototype.status.call({state:'idle',taskOpen:true,taskOpenedAt:Date.now()-10,lastActivityAt:Date.now()-10,recoveredTask:false,grants:new Map(),driver:{},guardian:{},remaining:undefined,permissionMode:'standalone',takeoverMode:'smart',privateDataStorage:'x'});
 for(const key of ['state','task_open','recovered_task','remaining_actions','approved_apps','task_age_ms','last_activity_ms_ago','held_resources','task_liveness','task_liveness_rule','actions_used','actions_limit','task_origin'])assert(key in status,key);
 assert.equal(status.actions_used,0);assert(!sensitive(status));
});
