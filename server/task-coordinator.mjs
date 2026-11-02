import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomBytes} from 'node:crypto';
import {acquireServiceLease} from './service-lease.mjs';import {storageOperationAsync} from './storage.mjs';import {readTaskRecord} from './atomic-json.mjs';import {readStopLatch,readRecoveryFile} from './recovery.mjs';
const refuse=(code,message)=>{throw Object.assign(Error(message),{code});};
const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}};
export class TaskCoordinator {
 constructor(directory,{root=path.join(os.homedir(),'.gemini','computer-use-control','desktop-task-lease'),acquire=acquireServiceLease,verify=storageOperationAsync,isAlive=alive,onLost=()=>{},legacyRoots}={}){Object.assign(this,{directory:path.resolve(directory),root:path.resolve(root),acquire,verify,isAlive,onLost,legacyRoots});this.file=path.join(this.root,'task-owner.json');this.held=null;this.record=null;}
 readOwner(){try{const r=JSON.parse(readRecoveryFile(this.file,4096));if(r?.schema!==1||!Number.isSafeInteger(r.pid)||r.pid<=0||typeof r.closed!=='boolean'||typeof r.directory!=='string'||!path.isAbsolute(r.directory)||typeof r.nonce!=='string'||!/^[a-f0-9]{32}$/.test(r.nonce))throw Error('Invalid owner record');return r;}catch(e){if(e.code==='ENOENT')return null;refuse('global_owner_unverified','Shared desktop ownership is unverified. Inspect diagnostics without taking over.');}}
 async checkLegacy(){
  let roots=this.legacyRoots;
  if(!roots){roots=[];const pointer=path.join(os.homedir(),'.gemini/config/skills/computer-use/deployment.json');if(fs.existsSync(pointer)){
   const pin=JSON.parse(readRecoveryFile(pointer,4096));if(typeof pin.target!=='string'||!path.isAbsolute(pin.target))refuse('global_owner_unverified','Registered installation is invalid.');roots.push(pin.target);
   const registry=path.join(pin.target,'deployments.json');if(fs.existsSync(registry)){const entries=Object.values(JSON.parse(readRecoveryFile(registry,65536)));if(entries.length>64)refuse('global_owner_unverified','Too many registered deployments to verify safely.');for(const entry of entries)if(entry.workspace){const project=path.join(entry.workspace,'.agents/skills/computer-use/deployment.json');if(fs.existsSync(project)){const p=JSON.parse(readRecoveryFile(project,4096));if(typeof p.target!=='string'||!path.isAbsolute(p.target))refuse('global_owner_unverified','Registered project installation is invalid.');roots.push(p.target);}}}
  }}
  for(const root of new Set(roots)){const directory=path.join(root,'data');if(path.resolve(directory)===this.directory)continue;const file=path.join(directory,'desktop-session.json');if(!fs.existsSync(file))continue;await this.verify('verify-tree',directory);const session=JSON.parse(readRecoveryFile(file,4096));if(!Number.isSafeInteger(session.pid)||session.pid<=0)refuse('global_owner_unverified','Registered legacy controller identity is invalid.');if(this.isAlive(session.pid)&&session.global_task_protocol!==1)refuse('legacy_controller_running','A registered older controller at '+root+' is running. Its owner must end and shut it down before this installation can take control.');}
 }
 async ensure(){
  if(this.held){this.held.assertHeld();return;}
  await this.checkLegacy();fs.mkdirSync(this.root,{recursive:true,mode:0o700});
  let lease;try{lease=await this.acquire(this.root);}catch(e){if(e.code==='service_already_running')refuse('another_session_busy','Another installation owns desktop control. Wait for its task to end.');throw e;}
  try{
   await this.verify('verify-tree',this.root);lease.assertHeld();const prior=this.readOwner();
   if(prior){await this.verify('verify-tree',prior.directory);if(!fs.existsSync(path.join(prior.directory,'task-state.json')))refuse('global_owner_unverified','Prior task evidence is missing.');const task=readTaskRecord(path.join(prior.directory,'task-state.json'));const stop=readStopLatch(path.join(prior.directory,'emergency.stop'));
    if(stop)refuse('global_stop_latched','The owning installation at '+path.dirname(prior.directory)+' still has Stop latched or unverified. Use its local human launcher to inspect and re-arm after recovery; this installation cannot clear its Stop.');
    if(task.open||!prior.closed&&this.isAlive(prior.pid))refuse('global_owner_unverified','The previous installation has not confirmed task cleanup. Recover its task before taking control.');
   }
   this.record={schema:1,pid:process.pid,directory:this.directory,nonce:randomBytes(16).toString('hex'),closed:false};
   await lease.publishTaskOwner(Buffer.from(JSON.stringify(this.record)));lease.assertHeld();
   this.held=lease;lease.on('lost',()=>this.onLost());
  }catch(e){await lease.release();throw e;}
 }
 async release(){
  if(!this.held&&!this.record)return;
  let lease=this.held;
  let valid=false;try{lease?.assertHeld();valid=!!lease;}catch{}
  if(!valid){if(lease)await lease.release();lease=await this.acquire(this.root);await this.verify('verify-tree',this.root);this.held=lease;}
  const current=this.readOwner();
  if(current?.nonce!==this.record?.nonce||current?.directory!==this.directory)refuse('global_owner_unverified','Shared ownership changed. Do not overwrite its recovery evidence.');
  if(readTaskRecord(path.join(this.directory,'task-state.json')).open)refuse('global_owner_unverified','Task cleanup is not complete.');
  await lease.publishTaskOwner(Buffer.from(JSON.stringify({...this.record,closed:true})));await lease.release();this.held=null;this.record=null;
 }
}
