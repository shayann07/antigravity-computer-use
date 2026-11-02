import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {once} from 'node:events';
import {TaskCoordinator} from '../server/task-coordinator.mjs';import {testDirectory} from './paths.mjs';
test('different installation task coordinators exclude input, retain abandoned ownership and preserve Stop',{timeout:90000,skip:!['win32','darwin'].includes(process.platform)},async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'global-task-')),root=path.join(dir,'desktop-task-lease'),ad=path.join(dir,'a'),bd=path.join(dir,'b');for(const d of [ad,bd]){fs.mkdirSync(d);fs.writeFileSync(path.join(d,'task-state.json'),JSON.stringify({schema:1,open:false}));}
 // Inert fixture paths use the real native lease. Full ancestor qualification
 // remains a separate check; no user-profile coordination or desktop is used.
 const options={root,legacyRoots:[],verify:async(_mode,p)=>assert(p.startsWith(dir+path.sep))};const a=new TaskCoordinator(ad,options),b=new TaskCoordinator(bd,options);
 try{
  await a.ensure();await assert.rejects(b.ensure(),{code:'another_session_busy'});
  fs.writeFileSync(path.join(ad,'task-state.json'),JSON.stringify({schema:1,open:true}));
  const lost=once(a.held,'lost');process.kill(a.held.pid);await lost;
  await assert.rejects(b.ensure(),{code:'global_owner_unverified'});
  fs.writeFileSync(path.join(ad,'task-state.json'),JSON.stringify({schema:1,open:false}));await a.release();
  await b.ensure();await b.release();
  await a.ensure();fs.writeFileSync(path.join(ad,'emergency.stop'),'stopped');await a.release();await assert.rejects(b.ensure(),{code:'global_stop_latched'});
  // Remove only this synthetic fixture marker, never an installed human Stop.
  fs.unlinkSync(path.join(ad,'emergency.stop'));await b.ensure();await b.release();
 }finally{for(const c of [a,b])if(c.held)await c.held.release();fs.rmSync(dir,{recursive:true,force:true});}
});
test('registered live legacy controllers are refused before acquiring shared ownership',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'legacy-global-')),legacy=path.join(dir,'legacy'),data=path.join(legacy,'data'),root=path.join(dir,'desktop-task-lease');fs.mkdirSync(data,{recursive:true});fs.writeFileSync(path.join(data,'desktop-session.json'),JSON.stringify({pid:123}));
 try{const c=new TaskCoordinator(path.join(dir,'new'),{root,legacyRoots:[legacy],verify:async()=>{},isAlive:()=>true});await assert.rejects(c.ensure(),{code:'legacy_controller_running'});assert(!fs.existsSync(root));}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
