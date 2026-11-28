import fs from 'node:fs';import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readTaskState,writeAtomicText} from '../server/atomic-json.mjs';
// Same normalisation the installer applies, so any file it accepted can be rolled back.
export function readConfigFile(file){
 const text=fs.existsSync(file)?fs.readFileSync(file,'utf8').replace(/^﻿/,'').trim():'';
 const value=text?JSON.parse(text):{};
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid configuration: '+file);
 return value;
}
import {acquireServiceLease} from '../server/service-lease.mjs';
import {readStopLatch,serviceStopHint} from '../server/recovery.mjs';
export function rollbackPlan(file){
if(!file)throw new Error('Pass the exact backups/<timestamp>/rollback.json to restore.');
const data=JSON.parse(fs.readFileSync(path.resolve(file),'utf8'));
const target=path.resolve(data.release,'..','..'),roots=new Set([target]);
// A cross-folder installation may restore a skill pointing to a previous root.
// Check both sides before touching configuration; either may own a live task.
for(const record of data.records){if(record.kind==='deployment'&&record.existed){
 const previous=JSON.parse(fs.readFileSync(record.saved,'utf8'));
 if(typeof previous.target!=='string'||!path.isAbsolute(previous.target))throw Error('invalid_previous_deployment');
 roots.add(path.resolve(previous.target));
}}
const unique=new Map();for(const root of roots){const key=process.platform==='win32'?root.toLowerCase():root;if(!unique.has(key))unique.set(key,root);}
return {data,roots:[...unique.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,root])=>root)};
}
// A launcher such as cu-node.exe can be open for a moment in a separate CLI
// call, which the controller lease does not fence; Windows then refuses the
// rename (EPERM/EBUSY). An unchanged file needs no rename at all, and a
// changed one is retried briefly before the rollback reports failure (#8).
export function restoreFile(saved,file,{io=fs,sleep=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms),attempts=30}={}){
 if(io.existsSync(file)&&!io.statSync(file).isDirectory()&&io.readFileSync(file).equals(io.readFileSync(saved)))return 'unchanged';
 const temporary=file+'.rollback.tmp';
 io.copyFileSync(saved,temporary);io.chmodSync(temporary,io.statSync(saved).mode);
 for(let attempt=1;;attempt++){
  try{io.renameSync(temporary,file);return 'restored';}
  catch(error){
   if(!['EPERM','EBUSY','EACCES'].includes(error.code)||attempt>=attempts){try{io.unlinkSync(temporary);}catch{}throw error;}
   sleep(100);
  }
 }
}
export function rollback(file,{guard=()=>{}}={}){return restoreRollback(rollbackPlan(file),guard);}
function restoreRollback({data,roots},guard){
guard();
for(const root of roots){
const stop=readStopLatch(path.join(root,'data','emergency.stop'));
if(stop?.unconfirmed||stop?.invalid)throw Error('stop_recovery_required_before_rollback');
if(readTaskState(path.join(root,'data','task-state.json')))throw Error(`task_open_finish_before_rollback: a task is still open; no configuration was changed. ${serviceStopHint(root)}`);
const sessionFile=path.join(root,'data/desktop-session.json');if(fs.existsSync(sessionFile)){
 const session=JSON.parse(fs.readFileSync(sessionFile,'utf8'));if(!Number.isSafeInteger(session.pid)||session.pid<=0)throw Error('Invalid live-session metadata; inspect before rollback.');
 let alive=true;try{process.kill(session.pid,0);}catch(error){if(error.code==='ESRCH')alive=false;}
 if(alive)throw Error(`A desktop service is still running; no configuration was changed. ${serviceStopHint(root)}`);
}
}
// Parse every configuration file, live and backed up, before restoring the
// first record, so one unreadable file cannot leave a half-finished rollback (#135).
const configs=new Map();
for(const r of data.records)if(r.kind==='sidecar-config'||r.kind==='config')configs.set(r,{current:readConfigFile(r.file),previous:r.existed?readConfigFile(r.saved):{}});
for(const r of data.records){
 guard();
 if(r.kind==='sidecar-config'||r.kind==='config'){
  const {current,previous}=configs.get(r),key=r.kind==='config'?'mcpServers':'sidecars';
  current[key]??={};const old=previous[key]?.['antigravity-computer-use'];
  if(old)current[key]['antigravity-computer-use']=old;else delete current[key]['antigravity-computer-use'];
  // Publish atomically: the user's complete file stays readable until the merged one is durable (#134).
  fs.mkdirSync(path.dirname(r.file),{recursive:true});writeAtomicText(r.file,JSON.stringify(current,null,2)+'\n');
 }
 else if(r.existed){
  if(fs.statSync(r.saved).isDirectory()){
   fs.cpSync(r.saved,r.file,{recursive:true});
   // A host can create an empty skill directory before installation. Remove
   // the discovery marker if the backup had none, preserving sibling files.
   if(r.kind==='skill'&&!fs.existsSync(path.join(r.saved,'SKILL.md')))fs.rmSync(path.join(r.file,'SKILL.md'),{force:true});
  }
  else restoreFile(r.saved,r.file);
 }
 else if(['installation','launcher','deployment','deployment-registry','sidecar-definition'].includes(r.kind)&&fs.existsSync(r.file))fs.unlinkSync(r.file);
 else if(r.kind==='skill'&&fs.existsSync(path.join(r.file,'SKILL.md')))fs.unlinkSync(path.join(r.file,'SKILL.md'));
}
guard();
return {restored:true};
}
export async function rollbackGuarded(file,{held=new Map(),acquire=acquireServiceLease}={}){
 const plan=rollbackPlan(file),acquired=[];const leases=[];
 const identity=directory=>process.platform==='win32'?path.resolve(directory).toLowerCase():path.resolve(directory);
 const preheld=new Map([...held].map(([directory,lease])=>[identity(directory),lease]));
 try{
  for(const root of plan.roots){const directory=path.join(root,'data');fs.mkdirSync(directory,{recursive:true});const existing=preheld.get(identity(directory)),lease=existing||await acquire(directory);if(!existing)acquired.push(lease);leases.push(lease);}
  const guard=()=>{for(const lease of leases)lease.assertHeld();};
  return restoreRollback(plan,guard);
 }finally{let failure;for(const lease of acquired.reverse())try{await lease.release();}catch(error){failure??=error;}if(failure)throw failure;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){rollbackGuarded(process.argv[2]).then(()=>console.log('Prior configuration and skill files restored. Installed release folders were preserved.')).catch(error=>{console.error(error.message);process.exitCode=1;});}
