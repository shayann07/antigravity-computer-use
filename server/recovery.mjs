// Recovery guidance, bounded evidence inspection and monotonic Stop persistence.
// These helpers never replay input, clear Stop or perform human re-arm.
import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';import {spawnSync} from 'node:child_process';
import {writeAtomicText} from './atomic-json.mjs';

// Stop is monotonic until trusted local recovery: an ordinary Stop never
// replaces existing evidence of uncertain delivery. This does not acknowledge
// native delivery or clear a latch.
// Exclusive publication links the temporary file into place, then unlinks the
// temporary, so a concurrent reader can briefly see two links. Wait out that
// window (bounded); an entry that stays hard-linked is still refused.
const LINK_WINDOW_MS=250;
function stopRecord(file,io){
 const deadline=performance.now()+LINK_WINDOW_MS;
 for(;;){
  try{return stopRecordOnce(file,io);}
  catch(error){if(error.code!=='stop_entry_linking'||performance.now()>=deadline)throw error;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5);}
 }
}
const linking=()=>Object.assign(Error('Stop entry is being published'),{code:'stop_entry_linking'});
function stopRecordOnce(file,io){
 let fd;
 try{
  const info=io.lstatSync(file,{bigint:true});
  if(info.isFile()&&!info.isSymbolicLink()&&info.nlink===2n)throw linking();
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1n||info.size>4096n)throw Error('invalid Stop entry');
  fd=io.openSync(file,io.constants.O_RDONLY|(io.constants.O_NOFOLLOW||0));
  const opened=io.fstatSync(fd,{bigint:true});if(opened.nlink===2n&&opened.dev===info.dev&&opened.ino===info.ino)throw linking();if(!opened.isFile()||opened.nlink!==1n||opened.size>4096n||opened.dev!==info.dev||opened.ino!==info.ino)throw Error('Stop entry changed');
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
 return {stopped:true,task_ended:true,next_action:'report_and_wait_for_human'};
}
// Removes a confirmed Stop marker so the next task starts fresh. The caller
// has already proven input cleanup. An uncertain, invalid or changed marker is
// never removed: unknown delivery stays fenced for inspection.
export function clearConfirmedStop(file,{io=fs}={}){
 if(typeof file!=='string'||!path.isAbsolute(file))throw Error('Invalid Stop path');
 const saved=readStopLatch(file,{io});
 if(!saved)return false;
 if(saved.invalid||saved.unconfirmed||saved.value!=='stopped')throw Object.assign(Error('Stop marker is not a confirmed Stop'),{code:saved.unconfirmed?'guardian_stop_unconfirmed':'stop_persistence_failed'});
 io.unlinkSync(file);
 if(readStopLatch(file,{io}))throw Object.assign(Error('Stop marker changed while clearing'),{code:'guardian_stop_unconfirmed'});
 return true;
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
export function currentStopNonce(file,guard){
 try{const context=JSON.parse(readRecoveryFile(file+'.context.json',1024));const stop=readStopLatch(file);
  if(context?.schema===1&&context.guard===guard&&guardName.test(guard)&&typeof context.nonce==='string'&&context.nonce.length===32&&/^[a-f0-9]{32}$/.test(context.nonce)&&stop?.unconfirmed&&stop.value==='unconfirmed:'+context.nonce)return context.nonce;
 }catch{}
 return null;
}
// Requires native old-actor/ledger verification again at this boundary. It
// settles only uncertainty, retaining ordinary Stop for local human re-arm.
export function settlePriorStop(file,record,{platform=process.platform,probe=process.kill,startOf=macProcessStartSeconds}={}){
 const directory=path.dirname(file),root=fs.lstatSync(directory,{bigint:true});
 const context=JSON.parse(readRecoveryFile(file+'.context.json',1024,fs));
 if(!context||context.schema!==1||context.guard!==record?.guard||!guardName.test(context.guard)||Object.keys(context).sort().join(',')!=='guard,nonce,schema')throw Error('Prior Stop context is missing or differs');
 const verify=()=>priorWindowsCleanupVerified(directory,record,{platform,probe})||priorMacCleanupVerified(directory,record,{platform,probe,startOf})||priorUndispatchedCleanupVerified(directory,record,{platform,probe,startOf})&&priorUndispatchedActorsGone(directory,record,{probe});
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
export function readRecoveryFile(file,limit,io=fs){
  const info=io.lstatSync(file,{bigint:true});if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1n||info.size>BigInt(limit))throw Error('untrusted recovery record');
  const fd=io.openSync(file,io.constants.O_RDONLY|(io.constants.O_NOFOLLOW||0));try{
   const opened=io.fstatSync(fd,{bigint:true});if(!opened.isFile()||opened.nlink!==1n||opened.size>BigInt(limit)||opened.dev!==info.dev||opened.ino!==info.ino)throw Error('recovery record replaced');
   const bytes=Buffer.alloc(limit+1);let used=0;while(used<bytes.length){const n=io.readSync(fd,bytes,used,bytes.length-used,null);if(!n)break;used+=n;}
   const after=io.fstatSync(fd,{bigint:true}),current=io.lstatSync(file,{bigint:true});
   if(used>limit||BigInt(used)!==opened.size||after.size!==opened.size||after.mtimeNs!==opened.mtimeNs||after.ctimeNs!==opened.ctimeNs||!current.isFile()||current.isSymbolicLink()||current.nlink!==1n||current.dev!==opened.dev||current.ino!==opened.ino||current.size!==opened.size||current.mtimeNs!==opened.mtimeNs||current.ctimeNs!==opened.ctimeNs)throw Error('recovery record changed');
   return bytes.subarray(0,used).toString('utf8');
  }finally{io.closeSync(fd);}
}
// macOS only. A guardian killed mid-task leaves its state file reading
// "active". That alone is not evidence of held input: the input worker records
// each press in the ledger before posting it and clears it after the release
// (AxonHost.swift, MacInputLedger.record). "active"
// is accepted only when every actor the old task recorded is gone and the
// ledger is a plain, single-link, readable file holding the empty ledger, which
// is the evidence the Windows guardian relies on (no held input, all workers
// exited). Settling still only writes an ordinary "stopped" for a human re-arm;
// it never resumes the old task or lets a queued action run.
//
// "Gone" for an actor with a recorded start time: no process at that pid, or a
// live process at that pid that provably started at another time (pid reuse).
// An actor with no recorded start time (the controller, record children) must
// have no process at that pid at all. Anything unreadable fails closed.
export function macProcessStartSeconds(pid){
 // etime is relative, so time zone and daylight-saving changes cannot skew it.
 try{
  const result=spawnSync('/bin/ps',['-o','etime=','-p',String(pid)],{encoding:'utf8',timeout:2000,env:{LC_ALL:'C',PATH:'/usr/bin:/bin'}});
  const m=/^\s*(?:(?:(\d+)-)?(\d{1,2}):)?(\d{1,2}):(\d{2})\s*$/.exec(result.stdout||'');
  if(result.status!==0||!m)return null;
  const elapsed=((Number(m[1]||0)*24+Number(m[2]||0))*60+Number(m[3]))*60+Number(m[4]);
  return Date.now()/1000-elapsed;
 }catch{return null;}
}
const START_TOLERANCE_S=2;
function macActorGone(pid,recordedStart,{probe,startOf}){
 if(!Number.isSafeInteger(pid)||pid<=0||pid>4294967295)return false;
 try{probe(pid,0);}catch(error){if(error.code==='ESRCH')return true;if(error.code!=='EPERM')return false;}
 if(typeof recordedStart!=='number'||!Number.isFinite(recordedStart))return false;
 const live=startOf(pid);if(typeof live!=='number'||!Number.isFinite(live))return false;
 return Math.abs(live-recordedStart)>START_TOLERANCE_S;
}
const startText=/^([1-9][0-9]{0,19}(?:\.[0-9]{1,9})?)$/;
export function priorMacActiveActorsGone(directory,record,{probe=process.kill,startOf=macProcessStartSeconds,io=fs}={}){
 try{
  const guard=path.join(directory,record.guard),parent=Number(/^guard-(\d+)-/.exec(record.guard)[1]);
  const missing=file=>{try{io.lstatSync(file);return false;}catch(error){if(error.code==='ENOENT')return true;throw error;}};
  const actors=[[parent,null],...record.children.map(pid=>[pid,null])];
  // The guardian wrote the "active" state, so its identity marker must exist.
  const guardian=/^([1-9][0-9]{0,9})\|([1-9][0-9]{0,19}(?:\.[0-9]{1,9})?)$/.exec(readRecoveryFile(guard+'.guardian',128,io));if(!guardian)return false;
  actors.push([Number(guardian[1]),Number(guardian[2])]);
  if(!missing(guard+'.watchdog')){const m=/^([1-9][0-9]{0,9})\|([1-9][0-9]{0,19}(?:\.[0-9]{1,9})?)$/.exec(readRecoveryFile(guard+'.watchdog',128,io));if(!m)return false;actors.push([Number(m[1]),Number(m[2])]);}
  else if(record.watchdogs_complete===true&&record.dispatched===true)return false;
  if(!missing(guard+'.workers'))for(const line of readRecoveryFile(guard+'.workers',4096,io).split(/\r?\n/).filter(Boolean)){const m=/^([1-9][0-9]{0,9}):([1-9][0-9]{0,19}(?:\.[0-9]{1,9})?)$/.exec(line);if(!m)return false;actors.push([Number(m[1]),Number(m[2])]);}
  const prefix=record.guard+'.worker-';
  for(const name of io.readdirSync(directory)){
   if(!name.startsWith(prefix))continue;
   const m=/^([1-9][0-9]{0,9})$/.exec(name.slice(prefix.length)),start=startText.exec(readRecoveryFile(path.join(directory,name),128,io).trim());
   if(!m||!start)return false;actors.push([Number(m[1]),Number(start[1])]);
  }
  const allGone=()=>actors.every(([pid,start])=>macActorGone(pid,start,{probe,startOf}));
  return allGone();
 }catch{return false;}
}
function macActiveStateSettles(directory,record,fields,options){
 // Six or seven fields and no cleanup pending, as for idle or stopped.
 return fields[0]==='active'&&[6,7].includes(fields.length)&&fields[5]==='0'&&priorMacActiveActorsGone(directory,record,options);
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
export function priorMacCleanupVerified(directory,record,{platform=process.platform,probe=process.kill,startOf=macProcessStartSeconds,io=fs}={}){
 if(platform!=='darwin'||record?.dispatched!==true||record.watchdogs_complete!==true||!Array.isArray(record.children)||record.children.length<3||typeof record.guard!=='string'||!/^guard-[1-9][0-9]{0,9}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.state$/.test(record.guard))return false;
 const read=(file,limit)=>readRecoveryFile(file,limit,io);
 const gone=pid=>{if(!Number.isSafeInteger(pid)||pid<=0||pid>4294967295)return false;try{probe(pid,0);return false;}catch(error){return error.code==='ESRCH';}};
 try{
  const guard=path.join(directory,record.guard),parent=Number(/^guard-(\d+)-/.exec(record.guard)[1]);
  const watchdog=/^([1-9][0-9]{0,9})\|([1-9][0-9]{0,19}(?:\.[0-9]{1,9})?)$/.exec(read(guard+'.watchdog',128));if(!watchdog||!record.children.includes(Number(watchdog[1])))return false;
  const pids=[parent,...record.children,Number(watchdog[1])];if(!pids.every(gone))return false;
  // Six fields, or seven when the guardian records click-tier grants.
  const fields=read(guard,4096).split('|');if(![6,7].includes(fields.length)||fields[5]!=='0')return false;
  if(!['idle','stopped'].includes(fields[0])&&!macActiveStateSettles(directory,record,fields,{probe,startOf,io}))return false;
  const ledger=JSON.parse(read(guard+'.inputs',65536));
  if(!ledger||typeof ledger!=='object'||Array.isArray(ledger)||Object.keys(ledger).sort().join(',')!=='buttons,keys'||!Array.isArray(ledger.keys)||ledger.keys.length!==0||!Array.isArray(ledger.buttons)||ledger.buttons.length!==0)return false;
  return pids.every(gone);
 }catch{return false;}
}
// A task that was opened but never reached recordDispatch() started no native
// input worker: recordDispatch() persists dispatched:true before every driver
// input call. That is positive evidence only when the record says so
// explicitly, no worker identity was recorded, the controller that owned the
// record is gone, and its input ledger is the platform's empty ledger.
export function priorUndispatchedCleanupVerified(directory,record,{platform=process.platform,probe=process.kill,startOf=macProcessStartSeconds,io=fs}={}){
 if(!['win32','darwin'].includes(platform)||record?.open!==true||record.dispatched!==false||!Array.isArray(record.children)||record.children.length!==0||typeof record.guard!=='string'||!/^guard-[1-9][0-9]{0,9}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.state$/.test(record.guard))return false;
 const gone=pid=>{if(!Number.isSafeInteger(pid)||pid<=0||pid>4294967295)return false;try{probe(pid,0);return false;}catch(error){return error.code==='ESRCH';}};
 try{
  const guard=path.join(directory,record.guard),parent=Number(/^guard-(\d+)-/.exec(record.guard)[1]);
  if(!gone(parent))return false;
  const fields=readRecoveryFile(guard,4096,io).split('|');if(fields.length<4)return false;
  if(!['idle','stopped'].includes(fields[0])&&!(platform==='darwin'&&macActiveStateSettles(directory,record,fields,{probe,startOf,io})))return false;
  const ledger=readRecoveryFile(guard+'.inputs',65536,io);
  if(platform==='win32'){if(ledger!=='')return false;}
  else{const value=JSON.parse(ledger);if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='buttons,keys'||value.keys.length!==0||value.buttons.length!==0)return false;}
  return gone(parent);
 }catch{return false;}
}
// Pre-dispatch calls (ready, apps, grant) can start a cursor watchdog or input
// workers before recordDispatch() records any identity. Settling Stop for an
// undispatched task additionally requires every actor named by the old guard's
// markers to be gone. A marker that exists but cannot be read fails closed.
export function priorUndispatchedActorsGone(directory,record,{probe=process.kill,io=fs}={}){
 const gone=pid=>{if(!Number.isSafeInteger(pid)||pid<=0||pid>4294967295)return false;try{probe(pid,0);return false;}catch(error){return error.code==='ESRCH';}};
 try{
  const guard=path.join(directory,record.guard),missing=file=>{try{io.lstatSync(file);return false;}catch(error){if(error.code==='ENOENT')return true;throw error;}};
  if(!missing(guard+'.watchdog')){const m=/^([1-9][0-9]{0,9})\|[1-9][0-9]{0,19}(?:\.[0-9]{1,9})?$/.exec(readRecoveryFile(guard+'.watchdog',128,io));if(!m||!gone(Number(m[1])))return false;}
  if(!missing(guard+'.workers'))for(const line of readRecoveryFile(guard+'.workers',4096,io).split(/\r?\n/).filter(Boolean)){const m=/^([1-9][0-9]{0,9}):[1-9][0-9]{0,19}$/.exec(line);if(!m||!gone(Number(m[1])))return false;}
  return true;
 }catch{return false;}
}
// operation is the tool name (for example computer_file_dialog) when known; it
// only refines advice for refusals that sent no input.
export function recoveryAdvice(result,operation){
 const code=result.error?.code||result.verification_error?.code;
 const extra={
  ...(result.repeated_failure===true?{repeated_failure:true}:{}),
  ...(Number.isSafeInteger(result.recovery_attempts_remaining)?{recovery_attempts_remaining:result.recovery_attempts_remaining}:{})
 };
 if(['input_cleanup_failed','guardian_end_unconfirmed','guardian_stop_unconfirmed','stop_cleanup_unverified'].includes(code))return {...extra,next_action:'inspect_input_cleanup',replay_allowed:false};
 if(result.delivery_unknown===true||result.input_completed===true&&code||code==='input_outcome_unknown')return {...extra,next_action:'inspect_effect_without_replay',replay_allowed:false};
 if(['wait_failure_observed','wait_observation_incomplete','wait_observation_timeout','wait_condition_timeout','wait_change_timeout','op_timeout','capture_preparation_timeout'].includes(code))return {...extra,next_action:'inspect_effect_without_replay',replay_allowed:false};
 if(code==='wait_label_not_observed'&&typeof result.metadata?.observation_id==='string')return {...extra,next_action:'use_returned_frame',replay_allowed:false};
 if(['stale_observation','element_stale','window_moved','no_image','control_changed','focus_changed','wait_label_not_observed','window_not_responding'].includes(code))return {...extra,next_action:'observe_again',replay_allowed:false};
 if(['window_minimized','window_hidden','window_capture_unavailable'].includes(code))return {...extra,next_action:result.repeated_failure===true?'await_human_window_recovery':'focus_target_then_observe',replay_allowed:false};
 if(code==='other_desktop')return {...extra,next_action:'await_human_space_switch',replay_allowed:false};
 if(code==='window_fullscreen')return {...extra,next_action:'await_human_fullscreen_exit',replay_allowed:false};
 if(['identity_changed','window_not_found','ambiguous_selector'].includes(code))return {...extra,next_action:'discover_apps_then_observe',replay_allowed:false};
 if(['mac_permissions_required','accessibility_denied'].includes(code))return {...extra,next_action:'await_human_permission_grant',replay_allowed:false};
 if(code==='desktop_context_unavailable')return {...extra,next_action:'human_start_on_visible_desktop',replay_allowed:false};
 if(code==='input_lease_held')return {...extra,next_action:'human_close_other_copy',replay_allowed:false};
 if(code==='version_mismatch')return {...extra,next_action:'resolve_version_mismatch',replay_allowed:false};
 if(code==='recovered_task_requires_end')return {...extra,next_action:'inspect_recovered_task',replay_allowed:false};
 if(code==='global_stop_latched')return {...extra,next_action:'inspect_owner_stop',replay_allowed:false};
 if(code==='global_owner_unverified')return {...extra,next_action:'inspect_prior_input_cleanup',replay_allowed:false};
 if(code==='legacy_controller_running')return {...extra,next_action:'await_legacy_owner_shutdown',replay_allowed:false};
 if(code==='task_required')return {...extra,next_action:'ready_then_use_task_token',replay_allowed:false};
 if(code==='task_requires_end')return {...extra,next_action:'end_owned_task_then_shutdown',replay_allowed:false};
 if(['another_session_busy','cleanup_in_progress','task_owned'].includes(code))return {...extra,next_action:'wait_for_controller_then_observe',replay_allowed:false};
 if(code==='session_limit')return {...extra,next_action:'renew_task_and_continue',replay_allowed:false};
 if(code==='native_latch_still_enforced')return {...extra,next_action:'native_update_required',replay_allowed:false};
 if(['recovered_cleanup_unverified','input_lease_stale'].includes(code))return {...extra,next_action:'inspect_prior_input_cleanup',replay_allowed:false};
 if(['stop_persistence_failed','guard_persistence_failed'].includes(code))return {...extra,next_action:'inspect_stop_persistence_without_restart',replay_allowed:false};
 if(['permission_denied','approval_timeout','confirmation_required'].includes(code))return {...extra,next_action:'await_user_decision',replay_allowed:false};
 if(code==='control_stopped')return {...extra,next_action:'report_and_wait_for_human',replay_allowed:false};
 if(code==='control_inactive')return {...extra,next_action:'inspect_status_then_human_controls',replay_allowed:false};
 // Ordinary refusals raised before the input they guard. Any reply where input
 // already ran returned inspect_effect_without_replay above.
 if(code==='obscured')return {...extra,next_action:'observe_and_retarget',replay_allowed:false};
 if(['bad_points','points_unsupported'].includes(code))return {...extra,next_action:'fix_drag_points',replay_allowed:false};
 if(code==='invalid_application')return {...extra,next_action:'fix_app_path',replay_allowed:false};
 if(code==='capture_changed')return {...extra,next_action:'observe_again',replay_allowed:false};
 if(code==='window_capture_unavailable')return {...extra,next_action:'focus_target_then_observe',replay_allowed:false};
 if(code==='no_file_dialog')return {...extra,next_action:'observe_app_no_picker',replay_allowed:false};
 if(code==='clipboard_unsafe')return {...extra,next_action:operation==='computer_file_dialog'?'retry_file_dialog_with_keyboard':'enter_without_clipboard',replay_allowed:false};
 // Refused before anything was sent: a flag, selector or path the agent can fix.
 // replay_allowed stays true only here, because nothing reached the desktop.
 // A batch that already sent earlier steps must not be replayed whole; resume after failed_index.
 if(FIXABLE_CODES.has(code))return Array.isArray(result.completed)&&result.completed.length?{...extra,next_action:'fix_arguments_and_resume_after_completed',replay_allowed:false}:{...extra,next_action:'fix_arguments_and_retry',replay_allowed:true};
 if(POLICY_BLOCK_CODES.has(code))return {...extra,next_action:'choose_permitted_target',replay_allowed:false};
 if(['needs_confirmation','hand_off_required','model_approval_forbidden'].includes(code))return {...extra,next_action:'await_user_decision',replay_allowed:false};
 if(code==='desktop_locked')return {...extra,next_action:'await_human_unlock',replay_allowed:false};
 if(code==='update_in_progress')return {...extra,next_action:'wait_for_update',replay_allowed:false};
 if(code==='operation_pending')return {...extra,next_action:'wait_for_pending_operation',replay_allowed:false};
 if(code==='session_unavailable')return {...extra,next_action:'human_restart_controller',replay_allowed:false};
 if(code==='launch_failed')return {...extra,next_action:'fix_app_path',replay_allowed:false};
 if(['launch_timeout','no_foreground'].includes(code))return {...extra,next_action:'discover_apps_then_observe',replay_allowed:false};
 if(['index_out_of_range','bad_observed_target','invalid_observation'].includes(code))return {...extra,next_action:'observe_again',replay_allowed:false};
 return {...extra,next_action:'inspect_diagnostics',replay_allowed:false};
}
const FIXABLE_CODES=new Set('bad_arguments bad_point bad_selector bad_text bad_wait bad_files bad_path invalid_steps no_steps too_many_steps text_limit not_text file_too_large is_directory no_app no_target no_window unsupported_action unknown_command invalid_feedback'.split(' '));
const POLICY_BLOCK_CODES=new Set('protected_app app_blocked open_blocked key_blocked self_window blocked_on_screen app_tier_read app_tier_click'.split(' '));
