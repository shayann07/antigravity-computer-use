// Antigravity adapter over the MIT ridelink native host and input-lease implementation.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Driver,HostError} from './driver.mjs';
import {Guardian} from './guardian.mjs';
import {Sessions} from './sessions.mjs';
import {dataDir} from './build.mjs';
import {classify,TIER} from './policy.mjs';
import {renderSnapshot,subtreeNodes} from './render.mjs';
import {targetImageSize} from './upstream-utils.mjs';
import {VERSION,BUILD_ID} from './version.mjs';
import {storageOperation} from './storage.mjs';
import {contract,nativePlatform,launchTarget,executableKey} from './platform.mjs';
import {Incidents} from './incidents.mjs';
import {updateNotice} from './update-notice.mjs';
import {persistRecoveryStop,settlePriorStop,recoveryAdvice,priorWindowsCleanupVerified,priorMacCleanupVerified,readStopLatch,persistStopLatch,settleFreshStopLatch} from './recovery.mjs';
import {writeAtomicJSON,readTaskRecord} from './atomic-json.mjs';

const input=new Set(['move','click','type','set_value','key','scroll','drag','focus','fit_window','close_window','paste','paste_files','clipboard','open','file_dialog']);
const fail=(code,message)=>{throw new HostError(code,message,null);};
export async function waitUntil(target,{now=()=>performance.now(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),check=()=>{}}={}){
  // Node timers may wake before a fractional deadline. Do not start another
  // expensive poll until the intended delay has actually elapsed.
  while(true){const remaining=target-now();if(remaining<=0)return;await sleep(Math.min(100,Math.max(1,Math.ceil(remaining))));check();}
}
function waitFailure(observation,labels){
  if(!labels?.length)return undefined;
  const tree=String(observation.metadata.tree||'').toLowerCase();
  // Search captured text before renderer shortening or row pruning too. Only
  // return the caller's label, never additional app text from hidden rows.
  const fields=(observation.metadata.elements||[]).flatMap(node=>[node.name,node.text,typeof node.state?.value==='string'?node.state.value:null]).filter(value=>typeof value==='string').map(value=>value.toLowerCase());
  return (labels||[]).find(label=>{const needle=label.toLowerCase();return tree.includes(needle)||fields.some(value=>value.includes(needle));});
}
function attachWaitMetrics(error,started,budget,observations){
  if(error&&typeof error==='object')try{error.wait_metrics={elapsed_ms:Math.round(performance.now()-started),observations,polling_budget_ms:budget};}catch{}
  return error;
}
const persistenceFailure=reason=>['stop_persistence_failed','guard_persistence_failed'].includes(reason);
function initializeInputLedger(guardFile){
  const ledger=guardFile+'.inputs';let fd;
  try{fd=fs.openSync(ledger,'wx',0o600);fs.writeFileSync(fd,process.platform==='darwin'?'{"keys":[],"buttons":[]}':'');fs.fsyncSync(fd);}
  catch(error){
    if(error.code!=='EEXIST')throw error;const info=fs.lstatSync(ledger);if(!info.isFile()||info.isSymbolicLink()||info.size>65536)throw error;
    const content=fs.readFileSync(ledger,'utf8');
    if(process.platform==='darwin'){const value=JSON.parse(content);if(!Array.isArray(value?.keys)||!Array.isArray(value?.buttons)||value.keys.length||value.buttons.length)throw error;}
    else if(content!=='')throw error;
    const existing=fs.openSync(ledger,'r+');try{fs.fsyncSync(existing);}finally{fs.closeSync(existing);}
  }finally{if(fd!==undefined)fs.closeSync(fd);}
}
export function savedTakeoverMode(file,fallback){
  try {const mode=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')).takeover_mode;if(['manual','smart'].includes(mode))return mode;}catch{}
  return fallback;
}
export function appKey(w,platform=process.platform){return `${w.pid}:${w.started}:${executableKey(w.path,platform)}`;}
export function requireObservation(map,id,hwnd,now=Date.now(),monoNow=performance.now()){
  const frame=map.get(id);map.delete(id);
  const age=frame?now-frame.at:NaN;
  const monoAge=frame&&Object.hasOwn(frame,'atMono')?monoNow-frame.atMono:null;
  if(!frame||frame.hwnd!==Number(hwnd)||!Number.isFinite(frame.at)||!Number.isFinite(age)||age<0||age>contract.frame_ms||
     (monoAge!==null&&(!Number.isFinite(frame.atMono)||!Number.isFinite(monoAge)||monoAge<0||monoAge>contract.frame_ms)))fail('stale_observation','Observe again: missing, consumed or stale observation.');
  return frame;
}
export function imagePoint(image,x,y){
  if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=image.width||y>=image.height)fail('bad_point','Point is outside the screenshot.');
  const r=image.source;
  return [r[0]+Math.floor(x*r[2]/image.width),r[1]+Math.floor(y*r[3]/image.height)];
}

// Snapshot IDs and row indexes are observation-scoped transport handles, not
// visible content. Mac can renumber unchanged controls on the next capture.
export function comparableView(tree){
 const space=typeof tree==='string'?tree.indexOf(' '):-1;
 if(space<0)fail('invalid_observation','The observed tree cannot be compared. Take a fresh snapshot.');
 return tree.slice(space+1).replace(/^(\[)\d+(\])/gm,'$1#$2').replace(/(\| focus \[)\d+(\])/,'$1#$2');
}

// Keep the controls belonging to a matching named section. Returning only its
// label made "Export format" hide PNG/JPEG and forced another full-tree read.
// Reuse the foundation's bounded, depth-first subtree traversal; all indexes
// still come from this same observation and retain their offscreen state.
export function queryNodes(nodes,query){
 const needle=String(query||'').trim().toLowerCase();if(!needle)return nodes;
 const selected=new Set();
 for(const node of nodes){
  if(![node.name,node.text,node.value,node.role].some(v=>String(v??'').toLowerCase().includes(needle)))continue;
  const context=Number.isInteger(node.depth)&&node.depth>=0?subtreeNodes(nodes,node.i):null;
  for(const entry of context||[node])selected.add(entry.i);
 }
 return nodes.filter(node=>selected.has(node.i));
}

export function observedIndex(elements,selector){
 const fields=['name','role','automation_id'].filter(k=>Object.hasOwn(selector,k));
 if(!fields.length||fields.some(k=>typeof selector[k]!=='string'||!selector[k].trim()||selector[k].length>1000))fail('bad_selector','Supply a nonempty exact observed name, role or automation_id.');
 const matches=(elements||[]).filter(node=>fields.every(key=>String(key==='automation_id'?(node.aid??node.automation_id??''):(node[key]??''))===selector[key]));
 if(matches.length!==1)fail(matches.length?'ambiguous_observed_target':'target_not_observed',matches.length?'Several controls match that exact name/role/id. Inspect and select an index.':'No control in this observation matches that exact name/role/id. Observe the relevant section; no input was sent.');
 if(!Number.isSafeInteger(matches[0].i)||matches[0].i<0)fail('bad_observed_target','The observed control has no valid native index. Observe again; no input was sent.');
 return matches[0].i;
}

export class Runtime {
  constructor({driver=null,guardian=null,sessions=null,latchFile=undefined,taskFile=undefined,permissionMode=process.env.AGCU_PERMISSION_MODE||'standalone',takeoverMode=process.env.AGCU_TAKEOVER_MODE||'manual'}={}){
    if(!['standalone','host-managed'].includes(permissionMode))throw new Error('Invalid startup permission mode');
    this.permissionMode=permissionMode;
    if(!['manual','smart'].includes(takeoverMode))throw new Error('Invalid startup takeover mode');this.takeoverMode=takeoverMode;
    this.privateDataStorage=null;
    if(!driver&&!guardian)this.privateDataStorage=storageOperation('data',dataDir()).private_storage===true;
    else fs.mkdirSync(dataDir(),{recursive:true}); // inert unit-test dependencies
    this.latchFile=latchFile===undefined?(!driver&&!guardian?path.join(dataDir(),'emergency.stop'):null):latchFile;
    this.taskFile=taskFile===undefined?(!driver&&!guardian?path.join(dataDir(),'task-state.json'):null):taskFile;
    const prior=this.taskFile?readTaskRecord(this.taskFile):{open:false,guard:null};const priorTask=prior.open;
    this.guardFile=path.join(dataDir(),`guard-${process.pid}-${randomUUID()}.state`);
    fs.writeFileSync(this.guardFile,'idle||0|',{mode:0o600});
    // Human controls may start before an agent calls ready. Ensure their native
    // cleanup checks have an explicit empty ledger even in a passive session.
    if(!driver&&!guardian)initializeInputLedger(this.guardFile);
    const env={AGCU_GUARD_FILE:this.guardFile,AGCU_CONTRACT_FILE:fileURLToPath(new URL('./control-contract.json',import.meta.url)),AGCU_STOP_LATCH:this.latchFile||'',AGCU_PARENT_PID:String(process.pid),AGCU_PERMISSION_MODE:permissionMode,AGCU_TAKEOVER_MODE:takeoverMode,AGCU_REAL_CURSOR:'1',CU_OVERLAY:'off',CU_PRESENCE:'off',CU_MODE:'take'};
    this.driver=driver||new Driver({env,onEvent:event=>{if(event.event==='input_cleanup_failed')this.stop().catch(()=>{});}});this.guardian=guardian||new Guardian(env);
    this.sessions=sessions||new Sessions({sessionId:randomUUID(),onInputLeaseLost:()=>this.stop().catch(()=>{})});this.sessions.register();
    this.grants=new Map();this.frames=new Map();this.generation=0;this.state='idle';this.token='';this.taskOpen=priorTask;this.recoveredTask=priorTask;this.priorGuard=priorTask?prior.guard:null;this.priorChildren=priorTask?prior.children:null;this.priorDispatched=priorTask?prior.dispatched:null;this.priorWatchdogsComplete=priorTask?prior.watchdogs_complete:null;this.dispatchChildren=[];this.dispatchStarted=false;this.watchdogsComplete=true;this.taskDurable=true;this.remaining=contract.action_budget;
    this.lastControlReason='';
    if(this.latchFile){
      const saved=readStopLatch(this.latchFile);if(saved){this.state='stopped';
        this.lastControlReason=saved.unconfirmed?'guardian_stop_unconfirmed':saved.value==='stopped'?'persisted_emergency_stop':'stop_persistence_failed';
      }
    }
    this.guardian.on('state',(s,reason)=>{
      const previousState=this.state;
      // A delayed idle/active notification must never undo an emergency Stop.
      // Native human re-arm is acknowledged separately by the resume event.
      if(previousState==='stopped'&&s!=='stopped')return;
      // A late, uncorrelated stopped event cannot prove that the Stop we just
      // attempted reached the native guardian. Preserve the uncertain state.
      const priorStopUnconfirmed=previousState==='stopped'&&this.lastControlReason==='guardian_stop_unconfirmed';
      if((reason||s!==this.state)&&(!priorStopUnconfirmed||persistenceFailure(reason)))this.lastControlReason=reason||s;
      this.state=s;
      if((reason==='guardian_exited'&&previousState!=='idle'||reason==='guardian_unresponsive')&&this.latchFile)try{persistRecoveryStop(this.latchFile,this.recoveredTask&&this.priorGuard?this.priorGuard:path.basename(this.guardFile),{unconfirmed:reason==='guardian_unresponsive'||priorStopUnconfirmed});}catch{}
      if(s==='stopped'&&this.latchFile){try{const latch=readStopLatch(this.latchFile);if(!latch||latch.value!=='stopped'&&!latch.unconfirmed)throw Error('invalid latch');if(latch.unconfirmed&&!persistenceFailure(reason))this.lastControlReason='guardian_stop_unconfirmed';}catch{this.lastControlReason='stop_persistence_failed';this.diagnosticError='stop_persistence_failed';}}
      if(reason==='guardian_unresponsive'&&!persistenceFailure(this.lastControlReason))this.lastControlReason='guardian_stop_unconfirmed';
      if(reason==='guardian_exited'&&this.privateDataStorage===true)new Incidents(dataDir()).recordSerialized('computer_guardian',{state:s,error:{code:'guardian_exited'},guardian_exit:this.guardian.lastExit}).catch(()=>{this.diagnosticError='private_diagnostic_storage_unavailable';});
      if(s!=='active'){
        this.generation++;this.frames.clear();
        if(s==='stopped'||s==='idle'){this.grants.clear();this.token='';}
        if(s==='stopped'||s==='paused')this.driver.abort?.().catch(()=>{});
      }
    });
    this.guardian.on('resume',(_state,source)=>{
      if(this.state==='stopped'){
        if(source!=='human_resume'||_state!=='idle'||persistenceFailure(this.lastControlReason)||this.lastControlReason==='guardian_stop_unconfirmed')return;
        if(this.latchFile&&readStopLatch(this.latchFile))return;
        this.state='idle';
      }
      this.frames.clear();this.lastControlReason=source==='host_resume'?'host_authorized_resume':'human_resume';if(this.state==='active')this.deadline=Date.now()+contract.session_ms;
    });
  }
  stamp(){return {__session:this.token};}
  beginTask(){
    if(this.finishing)fail('cleanup_in_progress','Task cleanup is still pending. Wait for its result before starting another task.');
    if(this.taskOpen&&this.taskDurable)return;
    this.taskOpen=true;this.taskDurable=false;
    try{
      if(this.taskFile){
        // An empty native ledger is evidence that a task that only moved the
        // pointer has no recorded held inputs. Never overwrite an existing one.
        initializeInputLedger(this.guardFile);
        writeAtomicJSON(this.taskFile,{schema:1,open:true,guard:path.basename(this.guardFile),children:this.dispatchChildren,dispatched:this.dispatchStarted,watchdogs_complete:this.watchdogsComplete});
      }
      this.taskDurable=true;
    }
    catch{throw Object.assign(Error('Cannot preserve task state; no desktop action was started.'),{code:'task_state_write_failed'});}
  }
  recordDispatch(){
    if(!this.taskFile)return; // Inert unit-test dependencies use no persistent task.
    const ids=[this.guardian.pid,this.driver.info?.pid];
    if(ids.some(pid=>!Number.isSafeInteger(pid)||pid<=0||pid>4294967295))fail('task_process_identity_unavailable','Native process identity is unavailable; no input was sent.');
    let watchdog;
    try{const file=this.guardFile+'.watchdog',info=fs.lstatSync(file);if(!info.isFile()||info.isSymbolicLink()||info.size>128)throw Error();const m=/^([1-9][0-9]{0,9})\|([1-9][0-9]{0,19}(?:\.[0-9]{1,9})?)$/.exec(fs.readFileSync(file,'utf8'));if(!m)throw Error();watchdog=Number(m[1]);if(!Number.isSafeInteger(watchdog)||watchdog>4294967295)throw Error();}catch{watchdog=null;}
    const coverage=this.watchdogsComplete&&watchdog!=null;
    const children=[...new Set([...this.dispatchChildren,...ids,...(watchdog==null?[]:[watchdog])])];
    if(children.length>32)fail('task_process_limit','Too many native worker changes in this task. End safely before starting another.');
    if(this.dispatchStarted&&children.length===this.dispatchChildren.length&&coverage===this.watchdogsComplete)return;
    try{writeAtomicJSON(this.taskFile,{schema:1,open:true,guard:path.basename(this.guardFile),children,dispatched:true,watchdogs_complete:coverage});}
    catch{fail('task_state_write_failed','Could not record native process identities; no input was sent.');}
    this.dispatchChildren=children;this.dispatchStarted=true;this.watchdogsComplete=coverage;
  }
  // A passive App sidecar must not open a HUD, install input hooks or acquire
  // cursor ownership just because a previous task left an emergency latch.
  async prepare(){}
  async showControls(){
    if(this.recoveredTask)fail('recovered_cleanup_unverified','A previous task survived restart. Verify its native input cleanup before showing controls or re-arming. Do not replay the interrupted action.');
    if(this.state==='stopped'&&this.lastControlReason==='guardian_stop_unconfirmed')fail('guardian_stop_unconfirmed','Native Stop delivery is unconfirmed. Inspect diagnostics and input cleanup before showing controls; do not re-arm or replay.');
    if(this.state==='stopped'&&persistenceFailure(this.lastControlReason))fail(this.lastControlReason,'Control storage failed. Inspect private storage before showing controls; do not re-arm.');
    const result=await this.guardian.request({op:'show_controls'});if(result.controls_visible===true)this.recoveryFailure=null;return result;
  }
  async ready(){
    Runtime.prototype.beginTask.call(this);
    if(this.state==='stopped'&&this.lastControlReason==='guardian_stop_unconfirmed'&&this.driver?.inputMayBeHeld===true)return {...this.status(),ready:false,controls_visible:null,next_action:'inspect_input_cleanup',replay_allowed:false,error:{code:'input_cleanup_failed',message:'Input cleanup and native Stop delivery are unconfirmed. Inspect diagnostics; do not restart, re-arm or replay.'}};
    if(this.state==='stopped'&&this.lastControlReason==='guardian_stop_unconfirmed')return {...this.status(),ready:false,controls_visible:null,next_action:'inspect_diagnostics',replay_allowed:false,error:{code:'guardian_stop_unconfirmed',message:'Stop delivery to native controls is unconfirmed. Inspect diagnostics and input cleanup; do not restart, re-arm or replay.'}};
    if(this.state==='stopped'&&persistenceFailure(this.lastControlReason))return {...this.status(),ready:false,controls_visible:null,next_action:'inspect_stop_persistence_without_restart',replay_allowed:false,error:{code:this.lastControlReason,message:'Control is stopped because native control storage failed. Inspect private storage; do not restart or send input.'}};
    // A replacement process cannot use its own empty ledger as evidence that
    // the previous process released input. Do not lead the agent toward re-arm
    // or start a new guardian before the recovered task has passed cleanup.
    if(this.recoveredTask)return {...this.status(),ready:false,controls_visible:null,next_action:'inspect_prior_input_cleanup',replay_allowed:false,error:{code:'recovered_cleanup_unverified',message:'A previous task survived restart. Inspect its result without replay and verify its native input cleanup before re-arm or a new task.'}};
    const unavailable=()=>({...this.status(),ready:false,controls_visible:this.recoveryVisibility??null,guardian_running:!!this.guardian.proc&&!this.guardian.proc.killed,guardian_exit:this.guardian.lastExit??null,...recoveryAdvice({error:this.recoveryFailure}),error:this.recoveryFailure});
    if(this.recoveryFailure)return unavailable();
    let controls;
    try{
      controls=await this.showControls();
      if(controls.error)throw Object.assign(Error(controls.error.message),{code:controls.error.code});
      if(['idle','active','paused','stopped'].includes(controls.state)&&!(this.state==='stopped'&&controls.state!=='stopped'))this.state=controls.state;
      if(this.state!=='stopped')try{Runtime.prototype.enforceStopLatch.call(this);}catch(error){if(error.code!=='control_stopped')throw error;}
      if(this.state==='stopped'&&persistenceFailure(this.lastControlReason))return {...this.status(),ready:false,controls_visible:controls.controls_visible??null,next_action:'inspect_stop_persistence_without_restart',replay_allowed:false,error:{code:this.lastControlReason,message:'Control is stopped because native control storage failed. Inspect private storage; do not restart or send input.'}};
      const visible=controls.controls_visible===true;
      if(!visible)throw Object.assign(Error('Local controls did not report a visible bar.'),{code:'guardian_controls_not_visible'});
      return {...this.status(),update_notice:updateNotice(dataDir()),ready:visible&&this.state!=='stopped'&&this.state!=='paused'&&!this.recoveredTask,controls_visible:visible,desktop_context:controls.desktop_context,guardian_running:!!this.guardian.proc,guardian_exit:this.guardian.lastExit??null,
        next_action:this.state==='stopped'?(this.lastControlReason==='input_cleanup_failed'||this.driver?.inputMayBeHeld===true?'inspect_input_cleanup':'awaiting_human_rearm'):this.state==='paused'?'awaiting_human_resume':this.recoveredTask?'inspect_recovered_task':'discover_or_launch'};
    }catch(error){this.recoveryVisibility=controls?.controls_visible===false?false:null;this.recoveryFailure={code:error.code||'guardian_unavailable',message:error.code==='desktop_context_unavailable'?'Start the installed local launcher on the visible desktop. No desktop was switched and Stop remains latched.':'Local controls failed to start. Run diagnostics; do not repeat launch commands.'};return unavailable();}
  }
  enforceStopLatch(){
    if(this.latchFile){const latch=readStopLatch(this.latchFile);if(latch){this.stop().catch(()=>{});if(latch.invalid)fail('stop_persistence_failed','Cannot verify the emergency Stop latch; no input was sent.');fail('control_stopped','Emergency Stop remains latched; local human re-arm is required.');}}
  }
  check(){
    if(this.state!=='active')fail('control_inactive',`Control is ${this.state}. Use the local Resume/Re-arm control or request a new grant.`);
    Runtime.prototype.enforceStopLatch.call(this);
  }
  async identity(hwnd){
    if(!Number.isSafeInteger(Number(hwnd))||Number(hwnd)<=0)fail('no_target','Select an HWND from computer_apps.');
    return (await this.driver.call('identity',{hwnd:Number(hwnd)})).result;
  }
  async app(hwnd){
    const handle=Number(hwnd);
    const stale=(this.staleHandles??=new Set());
    const known=(this.knownWindows??=new Map());
    const failures=(this.windowFailures??=new Map());
    if(stale.has(handle)){
      throw Object.assign(Error('Repeated poll of stale window handle refused. Run apps once to discover current windows; do not poll the stale handle.'),{code:'identity_changed',repeated_failure:true,recovery_attempts_remaining:0});
    }
    let identity;
    try{identity=await this.identity(handle);}
    catch(error){
      const wasKnown=known.has(handle)||Array.from(this.frames?.values()||[]).some(f=>Number(f?.hwnd)===handle);
      if(error.code==='identity_changed'||(error.code==='window_not_found'&&wasKnown)){
        stale.add(handle);
        throw Object.assign(Error('Target window handle is stale because the window closed or its identity changed. Run apps once to discover current windows; do not poll the stale handle.'),{code:'identity_changed',recovery_attempts_remaining:0});
      }
      if(error.code==='window_not_found'){
        const prior=failures.get(handle);
        if(prior?.code==='window_not_found'){
          prior.attempts+=1;
          throw Object.assign(Error(error.message),{code:'window_not_found',repeated_failure:true,recovery_attempts_remaining:0});
        }
        failures.set(handle,{code:'window_not_found',attempts:1,recoverable:false,recoveryTried:true});
        throw Object.assign(Error(error.message),{code:'window_not_found',recovery_attempts_remaining:0});
      }
      throw error;
    }
    const wins=(await this.driver.call('list_apps',{include_hidden:true})).result.windows;
    const listed=wins.find(w=>Number(w.hwnd)===handle);
    if(!listed){
      if(known.has(handle)){
        stale.add(handle);
        throw Object.assign(Error('Target window handle is stale because the window closed. Run apps once to discover current windows; do not poll the stale handle.'),{code:'identity_changed',recovery_attempts_remaining:0});
      }
      fail('window_not_found','Refresh computer_apps; target closed.');
    }
    const w={...listed,...identity};
    const key=appKey(w);
    const priorKnown=known.get(handle);
    if(priorKnown&&priorKnown.key!==key){
      stale.add(handle);
      throw Object.assign(Error('Target process or window identity changed since discovery. Run apps once to discover current windows; do not poll the stale handle.'),{code:'identity_changed',recovery_attempts_remaining:0});
    }
    known.set(handle,{pid:w.pid,started:w.started,path:w.path,key});
    this.guardian.send({op:'attach',pid:this.driver.info?.pid});
    if([process.pid,process.ppid,this.driver.info?.pid,this.guardian.pid].includes(w.pid)||classify(w).tier===TIER.BLOCKED)
      fail('protected_app','This is a protected app or the control/host UI.');
    return w;
  }
  async grant(hwnd,purpose='Operate this app for the requested desktop task',{observationOnly=false}={}){
    Runtime.prototype.beginTask.call(this);
    if(this.state==='stopped'&&this.lastControlReason==='guardian_stop_unconfirmed')fail('guardian_stop_unconfirmed','Stop delivery to native controls is unconfirmed. Inspect diagnostics and input cleanup; do not restart, re-arm or replay.');
    if(this.recoveredTask&&!observationOnly)fail('recovered_task_requires_end','The controller restarted with an unfinished task. Inspect the prior result without replay, then end the owning task before new input.');
    if(this.state==='stopped'&&persistenceFailure(this.lastControlReason))fail(this.lastControlReason,'Control storage failed. Inspect private storage; do not restart or send input.');
    if(this.state==='stopped'){await this.showControls();this.check();}
    if(this.state==='paused')this.check();
    const w=await this.app(hwnd);const key=appKey(w);
    if(this.grants.has(key)&&this.state==='active'){this.check();return w;}
    const answer=await this.guardian.prompt({kind:'app',hwnd:Number(hwnd),app_pid:w.pid,host_pid:this.driver.info?.pid,
      message:`Allow this application for this session?\r\n\r\n${w.title}\r\n${w.path}\r\nPID ${w.pid}\r\n\r\nTask: ${purpose}\r\n\r\nIts screenshots and accessibility text go to Antigravity's configured model. Ordinary actions run autonomously. Consequential effects need a separate confirmation. Your real mouse/keyboard will be used. Esc or Ctrl+Alt+F12 stops. Use a disposable account/VM for important data.`});
    if(!answer.allowed)fail(answer.decision==='timeout'?'approval_timeout':'permission_denied',answer.decision==='timeout'?'Local application approval timed out.':'The human denied this application.');
    this.guardian.send({op:'attach',pid:this.driver.info?.pid});
    const current=await this.app(hwnd);if(appKey(current)!==key)fail('identity_changed','Application restarted during approval.');
    if(!this.token){this.token=randomUUID();this.deadline=Date.now()+contract.session_ms;this.remaining=contract.action_budget;}
    const activationGeneration=this.generation;
    const active=await this.guardian.request({op:'activate',token:this.token,deadline:(BigInt(this.deadline)*10000n+621355968000000000n).toString()});
    if(!active.allowed||this.state==='stopped'||this.state==='paused'||this.generation!==activationGeneration)fail('control_inactive','Control changed during activation. Use local controls and observe again.');
    this.state='active';this.check();this.grants.set(key,{...current,purpose});return current;
  }
  async observe(args){
    const w=await this.grant(Number(args.hwnd),args.reason,{observationOnly:true});this.check();
    const generation=this.generation;
    const workerEpoch=this.driver.epoch;
    if(args.settle_ms){
      await new Promise(resolve=>setTimeout(resolve,Math.min(2000,Math.max(0,args.settle_ms))));
      this.check();if(generation!==this.generation)fail('control_changed','Control changed while waiting for the UI. Observe again after authorized Resume.');
    }
    const handle=Number(args.hwnd);
    const failures=(this.windowFailures??=new Map());
    const failWindowState=(code,message,recoverable)=>{
      const prior=failures.get(handle);
      if(prior&&prior.code===code&&!prior.recoveryCleared){
        prior.attempts+=1;
        throw Object.assign(Error(`Repeated poll of unavailable window refused (${code}). ${message}`),{code,repeated_failure:true,recovery_attempts_remaining:0});
      }
      if(prior&&prior.code===code&&prior.recoveryCleared){
        prior.attempts+=1;prior.recoveryCleared=false;
        throw Object.assign(Error(`Bounded recovery did not make the window available (${code}). ${message}`),{code,repeated_failure:true,recovery_attempts_remaining:0});
      }
      failures.set(handle,{code,attempts:1,recoverable,recoveryTried:!recoverable,recoveryCleared:false});
      throw Object.assign(Error(message),{code,recovery_attempts_remaining:recoverable?1:0});
    };
    if(w.fullscreen)failWindowState('window_fullscreen','Target window is in macOS full-screen mode (a separate full-screen Space). Exit full-screen mode yourself to return the window to the normal Space, then observe again; no Space was switched.',false);
    if(w.other_desktop)failWindowState('other_desktop','Target is still running on another virtual desktop or macOS Mission Control Space. Bring that app to the current desktop/Space yourself before requesting pixels; do not relaunch or click the visible desktop.',false);
    if(w.minimized)failWindowState('window_minimized','Target is minimized. Focus it, then take a fresh observation.',true);
    if(w.hidden)failWindowState('window_hidden','Target application is hidden. Focus it once, then take a fresh observation.',true);
    if(args.require_native_budget===true&&Number.isFinite(args.native_snapshot_deadline)&&performance.now()>=args.native_snapshot_deadline)fail('wait_observation_timeout','The wait budget expired before the snapshot could start. Inspect the app; do not replay prior input.');
    this.guardian.send({op:'activity',action:'observe'});
    const metadata={...this.stamp(),hwnd:handle,__pid:w.pid,__started:w.started};
    const query=String(args.query||'').trim().toLowerCase();
    // Query the larger bounded tree before filtering; a compact reply must not
    // prevent discovery of controls late in a real application's hierarchy.
    // Recompute after grant/identity work so it cannot leave the native walk
    // with a budget calculated before a slow permission or app check.
    const walkBudget=Number.isFinite(args.native_snapshot_deadline)?Math.max(100,Math.min(process.platform==='darwin'?4000:8000,Math.floor(args.native_snapshot_deadline-performance.now()))):null;
    // A provider can block inside a single accessibility call, beyond the
    // native walk's cooperative budget. Retire the worker if that snapshot
    // exceeds the budget plus transport grace; Driver fences its replacement
    // until the old process and any held-input cleanup are confirmed.
    // Keep transport grace bounded and proportional. A full extra second per
    // observation dominates short waits and makes the caller's deadline look
    // much slower than the native walk itself.
    const tree=(await this.driver.call('snapshot',{...metadata,max_nodes:Math.min(args.max_nodes||(query?500:160),500),...(walkBudget!==null?{time_budget_ms:walkBudget}:{})},walkBudget!==null?{timeoutMs:walkBudget+100}:undefined)).result;
    const nodes=queryNodes(tree.nodes,query);
    const rowLimit=Math.min(args.max_nodes||80,500);
    // This marks known loss, not proof that every visual error is accessible.
    let treeIncomplete=!!tree.truncated||!!tree.time_budget_ms||nodes.some(n=>n.text_unread);
    const rendered=renderSnapshot(tree,{maxRows:rowLimit,textLimit:160,nodes,onCoverage:({rowsOmitted})=>{treeIncomplete||=rowsOmitted;}})
      .replaceAll('raise max_nodes or use interactive_only','use query or raise max_nodes up to 500')
      .replace(/\[~\d+ tokens\. Re-read[^\]]+\]/g,'[Use query to return matching controls, or max_nodes up to 500 for more rows.]');
    const capturedMono=performance.now();
    const response={observation_id:randomUUID(),hwnd:handle,app:w.path,at:Date.now(),tree:rendered,tree_incomplete:treeIncomplete,elements:nodes};
    let image;
    if(args.with_image!==false){
      const prepareBudget=Number.isFinite(args.native_snapshot_deadline)?Math.max(100,Math.min(8000,Math.floor(args.native_snapshot_deadline-performance.now())))+1000:null;
      try{await this.guardian.request({op:'capture'},prepareBudget!==null?{timeoutMs:prepareBudget}:undefined);}
      catch(error){if(error.code==='guardian_request_timeout')fail('capture_preparation_timeout','Capture preparation timed out; Stop was attempted but is unconfirmed. Inspect status and prior effects; do not replay input.');throw error;}
      try {
        if(args.require_native_budget===true&&Number.isFinite(args.native_snapshot_deadline)&&performance.now()>=args.native_snapshot_deadline)fail('wait_observation_timeout','The wait budget expired before the screenshot could start. Inspect the app; do not replay prior input.');
        const captureBudget=Number.isFinite(args.native_snapshot_deadline)?Math.max(100,Math.min(8000,Math.floor(args.native_snapshot_deadline-performance.now()))):null;
        const needsOcr=process.platform==='darwin'&&(nodes.length<=2||rendered.includes('BLIND TREE'));
        image=(await this.driver.call('screenshot',{...metadata,max_width:Math.min(args.max_width||1400,targetImageSize(w.rect[2],w.rect[3])[0]),quality:80,...(needsOcr?{ocr:true}:{})},captureBudget!==null?{timeoutMs:captureBudget+100}:undefined)).result;
      }
      catch(error){
        if(['window_capture_unavailable','other_desktop','window_fullscreen','window_minimized','window_hidden','mac_permissions_required'].includes(error.code)){
          failWindowState(error.code,error.message,['window_minimized','window_hidden','window_capture_unavailable'].includes(error.code));
        }
        throw error;
      }
      finally { this.guardian.send({op:'capture_end'}); }
      if(image.capture==='screen_occluded')failWindowState('window_capture_unavailable','The native helper returned covering-window pixels. Discarded; bring the approved app to the front and observe again.',true);
      if(Array.isArray(image.screen_text)&&image.screen_text.length){
        const ocrLines=image.screen_text.slice(0,40).map(item=>`  @${item.x},${item.y} ${JSON.stringify(item.text)}`).join('\n');
        response.tree+=`\n\n[Screen text (OCR @x,y)]\n${ocrLines}`;
      }
      response.image={...image};delete response.image.data;
    }
    failures.delete(handle);
    this.check();
    if(generation!==this.generation||workerEpoch!==this.driver.epoch)fail('control_changed','Control or native worker changed during observation. Discard this frame and observe again.');
    for(const [id,frame] of this.frames){const age=Date.now()-frame.at,monoAge=Object.hasOwn(frame,'atMono')?performance.now()-frame.atMono:null;if(!Number.isFinite(frame.at)||!Number.isFinite(age)||age<0||age>contract.frame_ms||(monoAge!==null&&(!Number.isFinite(frame.atMono)||!Number.isFinite(monoAge)||monoAge<0||monoAge>contract.frame_ms))||frame.workerEpoch!==workerEpoch)this.frames.delete(id);}
    while(this.frames.size>=16)this.frames.delete(this.frames.keys().next().value);
    this.frames.set(response.observation_id,{at:response.at,atMono:capturedMono,hwnd:response.hwnd,key:appKey(w),snapshot:tree.snapshot_id,image,workerEpoch,elements:tree.nodes,viewTree:comparableView(rendered),viewIncomplete:treeIncomplete,viewQuery:args.query,viewMaxNodes:args.max_nodes});
    return {metadata:response,image};
  }
  async action(op,args){
    if(!input.has(op))fail('unsupported_action','Unknown input operation.');
    if(this.recoveredTask)fail('recovered_task_requires_end','Inspect the prior result without replay, then end the owning task before new input.');
    if('confirmed' in args||'preapprove' in args)fail('model_approval_forbidden','Model-supplied approval flags are not accepted.');
    const w=args.hwnd!=null?await this.grant(Number(args.hwnd),args.reason):null;
    this.check();if(Date.now()>=this.deadline||this.remaining<=0)fail('session_limit','Session expired or action budget exhausted. End and obtain a new human grant.');
    if(op==='focus'||op==='fit_window'){
      if(w?.fullscreen)throw Object.assign(Error('Bring the approved window out of macOS full-screen mode yourself before focusing or fitting it. No Space switch was performed.'),{code:'window_fullscreen',recovery_attempts_remaining:0});
      if(w?.other_desktop)throw Object.assign(Error('Bring the approved window to the current virtual desktop before fitting or focusing it. No desktop switch was performed.'),{code:'other_desktop',recovery_attempts_remaining:0});
      const failures=(this.windowFailures??=new Map());
      const prior=w?failures.get(Number(w.hwnd)):null;
      if(prior){
        if(prior.recoveryTried)throw Object.assign(Error(`Bounded recovery attempt already used for this window (${prior.code}). Wait for human recovery instead of polling repeatedly.`),{code:prior.code,repeated_failure:true,recovery_attempts_remaining:0});
        prior.recoveryTried=true;prior.recoveryCleared=true;
      }
      if(op==='fit_window')this.frames.clear();
    }
    const generation=this.generation;
    const payload={...args,...this.stamp(),mode:'take',__risk:args.risk==='routine'?'routine':'sensitive'};
    delete payload.risk;delete payload.reason;delete payload.observation_id;delete payload.observe;
    if(w){
      payload.hwnd=Number(w.hwnd);payload.__pid=w.pid;payload.__started=w.started;
      if(!['focus','fit_window','close_window'].includes(op)){
        const f=requireObservation(this.frames,args.observation_id,w.hwnd);
        if(f.workerEpoch!==this.driver.epoch)fail('stale_observation','The native worker restarted. Observe again; old element indexes cannot be reused.');
        payload.__worker_epoch=f.workerEpoch;
        if(f.key!==appKey(w))fail('identity_changed','App identity changed since observation.');
        if(f.image&&JSON.stringify(f.image.source)!==JSON.stringify(w.rect))fail('window_moved','Window moved or resized. Observe again.');
        if(['name','role','automation_id'].some(k=>Object.hasOwn(args,k))){payload.index=observedIndex(f.elements,args);delete payload.name;delete payload.role;delete payload.automation_id;}
        if(payload.index!=null){payload.snapshot_id=f.snapshot;}
        if(args.x!=null||args.y!=null){if(!f.image)fail('no_image','Observe with_image first.');payload.point=imagePoint(f.image,args.x,args.y);delete payload.x;delete payload.y;}
        if(op==='drag'){
          if(!f.image)fail('no_image','Observe with_image first.');
          payload.from=imagePoint(f.image,...args.from);payload.to=imagePoint(f.image,...args.to);
        }
      }
    }
    // Visible real-pointer clicks are the default for both semantic selectors
    // and pixels. An explicit semantic-only click remains available for controls
    // that cannot be physically reached; pixels always require physical input.
    if(op==='click'&&(payload.point||payload.physical==null))payload.physical=true;
    if(typeof payload.text==='string'&&payload.text.length>20000)fail('text_limit','Text limit is 20,000 characters per action.');
    if(op==='type'&&payload.text?.length>400)fail('text_limit','Native typing is limited to 400 UTF-16 units. Use explicit clipboard access and a verified paste for larger text.');
    await this.driver.start?.();
    if(Number.isSafeInteger(this.driver.info?.pid))this.guardian.send({op:'attach',pid:this.driver.info.pid});
    // Window-free clipboard work and first-launch/restarted workers also need
    // independent guardian registration. Never replace a frame's older epoch.
    if(payload.__worker_epoch==null)payload.__worker_epoch=this.driver.epoch;
    const preview=(await this.driver.call('authorize',{action_op:op,action_args:payload})).result;
    if(preview.sensitive){
      const filenameClipboard=op==='file_dialog'&&args.entry_method==='clipboard'?'\r\nFilename entry explicitly uses the local clipboard temporarily and restores preservable formats.\r\n':'';
      const answer=await this.guardian.prompt({kind:'action',hwnd:w?.hwnd,host_pid:this.driver.info?.pid,action_op:op,args:payload,label:preview.label||'',
        message:`Approve ONE sensitive operation?\r\n\r\n${args.reason||'No effect explanation supplied — deny if unclear.'}\r\n${filenameClipboard}\r\nApplication: ${w?.path||'Clipboard / desktop'}\r\nControl: ${preview.label||'(pixel/keyboard operation)'}\r\n\r\n${JSON.stringify({operation:op,args},null,2)}\r\n\r\nCheck the actual target. Never let an agent approve this dialog. Deny if the result is unclear.`});
      if(!answer.allowed)fail('permission_denied','Human denied the sensitive operation.');payload.__permit=answer.permit;
    }
    this.check();if(generation!==this.generation)fail('control_changed','Control state changed; observe again.');
    if(w&&appKey(await this.app(w.hwnd))!==appKey(w))fail('identity_changed','Approved process identity changed.');
    const result=await this.sessions.withInput(op,{hwnd:w?.hwnd,title:w?.title},async()=>{
      this.check();if(generation!==this.generation)fail('control_changed','Cancelled before execution.');
      if(Date.now()>=this.deadline||this.remaining<=0)fail('session_limit','Session expired or action budget exhausted. End and obtain a new human grant.');
      Runtime.prototype.recordDispatch.call(this);
      // Count an attempted dispatch, including uncertain delivery, but not a
      // rejected lease or a cancellation that never reached the native worker.
      this.remaining--;
      this.guardian.send({op:'activity',action:op});
      const result=(await this.driver.call(op,payload)).result;
      if(op==='click'&&payload.physical)this.guardian.send({op:'activity',action:op,click_feedback:true});
      return result;
    });
    try {
      this.check();
      if(generation!==this.generation)fail('control_changed','Control changed during execution. Inspect the result; do not replay this action.');
      if(op==='close_window')return {result,input_completed:true,verification_required:true,refresh_apps:true};
      return {result,input_completed:true,verification_required:true,...(w?await this.observe({hwnd:w.hwnd,settle_ms:op==='move'?0:180,...args.observe}):{})};
    }
    catch(error){return {result,input_completed:true,verification_required:true,observe_before_continuing:true,verification_error:{code:error.code||'observation_failed',message:error.message,...(error.hint?{hint:error.hint}:{})}};}
  }
  async wait(args){
    const started=performance.now(),budget=Math.min(Math.max(args.timeout_ms||15000,100),30000),until=started+budget,generation=this.generation;let latest,observations=0,workerEpoch;
    const observe=async options=>{
      observations++;let result;try{result=await this.observe(options);}catch(error){throw attachWaitMetrics(error,started,budget,observations);}const currentEpoch=this.driver?.epoch;
      // The first observation may start a previously absent worker. Bind to
      // its resulting epoch, and refuse a restart during later observations.
      if(observations===1)workerEpoch=currentEpoch;
      else if(currentEpoch!==workerEpoch){this.frames.delete(result.metadata?.observation_id);fail('control_changed','The native worker changed while waiting. Observe again.');}
      return result;
    };
    const finish=result=>({...result,wait_metrics:{elapsed_ms:Math.round(performance.now()-started),observations,polling_budget_ms:budget}});
    do {
      this.check();latest=await observe({hwnd:args.hwnd,with_image:false,query:args.query,native_snapshot_deadline:until,require_native_budget:true,...(args.abort_on?.length?{max_nodes:500}:{})});
      const tree=latest.metadata.tree.toLowerCase();
      const failure=waitFailure(latest,args.abort_on);
      if(failure){
        if(args.with_image===false)return finish({matched:false,aborted:true,abort_match:failure,...latest});
        this.frames.delete(latest.metadata.observation_id);return finish({matched:false,aborted:true,abort_match:failure,...await observe({hwnd:args.hwnd,query:args.query,with_image:args.with_image,max_nodes:500,native_snapshot_deadline:until})});
      }
      if(tree.includes(args.until.toLowerCase())){
        // Do not authorize the next batch step based on a transient match in
        // an older frame. Confirm both success and failure on the returned view.
        this.frames.delete(latest.metadata.observation_id);
        const verified=await observe({hwnd:args.hwnd,query:args.query,with_image:args.with_image,native_snapshot_deadline:until,require_native_budget:true,...(args.abort_on?.length?{max_nodes:500}:{})});
        const verifiedTree=verified.metadata.tree.toLowerCase();
        const verifiedFailure=waitFailure(verified,args.abort_on);
        if(verifiedFailure)return finish({matched:false,aborted:true,abort_match:verifiedFailure,...verified});
        if(args.abort_on?.length&&verified.metadata.tree_incomplete)return finish({matched:false,incomplete:true,...verified});
        if(verifiedTree.includes(args.until.toLowerCase()))return finish({matched:true,...verified});
        if(args.with_image===false&&performance.now()>=until)return finish({matched:false,timed_out:true,...verified});
        latest=verified;
        if(performance.now()>=until){this.frames.delete(latest.metadata.observation_id);break;}
      } else {
        // A text-only timeout already has an observation to return. Starting
        // a second potentially slow capture after the budget is exhausted can
        // add latency without changing the fact that the wait must stop.
        if(args.with_image===false&&performance.now()>=until)return finish({matched:false,timed_out:true,...latest});
        if(performance.now()>=until){this.frames.delete(latest.metadata.observation_id);break;}
      }
      await waitUntil(Math.min(until,performance.now()+500),{check:()=>{this.check();if(this.generation!==generation||this.driver?.epoch!==workerEpoch)fail('control_changed','Control or native worker changed while waiting. Observe again.');}});
      if(performance.now()>=until){
        if(args.with_image===false)return finish({matched:false,timed_out:true,...latest});
        this.frames.delete(latest.metadata.observation_id);break;
      }
      this.frames.delete(latest.metadata.observation_id);
    }while(true);
    // Once the deadline has elapsed, the last completed observation is the
    // only trustworthy frame. Starting another capture here adds latency and
    // can change the answer after the wait has already timed out.
    if(latest)return finish({matched:false,timed_out:true,...latest});
    const final=await observe({hwnd:args.hwnd,query:args.query,with_image:args.with_image,native_snapshot_deadline:until,...(args.abort_on?.length?{max_nodes:500}:{})});
    const finalFailure=waitFailure(final,args.abort_on);
    if(finalFailure)return finish({matched:false,aborted:true,abort_match:finalFailure,...final});
    return finish({matched:false,timed_out:true,...final});
  }
  async waitChange(args){
    const started=performance.now(),budget=Math.min(Math.max(args.timeout_ms||15000,100),30000);let observations=0;
    const finish=result=>({...result,wait_metrics:{elapsed_ms:Math.round(performance.now()-started),observations,polling_budget_ms:budget}});
    this.check();
    const baseline=requireObservation(this.frames,args.observation_id,args.hwnd);
    if(typeof baseline.viewTree!=='string')fail('stale_observation','The observation cannot be compared. Take a fresh snapshot.');
    if(baseline.viewIncomplete)fail('wait_observation_incomplete','The baseline tree was incomplete. Inspect the app and take a fresh observation before waiting.');
    if(baseline.workerEpoch!==this.driver.epoch)fail('stale_observation','The native worker restarted. Take a fresh snapshot.');
    const generation=this.generation,w=await this.grant(Number(args.hwnd),args.reason);this.check();
    if(generation!==this.generation)fail('control_changed','Control changed. Take a fresh snapshot.');
    if(baseline.key!==appKey(w))fail('identity_changed','Application identity changed since observation.');
    const until=performance.now()+budget;
    do {
      this.check();
      observations++;let latest;try{latest=await this.observe({hwnd:args.hwnd,with_image:false,query:baseline.viewQuery,max_nodes:baseline.viewMaxNodes,reason:args.reason,native_snapshot_deadline:until,require_native_budget:true});}catch(error){throw attachWaitMetrics(error,started,budget,observations);}
      this.check();if(generation!==this.generation)fail('control_changed','Control changed while waiting. Observe again.');
      const current=this.frames.get(latest.metadata.observation_id);
      if(!current||current.key!==baseline.key||current.workerEpoch!==baseline.workerEpoch){this.frames.delete(latest.metadata.observation_id);fail('identity_changed','Application identity or native worker changed while waiting. Take a fresh snapshot.');}
      if(latest.metadata.tree_incomplete)return finish({changed:false,incomplete:true,...latest});
      if(comparableView(latest.metadata.tree)!==baseline.viewTree)return finish({changed:true,...latest});
      if(performance.now()>=until)return finish({changed:false,timed_out:true,...latest});
      await waitUntil(Math.min(until,performance.now()+500),{check:()=>{this.check();if(generation!==this.generation||this.driver.epoch!==baseline.workerEpoch)fail('control_changed','Control or native worker changed while waiting. Observe again.');}});
      if(performance.now()>=until)return finish({changed:false,timed_out:true,...latest});
      this.frames.delete(latest.metadata.observation_id);
    }while(true);
  }
  async finish(options={}){
    if(this.finishing)return this.finishing;
    this.generation++;this.frames.clear();this.grants.clear();this.token='';
    this.finishing=Promise.resolve().then(()=>Runtime.prototype.finishTransaction.call(this,options));
    try{return await this.finishing;}finally{this.finishing=null;}
  }
  async finishTransaction({preserveTask=false}={}){
    try{
      await this.driver.abort?.();
      if(this.guardian.requiresStopAcknowledgement){
        if(typeof this.guardian.endAcknowledged!=='function')fail('guardian_end_unconfirmed','Native End cleanup acknowledgement is unavailable.');
        const receipt=await this.guardian.endAcknowledged(randomBytes(16).toString('hex'));
        if(this.driver.inputMayBeHeld===true)fail('guardian_end_unconfirmed','Input cleanup remains uncertain.');
        if(receipt.state==='stopped'||receipt.state==='paused')this.state=receipt.state;
      }else this.guardian.send({op:'end'});
    }catch(error){
      // Keep the durable task record open. A failed End is never a successful
      // completion, and Stop must not replay the uncertain operation.
      try{await this.stop();}catch{}
      if(error?.code==='input_cleanup_failed')throw error;
      throw Object.assign(Error('End cleanup is unconfirmed; task evidence was retained. Inspect status without replaying input.'),{code:'guardian_end_unconfirmed',cause:error});
    }
    if(!['stopped','paused'].includes(this.state)){this.state='idle';this.lastControlReason='completed';}
    // The replacement's new guard file is not the previous process's input
    // ledger. Its cleanup cannot establish what the crashed process held.
    if(this.recoveredTask&&!preserveTask){
      let verified=false;
      try{
        const record=readTaskRecord(this.taskFile);
        if(record.open&&record.guard===this.priorGuard&&record.dispatched===this.priorDispatched&&record.watchdogs_complete===this.priorWatchdogsComplete&&JSON.stringify(record.children)===JSON.stringify(this.priorChildren)&&record.guard&&record.dispatched===true){
          const directory=path.dirname(this.taskFile);storageOperation('verify-data-tree',directory);
          verified=priorWindowsCleanupVerified(directory,record)||priorMacCleanupVerified(directory,record);
        }
      }catch{}
      if(!verified)fail('recovered_cleanup_unverified','Prior-session input cleanup is unverified. Keep the task open and inspect the previous native ledger; do not repeat input or force an update.');
      try{await this.sessions.clearVerifiedStale(Number(/^guard-(\d+)-/.exec(this.priorGuard)[1]));}
      catch{fail('recovered_cleanup_unverified','Previous input ownership could not be safely cleared. Keep the task open; do not repeat input or force an update.');}
      if(this.latchFile&&readStopLatch(this.latchFile)?.unconfirmed){
        try{const record=readTaskRecord(this.taskFile);if(record.guard!==this.priorGuard||JSON.stringify(record.children)!==JSON.stringify(this.priorChildren))throw Error('Prior task changed');settlePriorStop(this.latchFile,record);this.state='stopped';this.lastControlReason='prior_cleanup_verified';}
        catch{fail('guardian_stop_unconfirmed','Prior Stop context or native cleanup is unverified. Keep the recovery record and do not re-arm or replay.');}
      }
    }
    if(!preserveTask){
      const stopped=this.latchFile?readStopLatch(this.latchFile):null;
      if(stopped?.unconfirmed||this.lastControlReason==='guardian_stop_unconfirmed')fail('guardian_stop_unconfirmed','Stop remains unconfirmed. Keep the task recovery record; inspect prior actors and input cleanup without replay.');
      if(stopped?.invalid||persistenceFailure(this.lastControlReason))fail('stop_persistence_failed','Stop storage is unverified. Keep the task recovery record and inspect private storage.');
      try{if(this.taskFile)writeAtomicJSON(this.taskFile,{schema:1,open:false});this.taskOpen=false;this.recoveredTask=false;this.dispatchChildren=[];this.dispatchStarted=false;this.watchdogsComplete=true;this.taskDurable=true;}catch{this.taskOpen=true;this.taskDurable=false;throw Object.assign(Error('Input cleanup finished, but task state could not be saved. Updates remain deferred.'),{code:'task_state_write_failed'});}
    }return {ended:true,state:this.state,restart_required:false};}
  async feedback(args){
    // Revalidate at the persistence boundary too; never store model text,
    // application content, screenshots, paths or arbitrary error messages.
    if(!['cursor_visual','focus','observation','workflow','performance','missing_capability','unexpected_pause','other'].includes(args.category)||
       !['observe','click','type','scroll','drag','keyboard','launch','wait','update','other'].includes(args.operation)||
       !['suspected','observed','reproduced'].includes(args.evidence))fail('invalid_feedback','Choose only the listed feedback categories.');
    const code=`agent_${args.category}_${args.operation}_${args.evidence}`;
    const incident_id=await new Incidents(dataDir()).recordSerialized('computer_feedback',{state:this.state,error:{code}});
    return {recorded:true,incident_id,classification:'agent_report_unverified',next_action:'pending_reporting_preferences'};
  }
  async launch(args){
    Runtime.prototype.beginTask.call(this);
    if(this.state==='stopped'&&this.lastControlReason==='guardian_stop_unconfirmed')fail('guardian_stop_unconfirmed','Stop delivery to native controls is unconfirmed. Inspect diagnostics and input cleanup; do not restart, re-arm or replay.');
    if(this.recoveredTask)fail('recovered_task_requires_end','The controller restarted with an unfinished task. Inspect the prior result without replay, then end the owning task before launching another application.');
    if(this.state==='stopped'&&persistenceFailure(this.lastControlReason))fail(this.lastControlReason,'Control storage failed. Inspect private storage; do not restart or send input.');
    if(this.state==='stopped'){await this.showControls();this.check();}
    if(this.state==='paused')this.check();
    const {app,executable}=launchTarget(args.app);
    if(/^(?:AxonHost|StorageGuard)(?:-[0-9a-f]+)?(?:\.exe|\.app)?$/i.test(path.basename(app)))fail('protected_app','Cannot launch internal runtime helpers as target applications.');
    if(classify({process:path.basename(app),path:app}).tier===TIER.BLOCKED)fail('protected_app','Cannot launch a protected application.');
    // Validate the execution desktop before showing controls or launching apps.
    await this.driver.start();
    await this.guardian.start();
    if(this.state==='stopped'||this.state==='paused')this.check();
    if(!this.token){this.token=randomUUID();this.deadline=Date.now()+contract.session_ms;this.remaining=contract.action_budget;}
    const activationGeneration=this.generation;
    const active=await this.guardian.request({op:'activate',token:this.token,deadline:(BigInt(this.deadline)*10000n+621355968000000000n).toString()});
    if(!active.allowed||this.state==='stopped'||this.state==='paused'||this.generation!==activationGeneration)fail('control_inactive','Control changed during activation. Use local controls and observe again.');this.state='active';this.check();
    if(Date.now()>=this.deadline||this.remaining<=0)fail('session_limit','Session expired or action budget exhausted. End and obtain a new human grant.');
    const payload={app,args:args.args||[],...this.stamp(),__risk:'sensitive'};
    await this.driver.start();
    this.guardian.send({op:'attach',pid:this.driver.info.pid});
    payload.__worker_epoch=this.driver.epoch;
    const a=await this.guardian.prompt({kind:'action',host_pid:this.driver.info.pid,action_op:'launch',args:payload,label:'',message:`Launch this application?\r\n\r\n${args.reason}\r\n\r\n${JSON.stringify({app,args:payload.args},null,2)}\r\n\r\nThis starts software with your account's privileges. No shell is used. Approve only if intended.`});
    if(!a.allowed)fail('permission_denied','Human denied application launch.');
    this.check();const launchGeneration=this.generation;
    const result=await this.sessions.withInput('launch',{title:path.basename(app)},async()=>{
      this.check();if(launchGeneration!==this.generation)fail('control_changed','Cancelled before launch.');
      if(Date.now()>=this.deadline||this.remaining<=0)fail('session_limit','Session expired or action budget exhausted. End and obtain a new human grant.');
      Runtime.prototype.recordDispatch.call(this);this.remaining--;
      return (await this.driver.call('launch',{...payload,__permit:a.permit})).result;
    });
    if(!args.observe)return result;
    // Launch already happened. An unavailable/ambiguous window is never an
    // invitation to launch a duplicate. Observe still performs its normal app
    // identity grant and native capture checks; this is only discovery sugar.
    const generation=this.generation;
    try {
      if(!Number.isSafeInteger(result.pid)||result.pid<=0)throw Object.assign(Error('Launcher returned no PID. Discover apps without relaunching.'),{code:'launch_pid_unavailable'});
      const until=performance.now()+8000;
      do {
        this.check();if(generation!==this.generation)fail('control_changed','Control changed after launch.');
        const windows=(await this.driver.call('list_apps',{})).result.windows;
        const matches=windows.filter(w=>w.pid===result.pid&&executableKey(path.resolve(w.path||''))===executableKey(executable)&&!w.minimized&&!w.other_desktop&&w.rect?.[2]>0&&w.rect?.[3]>0);
        if(matches.length>1)return {...result,input_completed:true,observe_pending:true,observation_hint:'Several matching windows opened. Discover apps and select the intended window; do not relaunch.'};
        if(matches.length===1){
          const observed=await this.observe({hwnd:Number(matches[0].hwnd),reason:args.reason});
          return {...observed,result,input_completed:true};
        }
        // Packaged Windows launchers often exit after handing off. Waiting the
        // entire discovery budget cannot produce a window of an exited PID.
        let alive=true;try{process.kill(result.pid,0);}catch(error){if(error.code==='ESRCH')alive=false;}
        if(!alive)return {...result,input_completed:true,observe_pending:true,launcher_exited:true,observation_hint:'The starter process exited, possibly after handing off. Discover apps and observe the intended window; do not relaunch.'};
        await new Promise(resolve=>setTimeout(resolve,200));
      }while(performance.now()<until);
      this.check();
      return {...result,input_completed:true,observe_pending:true,observation_hint:'No unambiguous visible window matched the launched PID and executable within8seconds. Discover apps; do not relaunch.'};
    }catch(error){return {...result,input_completed:true,observe_before_continuing:true,verification_error:{code:error.code||'observation_failed',message:error.message}};}
  }
  async pause(){this.generation++;this.frames.clear();this.state='paused';this.lastControlReason='requested_pause';this.guardian.send({op:'pause'});await this.driver.abort?.();return {paused:true,human_resume_required:true};}
  async resume(){
    if(this.state!=='paused'||this.permissionMode!=='host-managed')fail('human_resume_required','Only host-authorized soft pauses can resume in chat. Emergency Stop requires the local human re-arm control.');
    this.generation++;this.frames.clear();const generation=this.generation;
    await this.driver.abort?.();
    if(this.state!=='paused'||generation!==this.generation)fail('control_changed','Control changed before Resume completed. Inspect status.');
    const result=await this.guardian.request({op:'resume'});
    if(!result.allowed||result.state!=='active'||generation!==this.generation||this.state==='stopped')fail('human_resume_required','Native runtime refused Resume or emergency Stop won the race. Use the local controls.');
    this.state='active';this.check();this.lastControlReason='host_authorized_resume';this.deadline=Date.now()+contract.session_ms;
    return {resumed:true,fresh_observation_required:true,replayed_actions:0};
  }
  async stop(){
    if(this.stopping)return this.stopping;
    const priorUnconfirmed=this.lastControlReason==='guardian_stop_unconfirmed';
    this.generation++;this.frames.clear();this.grants.clear();this.state='stopped';this.lastControlReason='requested_stop';
    const work=Promise.resolve().then(()=>this.stopTransaction(priorUnconfirmed));this.stopping=work;
    try{return await work;}finally{if(this.stopping===work)this.stopping=null;}
  }
  async stopTransaction(priorUnconfirmed){
    if(typeof this.guardian.stopAcknowledged==='function'&&this.guardian.requiresStopAcknowledgement){
      const nonce=randomUUID().replaceAll('-','');let marker,rootIdentity,persistenceFailed=false;
      const old=this.latchFile?readStopLatch(this.latchFile):null;
      const maySettle=!priorUnconfirmed&&!old?.unconfirmed&&!old?.invalid&&!this.recoveredTask;
      try{if(!this.latchFile)throw Error('Missing Stop path');rootIdentity=fs.lstatSync(path.dirname(this.latchFile),{bigint:true});marker=persistRecoveryStop(this.latchFile,this.recoveredTask&&this.priorGuard?this.priorGuard:path.basename(this.guardFile),{unconfirmed:true,nonce});}
      catch{persistenceFailed=true;this.lastControlReason='stop_persistence_failed';}
      const outcomes=await Promise.allSettled([Promise.resolve().then(()=>this.guardian.stopAcknowledged(nonce)),Promise.resolve().then(()=>this.driver.abort?.())]);
      if(outcomes[1].status==='rejected'){this.lastControlReason='input_cleanup_failed';throw outcomes[1].reason;}
      if(persistenceFailed||persistenceFailure(this.lastControlReason))throw Object.assign(Error('Stop persistence is unconfirmed. Inspect private storage; do not restart or re-arm.'),{code:'stop_persistence_failed'});
      const receipt=outcomes[0].status==='fulfilled'?outcomes[0].value:null;
      if(!maySettle||marker?.value!=='unconfirmed:'+nonce||receipt?.stop_nonce!==nonce||receipt.workers_stopped!==true||receipt.input_cleanup_confirmed!==true||this.driver.inputMayBeHeld!==false){
        this.lastControlReason='guardian_stop_unconfirmed';throw Object.assign(Error('Native Stop or prior cleanup is unconfirmed. Inspect diagnostics; do not re-arm or replay.'),{code:'guardian_stop_unconfirmed'});
      }
      try{settleFreshStopLatch(this.latchFile,nonce,rootIdentity);}catch{this.lastControlReason='guardian_stop_unconfirmed';throw Object.assign(Error('Stop changed before confirmation could be persisted; control remains stopped.'),{code:'guardian_stop_unconfirmed'});}
      this.lastControlReason='requested_stop';return {stopped:true,human_rearm_required:true,native_stop_confirmed:true};
    }
    let unconfirmed=priorUnconfirmed||this.privateDataStorage===true&&typeof this.guardian.stopAcknowledged!=='function';
    try{const sent=this.guardian.send({op:'stop'});unconfirmed=unconfirmed||sent===false&&!!(this.guardian.proc||this.guardian.starting||this.guardian.cleanupFailed);}catch{unconfirmed=true;}
    let persistenceFailed=false;
    try{if(this.latchFile)unconfirmed=persistRecoveryStop(this.latchFile,this.recoveredTask&&this.priorGuard?this.priorGuard:path.basename(this.guardFile),{unconfirmed}).unconfirmed;}
    catch{persistenceFailed=true;this.lastControlReason='stop_persistence_failed';}
    if(unconfirmed&&!persistenceFailed)this.lastControlReason='guardian_stop_unconfirmed';
    await this.driver.abort?.();
    if(persistenceFailed)throw Object.assign(Error('Control is stopped, but the emergency Stop latch could not be saved. Do not restart the controller; inspect its private storage.'),{code:'stop_persistence_failed'});
    if(unconfirmed)throw Object.assign(Error('The local Stop latch and cleanup were attempted, but delivery to native controls is unconfirmed. Inspect status; do not re-arm or replay.'),{code:'guardian_stop_unconfirmed'});
    return {stopped:true,human_rearm_required:true};
  }
  status(){return {state:this.state,task_open:this.taskOpen===true,recovered_task:this.recoveredTask===true,remaining_actions:this.remaining,approved_apps:[...this.grants.values()].map(w=>({pid:w.pid,path:w.path})),runtime:nativePlatform().runtime,build_version:VERSION,build_id:BUILD_ID,private_data_storage:this.privateDataStorage,real_cursor:true,custom_cursor:this.guardian.customCursor??null,permission_mode:this.permissionMode,takeover_mode:this.guardian.takeoverMode||savedTakeoverMode(path.join(dataDir(),'control-preferences.json'),this.takeoverMode),control_reason:this.lastControlReason};}
  async close(){const normal=this.state==='idle';if(!normal)await this.stop();else await this.driver.abort?.();await this.guardian.close({normal});this.sessions.close();}
}
