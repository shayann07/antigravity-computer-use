import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
import {install} from './install.mjs';import {storageOperation} from '../server/storage.mjs';
import {verifyRelease,verifyStaged,verifyUpdateBundle,downloadFile,updateSettings,acquireUpdateLock,newerVersion,readBoundedJSON,deploymentPinned} from '../server/update-core.mjs';
import {nativePlatform} from '../server/platform.mjs';
import {randomUUID} from 'node:crypto';
import {diagnostics} from './diagnostics.mjs';
import {acquireServiceLease} from '../server/service-lease.mjs';
import {request} from './desktop.mjs';
import {writeAtomicJSON} from '../server/atomic-json.mjs';
import {rollbackGuarded} from './rollback.mjs';
import {readStopLatch} from '../server/recovery.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function update(target,command,{fetcher=fetch,adapters={}}={}){
 target=path.resolve(target);
 const storage=adapters.storage||storageOperation;storage('verify',target);
 if(command==='status')return updateLocked(target,command,{fetcher,adapters});
 let ownership;
 if(!adapters.storage){
  ownership=await acquireServiceLease(target);
  // The kernel lease is authoritative; a dead worker's marker is stale even
  // when its PID has since been reused by an unrelated process.
  try{const file=path.join(target,'update.lock');if(fs.existsSync(file))fs.unlinkSync(file);}catch(error){await ownership.release();throw error;}
 }
 let unlock;try{unlock=acquireUpdateLock(target);}catch(error){await ownership?.release();throw error;}
 try{return await updateLocked(target,command,{fetcher,adapters});}
 finally{try{unlock();}finally{await ownership?.release();}}
}
async function updateLocked(target,command,{fetcher,adapters}){
 // Only imported tests inject inert native/installer boundaries; no CLI/env bypass.
 const storage=adapters.storage||storageOperation,installer=adapters.install||install;
 target=path.resolve(target);storage('verify',target);
 const installed=JSON.parse(fs.readFileSync(path.join(target,'installation.json')));
 const bundle=JSON.parse(fs.readFileSync(path.join(installed.release,'bundle-manifest.json')));
 const settings=updateSettings(target,bundle.version),stateFile=path.join(target,'update-state.json');
 const read=()=>{
  if(!fs.existsSync(stateFile))return {};
  try{const value=JSON.parse(fs.readFileSync(stateFile));if(!value||typeof value!=='object'||Array.isArray(value)||value.sequence!=null&&(!Number.isSafeInteger(value.sequence)||value.sequence<0))throw Error();return value;}
  catch{throw Error('update_state_invalid');}
 };
 const save=v=>writeAtomicJSON(stateFile,v);
 if(command==='scheduled'){
  const now=Date.now();let last=read();
  // A wall-clock correction must not postpone a check until an old future
  // timestamp arrives. Rebase to now without checking immediately, keeping
  // the existing minimum intervals instead of causing a network burst.
  if(['attempt_at','reporting_at'].some(key=>Number.isFinite(last[key])&&last[key]>now)){
   last={...last};for(const key of ['attempt_at','reporting_at'])if(Number.isFinite(last[key])&&last[key]>now)last[key]=now;
   save(last);
  }
  if(fs.existsSync(path.join(target,'update-switching.json'))){try{return await updateLocked(target,'recover',{fetcher,adapters});}catch{return {deferred:true,next_action:'inspect_interrupted_update'};}}
  if(settings.reporting&&(!last.reporting_at||now-last.reporting_at>=3600000)){
   const result=await (adapters.diagnostics||diagnostics)(path.join(target,'data'),{submit:true,target});
   // Empty journals and a competing reporter do not count as attempts.
   if(result.submitted>0||result.next_action&&result.next_action!=='reporting_in_progress')save({...read(),reporting_at:now,reporting_status:result.next_action||'complete'});
  }
  if(settings.mode==='manual')return {skipped:true};
  if(!last.attempt_at||now-last.attempt_at>=86400000){
   save({...read(),attempt_at:now});
   try{await updateLocked(target,'check',{fetcher,adapters});}catch(error){save({...read(),available:false,attempt_at:now,last_error:/^[a-z_]+$/.test(error.message)?error.message:'update_check_failed'});return {deferred:true,next_action:'retry_next_day'};}
  }
  if(settings.mode==='automatic'&&read().available){try{return await updateLocked(target,'apply',{fetcher,adapters});}catch(error){save({...read(),available:false,last_error:/^[a-z_]+$/.test(error.message)?error.message:'update_apply_failed'});return {deferred:true,next_action:'inspect_update_status'};}}
  return {checked:true};
 }
 if(command==='status'){
  const state=read(),interrupted=fs.existsSync(path.join(target,'update-switching.json'));let rawWorker,worker;
  try{const file=path.join(target,'update-worker-result.json');if(fs.statSync(file).size<8192)rawWorker=JSON.parse(fs.readFileSync(file));}catch{}
  const safeCode=value=>typeof value==='string'&&/^[a-z_]{1,80}$/.test(value)?value:undefined;
  const safeVersion=value=>typeof value==='string'&&/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(value)?value:undefined;
  if(rawWorker&&typeof rawWorker==='object')worker={applied:rawWorker.applied===true,rolled_back:rawWorker.rolled_back===true,deferred:rawWorker.deferred===true,version:safeVersion(rawWorker.version),next_action:safeCode(rawWorker.next_action),error_code:safeCode(rawWorker.error?.code)};
  return {settings,sequence:state.sequence,available:state.available==null?undefined:state.available===true,available_version:safeVersion(state.available_version),applied_version:safeVersion(state.applied_version),staged:typeof state.staged==='string',rollback_available:Array.isArray(state.rollback)&&state.rollback.length>0,last_error:safeCode(state.last_error),checked_at:Number.isFinite(state.checked_at)?state.checked_at:undefined,worker,interrupted_switch:interrupted,next_action:interrupted?'inspect_interrupted_update':state.last_error?'inspect_update_result':state.available===true?(settings.mode==='automatic'?'apply_when_idle':'update_available'):'continue_task'};
 }
 if(!['check','apply','rollback','recover'].includes(command))throw Error('Use update status|check|apply|rollback');
 const switchingFile=path.join(target,'update-switching.json');let switching=false,safeToUnlock=true;
 try{
  const state=read();
  const cli=adapters.cli||((record,args)=>{const p=spawnSync(path.join(record.release,nativePlatform().node),[record.launcher,...args],{encoding:'utf8',timeout:20000,windowsHide:true});if(p.status!==0)throw Error('update_controller_check_failed');return JSON.parse(p.stdout);});
  const passiveRecord=fallback=>{
   const global=JSON.parse(fs.readFileSync(path.join(target,'deployments.json'))).global;
   return global?{...fallback,release:global.release,launcher:path.join(target,'cu.mjs'),launcher_node:path.join(target,process.platform==='win32'?'cu-node.exe':'cu-node')}:fallback;
  };
  const startVerified=(record,errorCode)=>{
   const expected=JSON.parse(fs.readFileSync(path.join(record.release,'bundle-manifest.json'))).build_id;
   const health=cli(record,['start']);
   if(health.ok!==true||health.build_id!==expected||!['idle','stopped'].includes(health.state))throw Error(errorCode);
   return health;
  };
  const shutdownVerified=record=>{const result=cli(record,['shutdown']);if(result.ok!==true||result.closed!==true)throw Error('update_cleanup_unconfirmed');};
  const acquireController=adapters.acquireControllerLease||(!adapters.storage?()=>acquireServiceLease(path.join(target,'data')):async()=>null);
  const validateRollbackFiles=(files,allowEmpty=false)=>{
   if(!Array.isArray(files)||(!allowEmpty&&!files.length))throw Error('update_recovery_journal_invalid');const seen=new Set();
   for(const file of files){if(typeof file!=='string'||!path.isAbsolute(file))throw Error('update_recovery_journal_invalid');const resolved=path.resolve(file),key=process.platform==='win32'?resolved.toLowerCase():resolved;
    if(path.dirname(path.dirname(resolved))!==path.join(target,'backups')||path.basename(resolved)!=='rollback.json'||seen.has(key))throw Error('update_recovery_journal_invalid');seen.add(key);}
  };
  if(command==='check'){
   // A new check supersedes the prior offer, even if network, signature or
   // staging fails. Keep old staged bytes for diagnosis but never apply them
   // after an unsuccessful check.
   save({...state,available:false,attempt_at:Date.now()});
   const keyFile=adapters.keyFile||path.join(root,'release-public-key.pem');if(!fs.existsSync(keyFile)){save({...state,available:false,attempt_at:Date.now(),last_error:'release_signing_not_configured'});return {available:false,next_action:'release_signing_not_configured'};}
   const endpoint='https://api.github.com/repos/shayann07/antigravity-computer-use/releases'+(settings.channel==='stable'?'/latest':'?per_page=20');
   const response=await fetcher(endpoint,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('update_release_unavailable');let release=await readBoundedJSON(response,4*1024*1024);
   if(Array.isArray(release))release=release.find(r=>!r.draft);if(!release||release.draft)throw Error('update_release_unavailable');
   const asset=release.assets?.find(a=>a.name===`update-${process.platform}-${process.arch}.json`);
   if(!asset){
    // A previous staged release must not be applied after the selected channel
    // moves to a release that has no signed package for this platform.
    const {staged,envelope,available_version,...rest}=state;
    save({...rest,available:false,attempt_at:Date.now(),checked_at:Date.now(),last_error:null});
    return {available:false,next_action:'no_signed_release_for_platform'};
   }
   const assetURL=new URL(asset.browser_download_url);if(assetURL.protocol!=='https:'||assetURL.hostname!=='github.com'||!assetURL.pathname.startsWith('/shayann07/antigravity-computer-use/releases/download/'))throw Error('update_metadata_origin_invalid');
   const envelopeResponse=await fetcher(asset.browser_download_url,{signal:AbortSignal.timeout(15000)});if(!envelopeResponse.ok)throw Error('update_metadata_unavailable');
   const envelope=await readBoundedJSON(envelopeResponse);
   const bytes=Buffer.from(envelope.manifest,'base64'),m=verifyRelease(bytes,envelope.signature,fs.readFileSync(keyFile),{channel:settings.channel});
   if(m.sequence<=(state.sequence||0)||!newerVersion(m.version,bundle.version)){save({...state,available:false,attempt_at:Date.now()});return {available:false};}
   // A fresh directory lets an interrupted download retry without adopting partial bytes.
   const stage=path.join(target,'updates',String(m.sequence)+'-'+randomUUID());fs.mkdirSync(stage,{recursive:true,mode:0o700});
   try{
   const required=Object.values(m.files).reduce((n,f)=>n+f.size,0)*2+100*1024*1024;const disk=adapters.diskInfo?adapters.diskInfo(stage):fs.statfsSync(stage);if(disk.bavail*disk.bsize<required)throw Error('update_insufficient_space');
   for(const [name,f]of Object.entries(m.files)){const destination=path.join(stage,name);fs.mkdirSync(path.dirname(destination),{recursive:true});await downloadFile(f.url,destination,{size:f.size,hash:f.sha256,fetcher});if(process.platform!=='win32'&&(name==='node'||name.startsWith('bin/')||name.endsWith('.command')))fs.chmodSync(destination,0o700);}
   verifyStaged(stage,m);verifyUpdateBundle(stage,m,nativePlatform());save({...state,attempt_at:Date.now(),checked_at:Date.now(),staged:stage,envelope,available:true,available_version:m.version,last_error:null});return {available:true,version:m.version,next_action:settings.mode==='automatic'?'apply_when_idle':'update_available'};
   }catch(error){
    // Only this invocation's freshly created stage may be removed. Never touch
    // retained releases, rollback journals, previous stages or user folders.
    if(path.dirname(stage)===path.join(target,'updates')&&!fs.lstatSync(stage).isSymbolicLink())fs.rmSync(stage,{recursive:true,force:true});
    throw error;
   }
  }
  const current=cli(installed,['status']);if(current.ok!==true)throw Error('update_controller_check_failed');if(!['idle','not_running','stopped'].includes(current.state)||current.approved_apps?.length)return {deferred:true,next_action:'wait_for_task_end'};
  if(['guardian_stop_unconfirmed','stop_persistence_failed','guard_persistence_failed'].includes(current.control_reason))return {deferred:true,next_action:'inspect_stop_recovery'};
  const localStop=readStopLatch(path.join(target,'data','emergency.stop'));if(localStop?.unconfirmed||localStop?.invalid)return {deferred:true,next_action:'inspect_stop_recovery'};
  const serviceRunning=current.state!=='not_running'&&current.reconnect_required!==true;
  // Older services cannot prove whether an idle conversation still owns an
  // open task. Do not replace them automatically on the basis of idle alone.
  if(serviceRunning&&current.task_open!==false)return {deferred:true,next_action:current.task_open===true?'wait_for_task_end':'task_state_unavailable'};
  const reserve=async()=>{if(!serviceRunning)return true;
   const session=adapters.prepare?null:JSON.parse(fs.readFileSync(path.join(target,'data/desktop-session.json')));
   const prepared=adapters.prepare?await adapters.prepare(current):await request(session,'prepare_update',{},5000,current.permission_mode);
   return prepared.ok===true&&prepared.prepared===true;
  };
  const runRollback=(file,fence)=>adapters.rollback?adapters.rollback(file):rollbackGuarded(file,{held:fence?new Map([[path.join(target,'data'),fence]]):new Map()});
  if(command==='recover'){
   if(!fs.existsSync(switchingFile))return {recovered:false};
   const interrupted=JSON.parse(fs.readFileSync(switchingFile));
   if(!interrupted.previous_installation)throw Error('update_recovery_journal_invalid');validateRollbackFiles(interrupted.rollback,true);storage('verify-tree',target);
   if(!await reserve())return {deferred:true,next_action:'wait_for_task_end'};
   switching=true;safeToUnlock=false;
   if(serviceRunning)shutdownVerified(installed);
   const fence=await acquireController();try{for(const file of [...interrupted.rollback].reverse())await runRollback(file,fence);}finally{await fence?.release();}
   const prior=passiveRecord(interrupted.previous_installation);startVerified(prior,'update_recovery_health_failed');
   save({...state,available:false,last_error:'interrupted_update_rolled_back'});safeToUnlock=true;return {recovered:true,rolled_back:true};
  }
  let journal;
  const markSwitch=()=>{if(fs.existsSync(switchingFile))throw Error('update_interrupted_requires_recovery');journal={pid:process.pid,previous_installation:installed,rollback:[]};writeAtomicJSON(switchingFile,journal,{exclusive:true});switching=true;};
  const addJournal=file=>{journal.rollback.push(file);writeAtomicJSON(switchingFile,journal);};
  if(command==='rollback'){
   if(state.rollback==null||Array.isArray(state.rollback)&&!state.rollback.length)throw Error('update_no_rollback');validateRollbackFiles(state.rollback);storage('verify-tree',target);if(!await reserve())return {deferred:true,next_action:'wait_for_task_end'};markSwitch();
   const firstRollback=JSON.parse(fs.readFileSync(state.rollback[0]));const priorRecord=firstRollback.records.find(r=>r.kind==='installation'&&r.existed);
   if(!priorRecord)throw Error('update_rollback_journal_invalid');journal.previous_installation=JSON.parse(fs.readFileSync(priorRecord.saved));journal.rollback=[...state.rollback];writeAtomicJSON(switchingFile,journal);
   if(serviceRunning)shutdownVerified(installed);safeToUnlock=false;const fence=await acquireController();try{for(const file of [...state.rollback].reverse())await runRollback(file,fence);}finally{await fence?.release();}
   const restored=passiveRecord(JSON.parse(fs.readFileSync(path.join(target,'installation.json'))));startVerified(restored,'update_rollback_health_failed');save({...state,available:false,rollback:[]});safeToUnlock=true;return {rolled_back:true};
  }
  if(state.available!==true||!state.staged||!state.envelope)throw Error('update_not_staged');
  const m=verifyRelease(Buffer.from(state.envelope.manifest,'base64'),state.envelope.signature,fs.readFileSync(adapters.keyFile||path.join(root,'release-public-key.pem')),{channel:settings.channel});
  if(path.dirname(state.staged)!==path.join(target,'updates'))throw Error('update_stage_outside_installation');
  storage('verify-tree',target);verifyStaged(state.staged,m);
  if(m.sequence<=(state.sequence||0)||!newerVersion(m.version,bundle.version))throw Error('update_downgrade_refused');
  verifyUpdateBundle(state.staged,m,nativePlatform());
  const registry=JSON.parse(fs.readFileSync(path.join(target,'deployments.json')));
  if(!Object.values(registry).some(scope=>!deploymentPinned(scope,registry.global)))return {deferred:true,next_action:'all_deployments_pinned'};
  if(!await reserve())return {deferred:true,next_action:'wait_for_task_end'};
  markSwitch();
  // Installer refuses live controllers. Shutdown independently confirms native cleanup.
  if(serviceRunning)shutdownVerified(installed);
  // Hold the same native lease used by controllers while swapping files. An
  // old Sidecar cannot restart into a half-switched deployment.
  let controllerLease=await acquireController();
  const records=[];let next;
  try{
   for(const scope of Object.values(registry)){
    if(scope.integration!=='direct')throw Error('update_legacy_scope_requires_manual_upgrade');
    if(deploymentPinned(scope,registry.global))continue;
    safeToUnlock=false;next=installer({bundle:state.staged,target,home:installed.home,workspace:scope.workspace,permissionMode:scope.permission_mode,stagedUpdate:true,journalCreated:addJournal});records.push(path.join(next.backup,'rollback.json'));
   }
   if(!next)throw Error('update_no_deployment');await controllerLease?.release();controllerLease=null;
   const health=startVerified(next,'update_health_failed');if(health.build_id!==m.build_id)throw Error('update_health_failed');
   // Project installation order must not replace the global Sidecar policy.
   // A pinned global scope stays the passive owner even after project updates.
   {
    const global=passiveRecord(next);
    if(global.release!==next.release){
     shutdownVerified(next);const expected=JSON.parse(fs.readFileSync(path.join(global.release,'bundle-manifest.json'))).build_id;
     const passive=startVerified(global,'update_global_health_failed');if(passive.build_id!==expected)throw Error('update_global_health_failed');
    }
   }
   save({sequence:m.sequence,attempt_at:Date.now(),checked_at:Date.now(),available:false,rollback:records,applied_version:m.version});safeToUnlock=true;return {applied:true,version:m.version};
  }catch(error){
   if(error.code==='installation_recovery_failed')throw Error('update_recovery_requires_operator');
   // A failed lease release means the ownership helper may still be alive or
   // already gone; neither condition establishes that we still own the fence.
   // Preserve the switching journal and do not touch files until recovery can
   // acquire a fresh confirmed lease.
   if(error.code==='service_lease_cleanup_unconfirmed')throw error;
   if(next)try{shutdownVerified(next);}catch{
    // Startup may have failed before a service existed. The earlier cleanup
    // was confirmed and update-switching blocks new input. Only a positive
    // not-running status may proceed to a native ownership check; an active,
    // unresponsive or ambiguous service still requires operator review.
    let status;try{status=cli(next,['status']);}catch{throw Error('update_recovery_requires_operator');}
    if(status.ok!==true||status.state!=='not_running'||status.approved_apps?.length)throw Error('update_recovery_requires_operator');
   }
   // Hold the same fence used for installation through rollback as well: a
   // Sidecar must not restart between the status check and restoring files.
   if(!controllerLease)controllerLease=await acquireController();
   // The installer records its journal before mutating files. Include a
   // partially installed scope even when it failed before returning `next`.
   for(const file of [...journal.rollback].reverse())await runRollback(file,controllerLease);await controllerLease?.release();controllerLease=null;startVerified(passiveRecord(installed),'update_recovery_health_failed');save({...state,available:false,last_error:'update_rolled_back'});safeToUnlock=true;throw error;
  }
  finally{await controllerLease?.release();}
 }finally{if(switching&&safeToUnlock)fs.unlinkSync(switchingFile);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [target,command,parent]=process.argv.slice(2);
 const run=async()=>{
  if(parent){if(!/^\d+$/.test(parent)||Number(parent)<=0)throw Error('update_invalid_launcher');const until=Date.now()+10000;while(Date.now()<until){let alive=true;try{process.kill(Number(parent),0);}catch(e){if(e.code==='ESRCH')alive=false;}if(!alive)break;await new Promise(r=>setTimeout(r,100));}try{process.kill(Number(parent),0);throw Error('update_launcher_still_running');}catch(e){if(e.code!=='ESRCH')throw e;}}
  return update(target,command);
 };
 run().then(r=>{if(parent)fs.writeFileSync(path.join(target,'update-worker-result.json'),JSON.stringify(r),{mode:0o600});else console.log(JSON.stringify(r));}).catch(e=>{const result={ok:false,error:{code:/^[a-z_]+$/.test(e.message)?e.message:'update_worker_failed'}};if(parent)fs.writeFileSync(path.join(target,'update-worker-result.json'),JSON.stringify(result),{mode:0o600});else console.log(JSON.stringify(result));process.exitCode=1;});
}
