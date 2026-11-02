// Recovery guidance, bounded evidence inspection and monotonic Stop persistence.
// These helpers never replay input, clear Stop or perform human re-arm.
import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {writeAtomicText} from './atomic-json.mjs';

// Stop is monotonic until trusted local recovery: an ordinary Stop never
// replaces existing evidence of uncertain delivery. This does not acknowledge
// native delivery or clear a latch.
function stopRecord(file,io){
 let fd;
 try{
  const info=io.lstatSync(file,{bigint:true});
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1n||info.size>4096n)throw Error('invalid Stop entry');
  fd=io.openSync(file,io.constants.O_RDONLY|(io.constants.O_NOFOLLOW||0));
  const opened=io.fstatSync(fd,{bigint:true});if(!opened.isFile()||opened.nlink!==1n||opened.size>4096n||opened.dev!==info.dev||opened.ino!==info.ino)throw Error('Stop entry changed');
  const bytes=Buffer.alloc(4097);let used=0;
  while(used<bytes.length){const n=io.readSync(fd,bytes,used,bytes.length-used,null);if(!n)break;used+=n;}
  const after=io.fstatSync(fd,{bigint:true}),current=io.lstatSync(file,{bigint:true});
  if(used>4096||after.size!==opened.size||after.mtimeNs!==opened.mtimeNs||after.ctimeNs!==opened.ctimeNs||!current.isFile()||current.isSymbolicLink()||current.nlink!==1n||current.dev!==opened.dev||current.ino!==opened.ino)throw Error('Stop entry changed');
  const value=bytes.subarray(0,used).toString('utf8');return {value,unconfirmed:value.startsWith('unconfirmed:')};
 }catch(error){if(error.code==='ENOENT'&&fd===undefined)return null;throw error;}
 finally{if(fd!==undefined)io.closeSync(fd);}
}
export function readStopLatch(file,{io=fs}={}){
 try{
  const pending=stopRecord(file+'.unconfirmed',io),primary=stopRecord(file,io);
  if(pending){if(!pending.unconfirmed)throw Error('Invalid uncertainty marker');return pending;}
  if(primary&&primary.value!=='stopped'&&!primary.unconfirmed)throw Error('Invalid Stop marker');
  return primary;
 }catch{return {value:null,unconfirmed:false,invalid:true};}
}
export function persistStopLatch(file,{unconfirmed=false,nonce,io=fs}={}){
 if(typeof file!=='string'||!path.isAbsolute(file)||typeof unconfirmed!=='boolean')throw Error('Invalid Stop persistence request');
 if(nonce!==undefined&&(typeof nonce!=='string'||nonce.length!==32||!/^[a-f0-9]{32}$/.test(nonce)))throw Error('Invalid internal Stop nonce');
 const initial=readStopLatch(file,{io});unconfirmed=unconfirmed||initial?.unconfirmed===true;
 if(unconfirmed){
  const prior=readStopLatch(file,{io});
  // A separate create-only marker survives Windows sharing violations and
  // older handles still writing the primary file. Ordinary writers never
  // modify it. Publication is atomic and flushed before it becomes visible.
  try{writeAtomicText(file+'.unconfirmed',prior?.unconfirmed?prior.value:'unconfirmed:'+(nonce||randomUUID()),{exclusive:true,io});}
  catch(error){if(error.code!=='EEXIST')throw error;}
  // Retain the primary marker for older readers when possible. Failure here
  // cannot erase the already-published uncertainty marker.
  const pending=stopRecord(file+'.unconfirmed',io);
  if(!pending?.unconfirmed)throw Error('Uncertainty publication could not be verified');
  try{const primary=stopRecord(file,io);if(!primary?.unconfirmed)writeAtomicText(file,pending.value,{io});}catch{}
 }else{
  try{writeAtomicText(file,'stopped',{exclusive:true,io});}
  catch(error){if(error.code!=='EEXIST')throw error;}
 }
 const saved=readStopLatch(file,{io});
 if(!unconfirmed&&saved?.unconfirmed)return persistStopLatch(file,{unconfirmed:true,io});
 if(!saved||saved.value!=='stopped'&&!saved.unconfirmed||unconfirmed&&!saved.unconfirmed)throw Error('Stop persistence could not be verified');
 return saved;
}
// Internal settlement after a validated current-process receipt and independent
// driver cleanup. The primary Stop remains; this never re-arms control.
export function settleFreshStopLatch(file,nonce,rootIdentity,{io=fs}={}){
 if(!path.isAbsolute(file)||typeof nonce!=='string'||nonce.length!==32||!/^[a-f0-9]{32}$/.test(nonce))throw Error('Invalid Stop settlement');
 const directory=path.dirname(file),pendingFile=file+'.unconfirmed',value='unconfirmed:'+nonce;
 const rootMatches=()=>{const root=io.lstatSync(directory,{bigint:true});return root.isDirectory()&&!root.isSymbolicLink()&&root.dev===rootIdentity?.dev&&root.ino===rootIdentity?.ino;};
 if(!rootMatches())throw Error('Stop storage ownership changed');
 const identity=io.lstatSync(pendingFile,{bigint:true}),pending=stopRecord(pendingFile,io),primary=stopRecord(file,io);
 if(pending?.value!==value||primary?.unconfirmed&&primary.value!==value)throw Error('Stop episode changed');
 writeAtomicText(file,'stopped',{io});
 const current=io.lstatSync(pendingFile,{bigint:true});
 if(!rootMatches()||current.dev!==identity.dev||current.ino!==identity.ino||stopRecord(pendingFile,io)?.value!==value)throw Error('Stop episode changed');
 io.unlinkSync(pendingFile);
 const saved=readStopLatch(file,{io});if(saved?.value!=='stopped'||saved.unconfirmed||saved.invalid)throw Error('Stop settlement was not preserved');
 return {stopped:true,human_rearm_required:true};
}
export function preserveStopLatch(source,destination,{io=fs}={}){
 const prior=readStopLatch(source,{io});if(!prior)return false;
 if(prior.value!=='stopped'&&!prior.unconfirmed)throw Error('Previous Stop evidence is invalid; inspect it before migration');
 persistStopLatch(destination,{unconfirmed:prior.unconfirmed,io});return true;
}
const guardName=/^guard-[1-9][0-9]{0,9}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.state$/;
export function bindStopRecovery(file,nonce,guard){
 if(!path.isAbsolute(file)||typeof nonce!=='string'||nonce.length!==32||!/^[a-f0-9]{32}$/.test(nonce)||!guardName.test(guard))throw Error('Invalid internal Stop recovery context');
 const prior=readStopLatch(file);
 if(prior?.unconfirmed||prior?.invalid)throw Error('Cannot replace an unresolved Stop context');
 writeAtomicText(file+'.context.json',JSON.stringify({schema:1,nonce,guard})+'\n');
}
export function persistRecoveryStop(file,guard,{unconfirmed=false,nonce=randomUUID().replaceAll('-','')}={}){
 const old=readStopLatch(file);let contextError;
 if(unconfirmed&&!old?.unconfirmed&&!old?.invalid)try{bindStopRecovery(file,nonce,guard);}catch(error){contextError=error;}
 const result=persistStopLatch(file,{unconfirmed,nonce});
 // Missing context prevents later settlement, but must never prevent Stop.
 if(contextError)throw contextError;
 return result;
}
// Requires native old-actor/ledger verification again at this boundary. It
// settles only uncertainty, retaining ordinary Stop for local human re-arm.
export function settlePriorStop(file,record,{platform=process.platform,probe=process.kill}={}){
 const directory=path.dirname(file),root=fs.lstatSync(directory,{bigint:true});
 const context=JSON.parse(readRecoveryFile(file+'.context.json',1024,fs));
 if(!context||context.schema!==1||context.guard!==record?.guard||!guardName.test(context.guard)||Object.keys(context).sort().join(',')!=='guard,nonce,schema')throw Error('Prior Stop context is missing or differs');
 const verify=()=>priorWindowsCleanupVerified(directory,record,{platform,probe})||priorMacCleanupVerified(directory,record,{platform,probe});
 if(!verify())throw Error('Prior actors or ledger remain unverified');
 const result=settleFreshStopLatch(file,context.nonce,root);
 return {...result,prior_cleanup_verified:true};
}
export function safeWaitMetrics(value){
 if(!value||typeof value!=='object')return undefined;
 const {elapsed_ms,observations,polling_budget_ms}=value;
 if(!Number.isSafeInteger(elapsed_ms)||elapsed_ms<0||!Number.isSafeInteger(observations)||observations<0||!Number.isSafeInteger(polling_budget_ms)||polling_budget_ms<100||polling_budget_ms>30000)return undefined;
 return {elapsed_ms,observations,polling_budget_ms};
}
// Inspect only a recorded prior Windows guard. Never inject input, kill a PID,
// clear Stop, or trust a PID that is still alive (including possible reuse).
function readRecoveryFile(file,limit,io){
  const info=io.lstatSync(file,{bigint:true});if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1n||info.size>BigInt(limit))throw Error('untrusted recovery record');
  const fd=io.openSync(file,io.constants.O_RDONLY|(io.constants.O_NOFOLLOW||0));try{
   const opened=io.fstatSync(fd,{bigint:true});if(!opened.isFile()||opened.nlink!==1n||opened.size>BigInt(limit)||opened.dev!==info.dev||opened.ino!==info.ino)throw Error('recovery record replaced');
   const bytes=Buffer.alloc(limit+1);let used=0;while(used<bytes.length){const n=io.readSync(fd,bytes,used,bytes.length-used,null);if(!n)break;used+=n;}
   const after=io.fstatSync(fd,{bigint:true}),current=io.lstatSync(file,{bigint:true});
   if(used>limit||BigInt(used)!==opened.size||after.size!==opened.size||after.mtimeNs!==opened.mtimeNs||after.ctimeNs!==opened.ctimeNs||!current.isFile()||current.isSymbolicLink()||current.nlink!==1n||current.dev!==opened.dev||current.ino!==opened.ino||current.size!==opened.size||current.mtimeNs!==opened.mtimeNs||current.ctimeNs!==opened.ctimeNs)throw Error('recovery record changed');
   return bytes.subarray(0,used).toString('utf8');
  }finally{io.closeSync(fd);}
}
export function priorWindowsCleanupVerified(directory,record,{platform=process.platform,probe=process.kill,io=fs}={}){
 if(platform!=='win32'||record?.dispatched!==true||record.watchdogs_complete!==true||!Array.isArray(record.children)||record.children.length<3||typeof record.guard!=='string'||!/^guard-[1-9][0-9]{0,9}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.state$/.test(record.guard))return false;
 const read=(file,limit)=>readRecoveryFile(file,limit,io);
 const gone=pid=>{if(!Number.isSafeInteger(pid)||pid<=0||pid>4294967295)return false;try{probe(pid,0);return false;}catch(error){return error.code==='ESRCH';}};
 try{
  const guard=path.join(directory,record.guard),parent=Number(/^guard-(\d+)-/.exec(record.guard)[1]);
  const watchdog=/^([1-9][0-9]{0,9})\|([1-9][0-9]{0,19})$/.exec(read(guard+'.watchdog',128));if(!watchdog||!record.children.includes(Number(watchdog[1])))return false;
  const pids=[parent,...record.children,Number(watchdog[1])];if(!pids.every(gone))return false;
  const fields=read(guard,4096).split('|');if(fields.length<4||!['idle','stopped'].includes(fields[0]))return false;
  // Windows InputLedger.Save writes exactly zero bytes for an empty ledger.
  if(read(guard+'.inputs',65536)!=='')return false;
  return pids.every(gone);
 }catch{return false;}
}
export function priorMacCleanupVerified(directory,record,{platform=process.platform,probe=process.kill,io=fs}={}){
 if(platform!=='darwin'||record?.dispatched!==true||record.watchdogs_complete!==true||!Array.isArray(record.children)||record.children.length<3||typeof record.guard!=='string'||!/^guard-[1-9][0-9]{0,9}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.state$/.test(record.guard))return false;
 const read=(file,limit)=>readRecoveryFile(file,limit,io);
 const gone=pid=>{if(!Number.isSafeInteger(pid)||pid<=0||pid>4294967295)return false;try{probe(pid,0);return false;}catch(error){return error.code==='ESRCH';}};
 try{
  const guard=path.join(directory,record.guard),parent=Number(/^guard-(\d+)-/.exec(record.guard)[1]);
  const watchdog=/^([1-9][0-9]{0,9})\|([1-9][0-9]{0,19}(?:\.[0-9]{1,9})?)$/.exec(read(guard+'.watchdog',128));if(!watchdog||!record.children.includes(Number(watchdog[1])))return false;
  const pids=[parent,...record.children,Number(watchdog[1])];if(!pids.every(gone))return false;
  const fields=read(guard,4096).split('|');if(fields.length!==6||fields[5]!=='0'||!['idle','stopped'].includes(fields[0]))return false;
  const ledger=JSON.parse(read(guard+'.inputs',65536));
  if(!ledger||typeof ledger!=='object'||Array.isArray(ledger)||Object.keys(ledger).sort().join(',')!=='buttons,keys'||!Array.isArray(ledger.keys)||ledger.keys.length!==0||!Array.isArray(ledger.buttons)||ledger.buttons.length!==0)return false;
  return pids.every(gone);
 }catch{return false;}
}
export function recoveryAdvice(result){
 const code=result.error?.code||result.verification_error?.code;
 const extra={
  ...(result.repeated_failure===true?{repeated_failure:true}:{}),
  ...(Number.isSafeInteger(result.recovery_attempts_remaining)?{recovery_attempts_remaining:result.recovery_attempts_remaining}:{})
 };
 if(['input_cleanup_failed','guardian_end_unconfirmed','guardian_stop_unconfirmed'].includes(code))return {...extra,next_action:'inspect_input_cleanup',replay_allowed:false};
 if(result.delivery_unknown===true||result.input_completed===true&&code||code==='input_outcome_unknown')return {...extra,next_action:'inspect_effect_without_replay',replay_allowed:false};
 if(['wait_failure_observed','wait_observation_incomplete','wait_observation_timeout','wait_condition_timeout','wait_change_timeout','op_timeout','capture_preparation_timeout'].includes(code))return {...extra,next_action:'inspect_effect_without_replay',replay_allowed:false};
 if(['stale_observation','element_stale','window_moved','no_image','control_changed','focus_changed'].includes(code))return {...extra,next_action:'observe_again',replay_allowed:false};
 if(['window_minimized','window_hidden','window_capture_unavailable'].includes(code))return {...extra,next_action:result.repeated_failure===true?'await_human_window_recovery':'focus_target_then_observe',replay_allowed:false};
 if(code==='other_desktop')return {...extra,next_action:'await_human_space_switch',replay_allowed:false};
 if(code==='window_fullscreen')return {...extra,next_action:'await_human_fullscreen_exit',replay_allowed:false};
 if(['identity_changed','window_not_found','ambiguous_selector'].includes(code))return {...extra,next_action:'discover_apps_then_observe',replay_allowed:false};
 if(['mac_permissions_required','accessibility_denied'].includes(code))return {...extra,next_action:'await_human_permission_grant',replay_allowed:false};
 if(code==='desktop_context_unavailable')return {...extra,next_action:'human_start_on_visible_desktop',replay_allowed:false};
 if(code==='version_mismatch')return {...extra,next_action:'resolve_version_mismatch',replay_allowed:false};
 if(code==='recovered_task_requires_end')return {...extra,next_action:'inspect_recovered_task',replay_allowed:false};
 if(code==='task_required')return {...extra,next_action:'ready_then_use_task_token',replay_allowed:false};
 if(code==='task_requires_end')return {...extra,next_action:'end_owned_task_then_shutdown',replay_allowed:false};
 if(['another_session_busy','cleanup_in_progress','task_owned'].includes(code))return {...extra,next_action:'wait_for_controller_then_observe',replay_allowed:false};
 if(code==='session_limit')return {...extra,next_action:'end_owned_task_then_reauthorize',replay_allowed:false};
 if(['recovered_cleanup_unverified','input_lease_stale'].includes(code))return {...extra,next_action:'inspect_prior_input_cleanup',replay_allowed:false};
 if(['stop_persistence_failed','guard_persistence_failed'].includes(code))return {...extra,next_action:'inspect_stop_persistence_without_restart',replay_allowed:false};
 if(['permission_denied','approval_timeout','confirmation_required'].includes(code))return {...extra,next_action:'await_user_decision',replay_allowed:false};
 if(['control_stopped','control_inactive'].includes(code))return {...extra,next_action:'inspect_status_then_human_controls',replay_allowed:false};
 return {...extra,next_action:'inspect_diagnostics',replay_allowed:false};
}
