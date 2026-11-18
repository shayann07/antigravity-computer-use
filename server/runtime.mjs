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
import {classify,TIER,accessTier,accessRefusal,resolveCallerHost} from './policy.mjs';
import {renderSnapshot,subtreeNodes} from './render.mjs';
import {targetImageSize} from './upstream-utils.mjs';
import {VERSION,BUILD_ID} from './version.mjs';
import {storageOperation} from './storage.mjs';
import {contract,nativePlatform,launchTarget,executableKey} from './platform.mjs';
import {Incidents} from './incidents.mjs';
import {updateNotice} from './update-notice.mjs';
import {settleOrphanMacStop,writeMacControllerMarker,clearConfirmedStop,currentStopNonce,persistRecoveryStop,settlePriorStop,recoveryAdvice,priorWindowsCleanupVerified,priorMacCleanupVerified,priorUndispatchedCleanupVerified,readStopLatch,persistStopLatch,settleFreshStopLatch} from './recovery.mjs';
import {writeAtomicJSON,readTaskRecord} from './atomic-json.mjs';
import {loadConversationApprovals,saveConversationApprovals} from './conversation-approvals.mjs';

const input=new Set(['move','click','type','set_value','key','scroll','drag','focus','fit_window','resize_window','close_window','paste','paste_files','clipboard','open','file_dialog']);
const fail=(code,message)=>{throw new HostError(code,message,null);};
// Post-launch observation settles on the app's main window (#72).
const LAUNCH_SETTLE_MS=1200,LAUNCH_SETTLE_LIMIT_MS=5000,SMALL_WINDOW=[480,320];
// After a launched window is brought forward: still for this long, waiting at most the limit.
const FOCUS_SETTLE_MS=300,FOCUS_SETTLE_LIMIT_MS=1500;
const UNTIL_GONE_GRACE_MS=3000;
// A task with no held resources and no activity for this long is reported as orphaned (a coordination hint, not authentication).
export const TASK_IDLE_MS=10*60*1000;
const CAPTURE_RETRY_MS=250;
// A transient overlay (tooltip, toast, menu fading out) can cover the window
// for a moment while the check capture runs. Capturing sends no input, so one
// retry after a short pause is safe and saves the agent a whole turn.
async function observeAfterInput(runtime,args){
  try{return await runtime.observe(args);}
  catch(error){
    if(error.code!=='capture_changed')throw error;
    await new Promise(resolve=>setTimeout(resolve,CAPTURE_RETRY_MS));
    runtime.check();
    return runtime.observe({...args,settle_ms:0});
  }
}
// One match is the main window; among several, only one at least twice the
// area of every other counts. Anything closer stays ambiguous.
const UNSENT_REFUSALS=new Set(['target_not_observed','ambiguous_observed_target','bad_selector','bad_observed_target','no_image','bad_point','bad_points','points_unsupported']);
const NO_IMAGE='This frame has no screenshot, so a pixel target cannot be placed. No input was sent. Observe with --image (or add --image to the action that produced this frame), view the image, then use its observation_id.';
export function mainWindow(matches){
 if(matches.length===1)return matches[0];
 const sorted=[...matches].sort((a,b)=>b.rect[2]*b.rect[3]-a.rect[2]*a.rect[3]);
 return sorted[0].rect[2]*sorted[0].rect[3]>=2*sorted[1].rect[2]*sorted[1].rect[3]?sorted[0]:null;
}
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
// Stop halts input and ends the current task. There is no latch to re-arm:
// the agent reports and waits, and the next ready starts a fresh task.
const STOP_ENDS_TASK=Object.freeze({task_ended:true,next_action:'report_and_wait_for_human'});
// Stops only a person can cause: Esc (or the Mac's Control+Option+F12), the
// bar's Stop button and the Windows Ctrl+Alt+F12 hotkey. Agent-sent stop is
// requested_stop and is not on this list.
export const HUMAN_STOP_REASONS=Object.freeze(new Set(['escape','button','hotkey']));
// After a human stop, ready refuses for this long. The agent's in-flight call
// used to come back as a crash (host_exited) and agents restarted on their own
// within seconds; this keeps a fresh task for when the human asks again.
export const HUMAN_STOP_HOLD_MS=60_000;
const HUMAN_STOP_WORDS={escape:'pressed Esc',button:'pressed Stop',hotkey:'pressed the stop shortcut'};
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
// Worst-case time a native drag holds the button, mirroring the Windows host's
// hop plan. Each hop sleeps 4 or 12 ms, which Windows rounds up to its ~16 ms
// timer tick, so a capped 1500-hop stroke can take about 25 s, not 6 s. The
// guardian ends the session at its deadline by terminating the worker, so a
// stroke that cannot finish first must not start.
const HOP_MS=16,MAX_STROKE_HOPS=1500;
// What an app approval lets the agent do, shown on every app prompt.
const APP_NOTICE="Its screenshots and accessibility text go to Antigravity's configured model. Ordinary actions run autonomously. Consequential effects need a separate confirmation. Your real mouse/keyboard will be used. Esc or Ctrl+Alt+F12 stops. Use a disposable account/VM for important data.";
// The screen point a native action reports having used, or null. Only two
// whole numbers in a sane range are passed on to native controls.
export function actionPoint(result){
  const p=result?.point;
  return Array.isArray(p)&&p.length===2&&p.every(v=>Number.isInteger(v)&&Math.abs(v)<10000000)?[p[0],p[1]]:null;
}
export function dragBudgetMs(payload){
  const path=Array.isArray(payload.points)?payload.points:[payload.from,payload.to];
  const clamp=(v,lo,hi,d)=>Number.isFinite(v)?Math.min(hi,Math.max(lo,Math.trunc(v))):d;
  const steps=clamp(payload.steps,2,200,12),hold=clamp(payload.hold_ms,0,2000,60);
  let hops=0;
  for(let s=1;s<path.length;s++){
    const [x0,y0]=path[s-1],[x1,y1]=path[s];
    hops+=path.length===2?steps:Math.max(1,Math.min(40,Math.trunc(Math.hypot(x1-x0,y1-y0)/8)));
  }
  // Scaling never drops a segment below one hop, so the cap can be exceeded by
  // up to one hop per segment.
  if(hops>MAX_STROKE_HOPS)hops=MAX_STROKE_HOPS+path.length;
  return 60+2*hold+hops*HOP_MS+1000;
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

// Native typing is paced (about 45 ms per character, slower in busy apps), so a
// long type can outlast the worker's fixed 30 s deadline and end as an unknown
// outcome mid-word. Give it time in proportion to its length; the desktop
// client's own 100 s deadline still bounds the whole request.
export function actionDeadline(op,payload){
  if(op!=='type'||typeof payload?.text!=='string')return undefined;
  return {timeoutMs:30000+payload.text.length*120};
}

export class Runtime {
  constructor({driver=null,guardian=null,sessions=null,latchFile=undefined,taskFile=undefined,permissionMode=process.env.AGCU_PERMISSION_MODE||'standalone',takeoverMode=process.env.AGCU_TAKEOVER_MODE||'manual'}={}){
    if(!['standalone','host-managed'].includes(permissionMode))throw new Error('Invalid startup permission mode');
    this.permissionMode=permissionMode;
    // Human mouse or keyboard input never pauses the agent: only Esc or the
    // bar's Stop halts it. Smart takeover is retired; a saved "smart" value
    // is accepted for compatibility but native always starts in manual.
    if(!['manual','smart'].includes(takeoverMode))throw new Error('Invalid startup takeover mode');this.takeoverMode='manual';
    this.privateDataStorage=null;
    if(!driver&&!guardian)this.privateDataStorage=storageOperation('data',dataDir()).private_storage===true;
    else fs.mkdirSync(dataDir(),{recursive:true}); // inert unit-test dependencies
    this.latchFile=latchFile===undefined?(!driver&&!guardian?path.join(dataDir(),'emergency.stop'):null):latchFile;
    this.taskFile=taskFile===undefined?(!driver&&!guardian?path.join(dataDir(),'task-state.json'):null):taskFile;
    this.approvalsFile=!driver&&!guardian?path.join(dataDir(),'conversation-approvals.json'):null;
    const prior=this.taskFile?readTaskRecord(this.taskFile):{open:false,guard:null};const priorTask=prior.open;
    this.guardFile=path.join(dataDir(),`guard-${process.pid}-${randomUUID()}.state`);
    fs.writeFileSync(this.guardFile,'idle||0|',{mode:0o600});
    // Human controls may start before an agent calls ready. Ensure their native
    // cleanup checks have an explicit empty ledger even in a passive session.
    if(!driver&&!guardian)initializeInputLedger(this.guardFile);
    // macOS: the controller's own start time, so recovery can tell a reused
    // controller pid apart from this process (recovery.mjs macStopSettles).
    if(!driver&&!guardian&&process.platform==='darwin')try{writeMacControllerMarker(this.guardFile);}catch{}
    const env={AGCU_GUARD_FILE:this.guardFile,AGCU_CONTRACT_FILE:fileURLToPath(new URL('./control-contract.json',import.meta.url)),AGCU_STOP_LATCH:this.latchFile||'',AGCU_PARENT_PID:String(process.pid),AGCU_REARM_LOCKED:priorTask?'1':'0',AGCU_PERMISSION_MODE:permissionMode,AGCU_TAKEOVER_MODE:'manual',AGCU_REAL_CURSOR:'1',CU_OVERLAY:'off',CU_PRESENCE:'off',CU_MODE:'take'};
    this.driver=driver||new Driver({env,onEvent:event=>{if(event.event==='input_cleanup_failed')this.stop().catch(()=>{});}});this.guardian=guardian||new Guardian(env);
    this.sessions=sessions||new Sessions({sessionId:randomUUID(),onInputLeaseLost:()=>this.stop().catch(()=>{})});this.sessions.register();
    this.grants=new Map();this.frames=new Map();this.generation=0;this.state='idle';this.token='';this.taskOpen=priorTask;this.recoveredTask=priorTask;this.priorGuard=priorTask?prior.guard:null;this.priorChildren=priorTask?prior.children:null;this.priorDispatched=priorTask?prior.dispatched:null;this.priorWatchdogsComplete=priorTask?prior.watchdogs_complete:null;this.dispatchChildren=[];this.dispatchStarted=false;this.watchdogsComplete=true;this.taskDurable=true;this.remaining=contract.action_budget;
    this.lastControlReason='';
    if(this.latchFile){
      const saved=readStopLatch(this.latchFile);if(saved){this.state='stopped';
        // A confirmed Stop only ended the earlier task. The next ready clears
        // it after cleanup proof; uncertain or unreadable markers stay fenced.
        this.lastControlReason=saved.unconfirmed?'guardian_stop_unconfirmed':saved.value==='stopped'?'task_ended_by_stop':'stop_persistence_failed';
      }
    }
    this.guardian.on('state',(s,reason)=>{
      if(s==='stopped'&&HUMAN_STOP_REASONS.has(reason))this.humanStop={reason,at:Date.now()};
      const previousState=this.state;
      // A delayed idle/active notification must never undo an emergency Stop.
      // Native human re-arm is acknowledged separately by the resume event.
      if(previousState==='stopped'&&s!=='stopped')return;
      // A late, uncorrelated stopped event cannot prove that the Stop we just
      // attempted reached the native guardian. Preserve the uncertain state.
      const priorStopUnconfirmed=previousState==='stopped'&&this.lastControlReason==='guardian_stop_unconfirmed';
      if((reason||s!==this.state)&&(!priorStopUnconfirmed||persistenceFailure(reason)))this.lastControlReason=reason||s;
      // Native ends an active session at its deadline by going idle, with
      // reason session_expired (older controls give no reason). Report that
      // to in-flight calls as a renewable session_limit.
      if(previousState==='active'&&s==='idle'&&(!reason||reason==='session_expired')&&this.token)this.sessionExpired=true;
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
    this.taskOpen=true;this.taskDurable=false;this.taskOpenedAt=Date.now();this.lastActivityAt=this.taskOpenedAt;
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
  async prepare(){
    if(this.taskFile&&!fs.existsSync(this.taskFile))try{writeAtomicJSON(this.taskFile,{schema:1,open:false},{exclusive:true});}catch(error){if(error.code!=='EEXIST')throw error;}
  }
  async showControls(){
    if(this.recoveredTask){
      // Show the bar so the human always has Stop, but with re-arm, resume and
      // activation locked: this process's empty ledger proves nothing about
      // the previous one. A guardian that does not confirm the lock is hidden.
      const result=await this.guardian.request({op:'show_controls',rearm_locked:true});
      if(result.rearm_locked!==true){try{await this.guardian.request({op:'dismiss_controls'});}catch{}fail('recovered_cleanup_unverified','Local controls could not lock re-arm, so they were not shown. Verify the previous task\'s input cleanup first.');}
      return {...result,rearm_locked:true};
    }
    if(this.state==='stopped'&&this.lastControlReason==='guardian_stop_unconfirmed')fail('guardian_stop_unconfirmed','Native Stop delivery is unconfirmed. Inspect diagnostics and input cleanup before showing controls; do not replay.');
    if(this.state==='stopped'&&persistenceFailure(this.lastControlReason))fail(this.lastControlReason,'Control storage failed. Inspect private storage before showing controls.');
    const result=await this.guardian.request({op:'show_controls'});if(result.controls_visible===true)this.recoveryFailure=null;return result;
  }
  // App approvals last for the agent's conversation: ready returns a
  // session_handle that later ready calls present. A new conversation (no or
  // unknown handle) asks again. Stop and Esc end the task but keep the
  // conversation's approvals, so continuing afterwards shows no new prompt.
  // They are kept in private storage (conversation-approvals.mjs) so a
  // controller restart, update or idle shutdown does not ask again; native
  // guardians keep their own record and still decide whether to show a card.
  bindSession(handle){
    const sessions=(this.conversationGrants??=new Map());const seen=(this.conversationSeen??=new Map());
    if(this.approvalsFile&&!this.approvalsLoaded){
      this.approvalsLoaded=true;
      for(const [saved,record] of loadConversationApprovals(this.approvalsFile))if(!sessions.has(saved)){sessions.set(saved,record.apps);seen.set(saved,record.seen);}
    }
    if(typeof handle==='string'&&sessions.has(handle))this.sessionHandle=handle;
    else {this.sessionHandle=randomUUID();sessions.set(this.sessionHandle,new Map());}
    seen.set(this.sessionHandle,Date.now());Runtime.prototype.saveApprovals.call(this);
  }
  saveApprovals(){
    if(!this.approvalsFile)return;
    const records=new Map([...(this.conversationGrants??new Map())].map(([handle,apps])=>[handle,{seen:this.conversationSeen?.get(handle)??Date.now(),apps}]));
    // Approvals still hold in memory for this controller; a failed save only
    // means a restart asks again. status reports it.
    try{saveConversationApprovals(this.approvalsFile,records);this.approvalsSaved=true;}catch{this.approvalsSaved=false;}
  }
  // #60: the verified caller host for this task, from the native gate. Null
  // (the default, and after end or stop) keeps every AI app blocked.
  // Name and executable of the verified calling app, for the bar's label and
  // icon only. Orientation, never authority: nothing is granted from it.
  // macOS window handles are local to the worker, so the guardian lights the
  // window by its process and frame instead; it checks the process's grant.
  glowTarget(w){return process.platform==='darwin'&&w&&Number.isSafeInteger(w.pid)&&Array.isArray(w.rect)&&w.rect.length===4?{pid:w.pid,rect:w.rect.map(Number)}:{};}
  hostLabel(){const h=this.callerHost?.host;if(!h)return {};const names={claude:'Claude',chatgpt:'ChatGPT',codex:'Codex',antigravity:'Antigravity'};return names[h.group]?{host_name:names[h.group],host_path:h.path}:{};}
  callerPolicy(){return {release:this.callerHost?.release??[]};}
  callerReport(){const h=this.callerHost;return h?{self_excluded_app:h.host.name,self_excluded_path:h.host.path,released_ai_groups:h.release}:{self_excluded_app:null,released_ai_groups:[]};}
  async openCallerGate(){
    if((process.platform!=='win32'&&process.platform!=='darwin')||this.recoveredTask||!this.driver?.call)return {gate:null};
    const reply=await this.driver.call('caller_gate_open',{});const pipe=reply?.result?.pipe??reply?.pipe;
    return {gate:typeof pipe==='string'?pipe:null};
  }
  async redeemCaller(nonce){
    this.callerHost=null;
    if((process.platform!=='win32'&&process.platform!=='darwin')||typeof nonce!=='string'||!/^[a-f0-9]{64}$/.test(nonce)||!this.driver?.call)return null;
    try{const reply=await this.driver.call('caller_gate_redeem',{nonce});const r=reply?.result??reply;this.callerHost=r?.resolved===true?resolveCallerHost(r.chain):null;}catch{this.callerHost=null;}
    return this.callerHost;
  }
  async ready({session_handle}={}){
    Runtime.prototype.bindSession.call(this,session_handle);
    // A human stopped the last task moments ago: report and wait for them.
    const hold=Runtime.prototype.humanStopHold.call(this);
    if(hold)return {...this.status(),ready:false,controls_visible:null,next_action:'report_and_wait_for_human',replay_allowed:false,stopped_by_human:true,stop_reason:hold.reason,retry_after_ms:hold.remaining,error:{code:'human_stopped',message:`The human ${HUMAN_STOP_WORDS[hold.reason]} to stop this task. Do not start again on your own: report what was done and wait for the human to ask. A new task can start in ${Math.ceil(hold.remaining/1000)} s.`}};
    // Another copy held the input lock last time. That ends when the other
    // copy closes, so ask again instead of repeating the old refusal.
    if(this.recoveryFailure?.code==='input_lease_held')this.recoveryFailure=null;
    // ready is the explicit task start; status is the read-only check. Report
    // whether this call opened the task so a ready after end is not misread.
    // A confirmed Stop ended the previous task. Clear it here, after proof
    // that inputs were released and workers are gone, so this ready starts
    // fresh. Uncertain delivery and storage failures are never cleared.
    // While local controls are failing, keep reporting that bounded failure.
    // macOS: an unconfirmed Stop left by a controller that ended together
    // with its guardian, with no task open, settles only on full evidence.
    if(process.platform==='darwin'&&this.state==='stopped'&&this.lastControlReason==='guardian_stop_unconfirmed'&&!this.recoveredTask&&this.latchFile&&this.taskFile&&this.guardFile){
      // Settling leaves a confirmed "stopped" and is reported as such. The
      // ordinary Stop clearing happens on the next ready, never in this call.
      let settled=null;
      try{if(!readTaskRecord(this.taskFile).open)settled=settleOrphanMacStop(this.latchFile,{currentGuard:path.basename(this.guardFile)});}catch{}
      if(settled){this.lastControlReason='prior_cleanup_verified';return {...this.status(),ready:false,controls_visible:null,replay_allowed:false,prior_cleanup_verified:true,next_action:settled.next_action};}
    }
    if(this.state==='stopped'&&this.lastControlReason!=='guardian_stop_unconfirmed'&&!persistenceFailure(this.lastControlReason)&&!this.recoveredTask&&!this.recoveryFailure){
      const cleared=await Runtime.prototype.clearStop.call(this);
      if(cleared)return cleared;
    }
    const wasOpen=this.taskOpen;Runtime.prototype.beginTask.call(this);const taskStarted=!wasOpen&&this.taskOpen===true;
    if(this.state==='stopped'&&this.lastControlReason==='guardian_stop_unconfirmed'&&this.driver?.inputMayBeHeld===true)return {...this.status(),ready:false,controls_visible:null,next_action:'inspect_input_cleanup',replay_allowed:false,error:{code:'input_cleanup_failed',message:'Input cleanup and native Stop delivery are unconfirmed. Inspect diagnostics; do not restart or replay.'}};
    if(this.state==='stopped'&&this.lastControlReason==='guardian_stop_unconfirmed')return {...this.status(),ready:false,controls_visible:null,next_action:'inspect_diagnostics',replay_allowed:false,error:{code:'guardian_stop_unconfirmed',message:'Stop delivery to native controls is unconfirmed. Inspect diagnostics and input cleanup; do not restart or replay.'}};
    if(this.state==='stopped'&&persistenceFailure(this.lastControlReason))return {...this.status(),ready:false,controls_visible:null,next_action:'inspect_stop_persistence_without_restart',replay_allowed:false,error:{code:this.lastControlReason,message:'Control is stopped because native control storage failed. Inspect private storage; do not restart or send input.'}};
    // A replacement process cannot use its own empty ledger as evidence that
    // the previous process released input. Do not lead the agent toward re-arm
    // or start a new guardian before the recovered task has passed cleanup.
    if(this.recoveredTask&&this.taskFile){
      // Read-only: a leftover that provably never sent input can be ended once.
      let undispatched=false;try{const record=readTaskRecord(this.taskFile);undispatched=record.guard===this.priorGuard&&priorUndispatchedCleanupVerified(path.dirname(this.taskFile),record);}catch{}
      if(undispatched)return {...this.status(),ready:false,controls_visible:null,next_action:'end_recovered_task',replay_allowed:false,error:{code:'recovered_cleanup_unverified',message:'A previous task was opened but never sent input, and its controller is gone. Run end once to close it, then ready.'}};
    }
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
      return {...this.status(),session_handle:this.sessionHandle,task_started:taskStarted,update_notice:updateNotice(dataDir()),ready:visible&&this.state!=='stopped'&&this.state!=='paused'&&!this.recoveredTask,controls_visible:visible,desktop_context:controls.desktop_context,...(['native_liquid_glass','visual_effect_fallback'].includes(controls.material_backend)?{visual_material:controls.material_backend}:{}),guardian_running:!!this.guardian.proc,guardian_exit:this.guardian.lastExit??null,
        ...(this.state==='stopped'&&!(this.lastControlReason==='input_cleanup_failed'||this.driver?.inputMayBeHeld===true)?{replay_allowed:false,error:{code:'native_latch_still_enforced',message:'These native controls still hold Stop after a restart. Update the installation; this build needs the native change described in CLAUDE-STYLE-CONTROL.md. No input was sent.'}}:{}),
        next_action:this.state==='stopped'?(this.lastControlReason==='input_cleanup_failed'||this.driver?.inputMayBeHeld===true?'inspect_input_cleanup':'native_update_required'):this.state==='paused'?'ask_human_before_resume':this.recoveredTask?'inspect_recovered_task':'discover_or_launch'};
    }catch(error){
      // A refused second copy never had controls and sent nothing, so the
      // task this call opened is closed again; a later end has nothing to do.
      if(error.code==='input_lease_held'&&taskStarted&&!this.dispatchStarted){try{if(this.taskFile)writeAtomicJSON(this.taskFile,{schema:1,open:false});this.taskOpen=false;}catch{}}
      this.recoveryVisibility=controls?.controls_visible===false?false:null;this.recoveryFailure={code:error.code||'guardian_unavailable',message:error.code==='input_lease_held'?'Another copy of Computer Use is controlling this PC; multiple copies are not supported yet. Close the other copy (or end its task), then run ready again. No input was sent.':error.code==='desktop_context_unavailable'?'Start the installed local launcher on the visible desktop. No desktop was switched and Stop remains latched.':'Local controls failed to start. Run diagnostics; do not repeat launch commands.'};return unavailable();}
  }
  // The human stop that still holds ready back, or null.
  humanStopHold(now=Date.now()){
    const stop=this.humanStop;if(!stop||this.state!=='stopped'||!HUMAN_STOP_REASONS.has(this.lastControlReason))return null;
    const remaining=stop.at+HUMAN_STOP_HOLD_MS-now;return remaining>0?{reason:stop.reason,remaining}:null;
  }
  // What a call cut short by a human stop reports instead of its own error.
  // Esc ends the native worker, so the call itself only sees host_exited or a
  // similar uncertain failure, which reads like a crash. null when no human
  // stop is in force or the error already says the task was stopped.
  humanStopError(error){
    if(this.state!=='stopped'||!HUMAN_STOP_REASONS.has(this.lastControlReason))return null;
    const reason=this.humanStop?.reason||this.lastControlReason;
    return {stopped_by_human:true,stop_reason:reason,error:{code:'control_stopped',message:`The human ${HUMAN_STOP_WORDS[reason]||'stopped the task'} while this was running, so input stopped. Part of this action may already have been sent. Do not call ready or retry: report what was done and wait for the human to ask again.`,...(error?.code&&error.code!=='control_stopped'?{interrupted:error.code}:{})}};
  }
  // Esc can end the native worker a moment before the guardian's stopped
  // state arrives, so a failure Esc typically causes waits briefly for it.
  async awaitHumanStopError(error,{waitMs=750,stepMs=50}={}){
    const waits=['host_exited','input_outcome_unknown','control_changed','control_stopped','focus_changed'].includes(error?.code);
    for(const end=Date.now()+(waits?waitMs:0);;){
      const human=Runtime.prototype.humanStopError.call(this,error);
      if(human||Date.now()>=end)return human;
      await new Promise(resolve=>setTimeout(resolve,stepMs));
    }
  }
  // Returns null once a confirmed Stop is cleared, or a ready refusal.
  async clearStop(){
    const refuse=(code,next_action,message)=>({...this.status(),ready:false,controls_visible:null,next_action,replay_allowed:false,error:{code,message}});
    if(this.lastControlReason==='input_cleanup_failed'||this.driver?.inputMayBeHeld===true)return refuse('input_cleanup_failed','inspect_input_cleanup','Input release after Stop is unconfirmed. Inspect diagnostics; do not restart or replay.');
    const latch=this.latchFile?readStopLatch(this.latchFile):null;
    if(latch?.unconfirmed){this.lastControlReason='guardian_stop_unconfirmed';return refuse('guardian_stop_unconfirmed','inspect_input_cleanup','Stop delivery is unconfirmed. Inspect diagnostics and input cleanup; do not restart or replay.');}
    if(latch?.invalid){this.lastControlReason='stop_persistence_failed';return refuse('stop_persistence_failed','inspect_stop_persistence_without_restart','The Stop marker cannot be read. Inspect private storage; do not send input.');}
    // Cleanup proof replaces the human re-arm: the live guardian confirms its
    // workers exited and no key or button is held, or this process proves its
    // own recorded actors exited. A Stop that never dispatched needs neither.
    if(this.guardian?.proc&&this.guardian.initialized&&typeof this.guardian.stopAcknowledged==='function'){
      try{await this.guardian.stopAcknowledged(randomUUID().replaceAll('-',''));}
      catch{return refuse('stop_cleanup_unverified','inspect_input_cleanup','Native controls did not confirm that inputs were released after Stop. Inspect diagnostics; do not replay.');}
    }else if(this.taskOpen&&this.dispatchStarted&&!(await this.exitedCurrentCleanupVerified()))return refuse('stop_cleanup_unverified','inspect_input_cleanup','Input release after Stop could not be verified. Inspect diagnostics; do not replay.');
    if(this.taskFile&&this.taskOpen)try{writeAtomicJSON(this.taskFile,{schema:1,open:false});}catch{return refuse('task_state_write_failed','inspect_diagnostics','The stopped task could not be closed. Inspect private storage.');}
    this.taskOpen=false;this.dispatchChildren=[];this.dispatchStarted=false;this.watchdogsComplete=true;this.taskDurable=true;
    if(latch&&this.guardian?.proc&&this.guardian.initialized&&this.guardian.capabilities?.clear_stop===true){
      // Native controls clear a confirmed Stop themselves once their own
      // cleanup checks pass; they refuse an unconfirmed or unreadable marker.
      let reply;
      try{reply=await this.guardian.request({op:'clear_stop'});}
      catch{return refuse('stop_cleanup_unverified','inspect_input_cleanup','Native controls did not confirm that the Stop could be cleared. Inspect diagnostics; do not replay.');}
      if(reply.cleared!==true||reply.state!=='idle'){
        if(reply.reason==='guardian_stop_unconfirmed'){this.lastControlReason='guardian_stop_unconfirmed';return refuse('guardian_stop_unconfirmed','inspect_input_cleanup','Stop delivery is unconfirmed. Inspect diagnostics and input cleanup; do not restart or replay.');}
        if(reply.reason==='stop_persistence_failed'){this.lastControlReason='stop_persistence_failed';return refuse('stop_persistence_failed','inspect_stop_persistence_without_restart','The Stop marker cannot be read or cleared. Inspect private storage; do not send input.');}
        return refuse('stop_cleanup_unverified','inspect_input_cleanup','Input release after Stop could not be verified by the native controls. Inspect diagnostics; do not replay.');
      }
      if(readStopLatch(this.latchFile)){this.lastControlReason='stop_persistence_failed';return refuse('stop_persistence_failed','inspect_stop_persistence_without_restart','The Stop marker is still present after it was cleared. Inspect private storage; do not send input.');}
    }else if(latch){
      // Older native controls still enforce the marker until they restart,
      // so close them, clear the confirmed marker and let ready start fresh.
      if(this.guardian.proc)try{await this.guardian.close({normal:true});}catch{return refuse('guardian_cleanup_unconfirmed','inspect_diagnostics','The previous controls did not exit. Inspect diagnostics before starting another task.');}
      try{clearConfirmedStop(this.latchFile);}catch(error){this.lastControlReason=error.code||'stop_persistence_failed';return refuse(this.lastControlReason,error.code==='guardian_stop_unconfirmed'?'inspect_input_cleanup':'inspect_stop_persistence_without_restart','The Stop marker changed or could not be cleared. Inspect diagnostics; do not replay.');}
    }
    this.generation=(this.generation||0)+1;this.frames?.clear();this.grants?.clear();this.token='';this.sessionExpired=false;this.state='idle';this.lastControlReason='fresh_task_after_stop';
    return null;
  }
  enforceStopLatch(){
    if(this.latchFile){const latch=readStopLatch(this.latchFile);if(latch){this.stop().catch(()=>{});if(latch.invalid)fail('stop_persistence_failed','Cannot verify the Stop marker; no input was sent.');fail('control_stopped','The human stopped this task. No input was sent. Report what you did and wait for the human; do not retry. The next ready starts a fresh task.');}}
  }
  check(){
    if(this.state==='idle'&&this.sessionExpired)fail('session_limit','The control session reached its time limit. No input was sent. Renew the task (end, then ready) and continue from a fresh observation.');
    if(this.state==='stopped')fail('control_stopped','The human stopped this task. No input was sent. Report what you did and wait for the human; do not retry. The next ready starts a fresh task.');
    if(this.state!=='active')fail('control_inactive',`Control is ${this.state}. Ask the human before continuing; resume only when they say so, or start a fresh task with ready.`);
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
    if([process.pid,process.ppid,this.driver.info?.pid,this.guardian.pid].includes(w.pid)||classify(w,Runtime.prototype.callerPolicy.call(this)).tier===TIER.BLOCKED)
      fail('protected_app','This is a protected app or the control/host UI.');
    return w;
  }
  async grant(hwnd,purpose='Operate this app for the requested desktop task',{observationOnly=false}={}){
    Runtime.prototype.beginTask.call(this);
    if(this.state==='stopped'&&this.lastControlReason==='guardian_stop_unconfirmed')fail('guardian_stop_unconfirmed','Stop delivery to native controls is unconfirmed. Inspect diagnostics and input cleanup; do not restart or replay.');
    if(this.recoveredTask&&!observationOnly)fail('recovered_task_requires_end','The controller restarted with an unfinished task. Inspect the prior result without replay, then end the owning task before new input.');
    if(this.state==='stopped'&&persistenceFailure(this.lastControlReason))fail(this.lastControlReason,'Control storage failed. Inspect private storage; do not restart or send input.');
    if(this.state==='stopped'){await this.showControls();this.check();}
    if(this.state==='paused')this.check();
    const w=await this.app(hwnd);const key=appKey(w);
    if(this.grants.has(key)&&this.state==='active'){this.check();return w;}
    const tier=accessTier(w,Runtime.prototype.callerPolicy.call(this));
    const tierText=tier==='read'?'Access: read only. Visible to the agent, but no clicks or typing.':tier==='click'?'Access: click only (terminal or IDE). Left clicks and scrolling; no typing, keys, right click or drag.':'Access: full.';
    // Already approved in this conversation: native controls that support it
    // (see CLAUDE-STYLE-CONTROL.md) restore the grant without a new dialog.
    const remembered=!!this.sessionHandle&&this.conversationGrants?.get(this.sessionHandle)?.has(executableKey(w.path))===true;
    const answer=await this.guardian.prompt({kind:'app',hwnd:Number(hwnd),app_pid:w.pid,host_pid:this.driver.info?.pid,tier,...(this.sessionHandle?{session_handle:this.sessionHandle}:{}),...(remembered?{remembered:true}:{}),
      // card:1 asks native controls for the app row (name and tier tag from
      // their own look at the window); task and notice are its detail text.
      // message stays for controls that only show text.
      card:1,task:String(purpose).slice(0,500),notice:APP_NOTICE,
      message:`Allow this application for this session?\r\n\r\n${w.title}\r\n${w.path}\r\nPID ${w.pid}\r\n${tierText}\r\n\r\nTask: ${purpose}\r\n\r\n${APP_NOTICE}`});
    if(!answer.allowed)fail(answer.decision==='timeout'?'approval_timeout':'permission_denied',answer.decision==='timeout'?'Local application approval timed out.':'The human denied this application.');
    this.guardian.send({op:'attach',pid:this.driver.info?.pid});
    const current=await this.app(hwnd);if(appKey(current)!==key)fail('identity_changed','Application restarted during approval.');
    if(!this.token){this.sessionExpired=false;this.token=randomUUID();this.deadline=Date.now()+contract.session_ms;this.remaining=contract.action_budget;}
    const activationGeneration=this.generation;
    const active=await this.guardian.request({op:'activate',token:this.token,deadline:(BigInt(this.deadline)*10000n+621355968000000000n).toString()});
    if(!active.allowed||this.state==='stopped'||this.state==='paused'||this.generation!==activationGeneration)fail('control_inactive','Control changed during activation. Use local controls and observe again.');
    this.state='active';this.check();this.grants.set(key,{...current,purpose,tier});
    if(this.sessionHandle){this.conversationGrants?.get(this.sessionHandle)?.set(executableKey(current.path),tier);this.conversationSeen?.set(this.sessionHandle,Date.now());Runtime.prototype.saveApprovals.call(this);}
    return current;
  }
  // Ask the human to approve several apps up front, one local dialog each.
  // Input is later allowed only into approved apps, within each app's tier.
  async requestAccess({hwnds,reason}){
    if(!Array.isArray(hwnds)||!hwnds.length||hwnds.length>8||hwnds.some(h=>!Number.isSafeInteger(h)||h<=0))fail('bad_arguments','Pass 1 to 8 window handles from apps.');
    const apps=[];
    for(const hwnd of [...new Set(hwnds)]){
      try{const w=await this.grant(hwnd,reason,{observationOnly:true});apps.push({hwnd,app:w.path,title:w.title,approved:true,tier:accessTier(w,Runtime.prototype.callerPolicy.call(this))});}
      catch(error){
        apps.push({hwnd,approved:false,error:{code:error.code||'access_failed',message:error.message}});
        // A Stop during approval ends the task; ask nothing further.
        if(error.code==='control_stopped'||this.state==='stopped')break;
      }
    }
    return {apps,approved:apps.filter(a=>a.approved).length};
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
    this.guardian.send({op:'activity',action:'observe',hwnd:handle,...Runtime.prototype.glowTarget.call(this,w),...Runtime.prototype.hostLabel.call(this)});
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
    this.check();if(Date.now()>=this.deadline||this.remaining<=0)fail('session_limit','Session expired or action budget exhausted. Renew the task (end, then ready) and continue from a fresh observation.');
    // Per-app access tier, enforced against the target before any input.
    if(w){const refusal=accessRefusal(accessTier(w,Runtime.prototype.callerPolicy.call(this)),op,args);if(refusal)throw Object.assign(Error(refusal.message),{code:refusal.code,tier:accessTier(w,Runtime.prototype.callerPolicy.call(this))});}
    if(op==='resize_window'&&process.platform==='darwin')fail('unsupported_action','resize_window is not available on macOS yet. No window was changed.');
    if(op==='focus'||op==='fit_window'||op==='resize_window'){
      if(w?.fullscreen)throw Object.assign(Error('Bring the approved window out of macOS full-screen mode yourself before focusing or fitting it. No Space switch was performed.'),{code:'window_fullscreen',recovery_attempts_remaining:0});
      if(w?.other_desktop)throw Object.assign(Error('Bring the approved window to the current virtual desktop before fitting or focusing it. No desktop switch was performed.'),{code:'other_desktop',recovery_attempts_remaining:0});
      const failures=(this.windowFailures??=new Map());
      const prior=w?failures.get(Number(w.hwnd)):null;
      if(prior){
        if(prior.recoveryTried)throw Object.assign(Error(`Bounded recovery attempt already used for this window (${prior.code}). Wait for human recovery instead of polling repeatedly.`),{code:prior.code,repeated_failure:true,recovery_attempts_remaining:0});
        prior.recoveryTried=true;prior.recoveryCleared=true;
      }
      if(op==='fit_window'||op==='resize_window')this.frames.clear();
    }
    const generation=this.generation;
    const payload={...args,...this.stamp(),mode:'take',__risk:args.risk==='routine'?'routine':'sensitive'};
    let hudRegion;
    delete payload.risk;delete payload.reason;delete payload.observation_id;delete payload.observe;
    if(w){
      payload.hwnd=Number(w.hwnd);payload.__pid=w.pid;payload.__started=w.started;
      if(!['focus','fit_window','resize_window','close_window'].includes(op)){
        const f=requireObservation(this.frames,args.observation_id,w.hwnd);
        if(f.workerEpoch!==this.driver.epoch)fail('stale_observation','The native worker restarted. Observe again; old element indexes cannot be reused.');
        payload.__worker_epoch=f.workerEpoch;
        if(f.key!==appKey(w))fail('identity_changed','App identity changed since observation.');
        if(f.image&&JSON.stringify(f.image.window||f.image.source)!==JSON.stringify(w.rect))fail('window_moved','Window moved or resized. Observe again.');
        // A refusal raised before any input leaves the frame unchanged, so it stays usable (its original age still applies).
        try{
        if(['name','role','automation_id'].some(k=>Object.hasOwn(args,k))){payload.index=observedIndex(f.elements,args);delete payload.name;delete payload.role;delete payload.automation_id;}
        if(payload.index!=null){payload.snapshot_id=f.snapshot;}
        if(args.x!=null||args.y!=null){if(!f.image)fail('no_image',NO_IMAGE);payload.point=imagePoint(f.image,args.x,args.y);delete payload.x;delete payload.y;}
        if(op==='drag'){
          if(!f.image)fail('no_image',NO_IMAGE);
          // points is one continuous stroke through every point; from/to alone
          // is a straight drag. Both are screenshot pixels mapped to the screen.
          if(Array.isArray(args.points)){
            if(args.from||args.to)fail('bad_points','Use either points or from/to, not both. No input was sent.');
            payload.points=args.points.map(p=>imagePoint(f.image,...p));payload.from=payload.points[0];payload.to=payload.points.at(-1);
          }
          else if(args.from&&args.to){payload.from=imagePoint(f.image,...args.from);payload.to=imagePoint(f.image,...args.to);}
          else fail('bad_points','A drag needs from and to, or 2 to 400 points. No input was sent.');
        }
        }catch(error){if(UNSENT_REFUSALS.has(error.code))this.frames.set(args.observation_id,f);throw error;}
        if(op==='click'&&(payload.point||payload.physical!==false)){
          if(payload.point)hudRegion=[...payload.point,1,1];
          else {
            const rect=f.elements?.find(node=>node.i===payload.index)?.rect;
            if(Array.isArray(rect)&&rect.length===4&&rect.every(Number.isSafeInteger)&&rect[2]>0&&rect[3]>0)
              hudRegion=rect[2]<=512&&rect[3]<=192?[...rect]:[Math.round(rect[0]+rect[2]/2),Math.round(rect[1]+rect[3]/2),1,1];
          }
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
    const avoidHud=async()=>{
      if(!hudRegion||this.driver.info?.hud_avoidance!==true)return;
      const avoided=await this.guardian.request({op:'avoid_input',token:this.token,rect:hudRegion});
      this.check();if(generation!==this.generation)fail('control_changed','Control changed while positioning the controls. Observe again.');
      if(avoided.allowed!==true)fail('hud_target_obscured','Local controls could not move safely away from this target. No app input was sent.');
    };
    // Pixel risk classification must see the app beneath our HUD, rather than
    // accidentally classifying one of our own buttons. The native click still
    // independently verifies the actual topmost target before sending input.
    await avoidHud();
    const preview=(await this.driver.call('authorize',{action_op:op,action_args:payload})).result;
    if(preview.sensitive){
      const filenameClipboard=op==='file_dialog'&&args.entry_method==='clipboard'?'\r\nFilename entry explicitly uses the local clipboard temporarily and restores preservable formats.\r\n':'';
      const answer=await this.guardian.prompt({kind:'action',hwnd:w?.hwnd,host_pid:this.driver.info?.pid,action_op:op,args:payload,label:preview.label||'',
        message:`Approve ONE sensitive operation?\r\n\r\n${args.reason||'No effect explanation supplied — deny if unclear.'}\r\n${filenameClipboard}\r\nApplication: ${w?.path||'Clipboard / desktop'}\r\nControl: ${preview.label||'(pixel/keyboard operation)'}\r\n\r\n${JSON.stringify({operation:op,args},null,2)}\r\n\r\nCheck the actual target. Never let an agent approve this dialog. Deny if the result is unclear.`});
      if(!answer.allowed)fail(answer.decision==='timeout'?'approval_timeout':'permission_denied',answer.decision==='timeout'?'Sensitive operation approval timed out.':'Human denied the sensitive operation.');payload.__permit=answer.permit;
    }
    this.check();if(generation!==this.generation)fail('control_changed','Control state changed; observe again.');
    if(w&&appKey(await this.app(w.hwnd))!==appKey(w))fail('identity_changed','Approved process identity changed.');
    const result=await this.sessions.withInput(op,{hwnd:w?.hwnd,title:w?.title},async()=>{
      this.check();if(generation!==this.generation)fail('control_changed','Cancelled before execution.');
      if(Date.now()>=this.deadline||this.remaining<=0)fail('session_limit','Session expired or action budget exhausted. Renew the task (end, then ready) and continue from a fresh observation.');
      // Recheck after a sensitive prompt or a wait for the shared input lease.
      await avoidHud();
      if(Date.now()>=this.deadline||this.remaining<=0)fail('session_limit','Session expired while positioning local controls. No app input was sent.');
      if(op==='drag'&&Date.now()+dragBudgetMs(payload)>=this.deadline)fail('session_limit','Too little session time is left to finish this drag before control ends. No input was sent. End and obtain a new human grant.');
      Runtime.prototype.recordDispatch.call(this);
      // Count an attempted dispatch, including uncertain delivery, but not a
      // rejected lease or a cancellation that never reached the native worker.
      this.remaining--;
      // The target window rides along for the control bar and a per-window
      // glow; native accepts it only for an approved app.
      this.guardian.send({op:'activity',action:op,...(w?{hwnd:Number(w.hwnd)}:{}),...Runtime.prototype.glowTarget.call(this,w),...Runtime.prototype.hostLabel.call(this)});
      const result=(await this.driver.call(op,payload,actionDeadline(op,payload))).result;
      // Where the action landed, in screen pixels, so the glow's bright part
      // can ease towards it even when the real pointer did not move.
      const landed=actionPoint(result);
      if(landed&&w)this.guardian.send({op:'activity',action:op,hwnd:Number(w.hwnd),point:landed,...Runtime.prototype.glowTarget.call(this,w)});
      if(op==='click'&&payload.physical)this.guardian.send({op:'activity',action:op,click_feedback:true,...(w?{hwnd:Number(w.hwnd)}:{})});
      return result;
    });
    try {
      this.check();
      if(generation!==this.generation)fail('control_changed','Control changed during execution. Inspect the result; do not replay this action.');
      if(op==='close_window')return {result,input_completed:true,verification_required:true,refresh_apps:true};
      return {result,input_completed:true,verification_required:true,...(w?await observeAfterInput(this,{hwnd:w.hwnd,settle_ms:op==='move'?0:180,...args.observe}):{})};
    }
    catch(error){return {result,input_completed:true,verification_required:true,observe_before_continuing:true,verification_error:{code:error.code||'observation_failed',message:error.message,...(error.hint?{hint:error.hint}:{})}};}
  }
  // A short series of window pictures for judging motion (#56). It reuses the
  // observation grant and capture guard, sends no input and keeps no frame.
  async burst(args){
    const w=await this.grant(Number(args.hwnd),args.reason,{observationOnly:true});this.check();
    if(w.fullscreen||w.other_desktop||w.minimized||w.hidden)fail('window_capture_unavailable','Recording needs the window visible on this desktop. Bring it forward, then try again.');
    const generation=this.generation,handle=Number(args.hwnd);
    const count=Math.min(10,Math.max(2,Math.floor(Number(args.frames)||5))),interval=Math.min(1000,Math.max(50,Math.floor(Number(args.interval_ms)||200)));
    const maxWidth=Math.min(args.max_width||800,targetImageSize(w.rect[2],w.rect[3])[0]);
    this.guardian.send({op:'activity',action:'observe',hwnd:handle,...Runtime.prototype.glowTarget.call(this,w),...Runtime.prototype.hostLabel.call(this)});
    try{await this.guardian.request({op:'capture'});}
    catch(error){if(error.code==='guardian_request_timeout')fail('capture_preparation_timeout','Capture preparation timed out; Stop was attempted but is unconfirmed. Inspect status; do not replay input.');throw error;}
    const frames=[],start=performance.now();
    try{
      for(let i=0;i<count;i++){
        const due=start+i*interval-performance.now();if(due>0)await new Promise(resolve=>setTimeout(resolve,due));
        this.check();if(generation!==this.generation)fail('control_changed','Control changed during the recording. Observe again.');
        const shot=(await this.driver.call('screenshot',{...this.stamp(),hwnd:handle,__pid:w.pid,__started:w.started,max_width:maxWidth,quality:70})).result;
        if(shot.capture==='screen_occluded')fail('window_capture_unavailable','The window was covered during the recording. Bring it forward and try again.');
        frames.push({...shot,at_ms:Math.round(performance.now()-start)});
      }
    }finally{this.guardian.send({op:'capture_end'});}
    return {hwnd:handle,app:w.path,interval_ms:interval,frames:frames.length,images:frames};
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
    // until: the text has appeared. until_gone: observed text has disappeared;
    // an incomplete tree never counts as gone, and the text must be visible
    // when the wait starts, so a mistyped label cannot read as finished.
    const gone=typeof args.until_gone==='string',label=(gone?args.until_gone:args.until).toLowerCase();let seen=false;
    // Absence is only meaningful in a whole view: an 80-row reply omits rows in
    // ordinary windows such as File Explorer, so failure-aware and until_gone
    // waits read up to 500 rows.
    const wide=gone||!!args.abort_on?.length;
    const matches=view=>{const present=view.metadata.tree.toLowerCase().includes(label);return gone?seen&&!present&&view.metadata.tree_incomplete!==true:present;};
    const labelRefusal=view=>{
      if(view.metadata.tree_incomplete!==true)return finish({matched:false,label_not_observed:true,ok:false,error:{code:'wait_label_not_observed',message:'The text to wait on never appeared; the job may already have finished. This reply carries a fresh frame: act on it. The wait itself sent no input; never replay earlier steps.'},...view});
      this.frames.delete(view.metadata.observation_id);
      fail('wait_label_not_observed','The text to wait on never appeared and the tree was incomplete. Observe again. The wait itself sent no input; never replay earlier steps.');
    };
    do {
      this.check();latest=await observe({hwnd:args.hwnd,with_image:false,query:args.query,native_snapshot_deadline:until,require_native_budget:true,...(wide?{max_nodes:500}:{})});
      const failure=waitFailure(latest,args.abort_on);
      if(failure){
        if(args.with_image===false)return finish({matched:false,aborted:true,abort_match:failure,...latest});
        this.frames.delete(latest.metadata.observation_id);return finish({matched:false,aborted:true,abort_match:failure,...await observe({hwnd:args.hwnd,query:args.query,with_image:args.with_image,max_nodes:500,native_snapshot_deadline:until})});
      }
      // until_gone needs the label seen first. A label that only appears a
      // moment after the preceding click gets a short grace; one that never
      // appears is refused with this frame, so no extra snapshot is needed.
      if(gone&&!seen){
        if(latest.metadata.tree.toLowerCase().includes(label))seen=true;
        else if(performance.now()-started>=Math.min(UNTIL_GONE_GRACE_MS,budget)||performance.now()>=until)return labelRefusal(latest);
      }
      if(matches(latest)){
        // Do not authorize the next batch step based on a transient match in
        // an older frame. Confirm both success and failure on the returned view.
        this.frames.delete(latest.metadata.observation_id);
        const verified=await observe({hwnd:args.hwnd,query:args.query,with_image:args.with_image,native_snapshot_deadline:until,require_native_budget:true,...(wide?{max_nodes:500}:{})});
        const verifiedFailure=waitFailure(verified,args.abort_on);
        if(verifiedFailure)return finish({matched:false,aborted:true,abort_match:verifiedFailure,...verified});
        if(args.abort_on?.length&&verified.metadata.tree_incomplete)return finish({matched:false,incomplete:true,...verified});
        if(matches(verified))return finish({matched:true,...verified});
        if(args.with_image===false&&performance.now()>=until)return finish({matched:false,timed_out:true,...verified});
        latest=verified;
        if(performance.now()>=until){this.frames.delete(latest.metadata.observation_id);break;}
      } else {
        // A text-only timeout already has an observation to return. Starting
        // a second potentially slow capture after the budget is exhausted can
        // add latency without changing the fact that the wait must stop.
        if(gone&&!seen&&performance.now()>=until)return labelRefusal(latest);
        if(args.with_image===false&&performance.now()>=until)return finish({matched:false,timed_out:true,...latest});
        if(performance.now()>=until){this.frames.delete(latest.metadata.observation_id);break;}
      }
      await waitUntil(Math.min(until,performance.now()+500),{check:()=>{this.check();if(this.generation!==generation||this.driver?.epoch!==workerEpoch)fail('control_changed','Control or native worker changed while waiting. Observe again.');}});
      if(performance.now()>=until){
        if(gone&&!seen)return labelRefusal(latest);
        if(args.with_image===false)return finish({matched:false,timed_out:true,...latest});
        this.frames.delete(latest.metadata.observation_id);break;
      }
      this.frames.delete(latest.metadata.observation_id);
    }while(true);
    // Once the deadline has elapsed, the last completed observation is the
    // only trustworthy frame. Starting another capture here adds latency and
    // can change the answer after the wait has already timed out.
    if(latest)return finish({matched:false,timed_out:true,...latest});
    const final=await observe({hwnd:args.hwnd,query:args.query,with_image:args.with_image,native_snapshot_deadline:until,...(wide?{max_nodes:500}:{})});
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
    this.generation++;this.frames.clear();this.grants.clear();this.token='';this.sessionExpired=false;
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
      let cleanup;try{cleanup=await this.stop();}catch{}
      if(cleanup?.exited_native_cleanup_verified!==true){
        if(error?.code==='input_cleanup_failed')throw error;
        throw Object.assign(Error('End cleanup is unconfirmed; task evidence was retained. Inspect status without replaying input.'),{code:'guardian_end_unconfirmed',cause:error});
      }
    }
    if(!['stopped','paused'].includes(this.state)){this.state='idle';this.lastControlReason='completed';}
    // The replacement's new guard file is not the previous process's input
    // ledger. Its cleanup cannot establish what the crashed process held.
    if(this.recoveredTask&&!preserveTask){
      let verified=false;
      try{
        const record=readTaskRecord(this.taskFile);
        const unchanged=record.open&&record.guard===this.priorGuard&&record.dispatched===this.priorDispatched&&record.watchdogs_complete===this.priorWatchdogsComplete&&JSON.stringify(record.children)===JSON.stringify(this.priorChildren)&&record.guard;
        if(unchanged&&record.dispatched===false){
          // Opened, never dispatched: no native input worker was started.
          const directory=path.dirname(this.taskFile);storageOperation('verify-data-tree',directory);
          verified=priorUndispatchedCleanupVerified(directory,record);
        }
        else if(unchanged&&record.dispatched===true){
          const directory=path.dirname(this.taskFile);storageOperation('verify-data-tree',directory);
          // The verification helper itself can briefly reuse an old numeric
          // PID. Wait only for read-only proof; never ignore a live identity.
          const cleanupDeadline=performance.now()+500;
          do {verified=priorWindowsCleanupVerified(directory,record)||priorMacCleanupVerified(directory,record);if(verified)break;await new Promise(resolve=>setTimeout(resolve,25));}while(performance.now()<cleanupDeadline);
        }
      }catch{}
      if(!verified)fail('recovered_cleanup_unverified','Prior-session input cleanup is unverified. Keep the task open and inspect the previous native ledger; do not repeat input or force an update.');
      try{await this.sessions.clearVerifiedStale(Number(/^guard-(\d+)-/.exec(this.priorGuard)[1]));}
      catch{fail('recovered_cleanup_unverified','Previous input ownership could not be safely cleared. Keep the task open; do not repeat input or force an update.');}
      if(this.latchFile&&readStopLatch(this.latchFile)?.unconfirmed){
        try{const record=readTaskRecord(this.taskFile);if(record.guard!==this.priorGuard||JSON.stringify(record.children)!==JSON.stringify(this.priorChildren))throw Error('Prior task changed');settlePriorStop(this.latchFile,record);this.state='stopped';this.lastControlReason='prior_cleanup_verified';}
        catch{fail('guardian_stop_unconfirmed','Prior Stop context or native cleanup is unverified. Keep the recovery record and do not replay.');}
      }
    }
    if(!preserveTask){
      const stopped=this.latchFile?readStopLatch(this.latchFile):null;
      if(stopped?.unconfirmed||this.lastControlReason==='guardian_stop_unconfirmed')fail('guardian_stop_unconfirmed','Stop remains unconfirmed. Keep the task recovery record; inspect prior actors and input cleanup without replay.');
      if(stopped?.invalid||persistenceFailure(this.lastControlReason))fail('stop_persistence_failed','Stop storage is unverified. Keep the task recovery record and inspect private storage.');
      try{if(this.taskFile)writeAtomicJSON(this.taskFile,{schema:1,open:false});this.taskOpen=false;this.callerHost=null;this.recoveredTask=false;this.dispatchChildren=[];this.dispatchStarted=false;this.watchdogsComplete=true;this.taskDurable=true;}catch{this.taskOpen=true;this.taskDurable=false;throw Object.assign(Error('Input cleanup finished, but task state could not be saved. Updates remain deferred.'),{code:'task_state_write_failed'});}
    }return {ended:true,state:this.state,restart_required:false,session_handle:this.sessionHandle??null};}
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
    if(this.state==='stopped'&&this.lastControlReason==='guardian_stop_unconfirmed')fail('guardian_stop_unconfirmed','Stop delivery to native controls is unconfirmed. Inspect diagnostics and input cleanup; do not restart or replay.');
    if(this.recoveredTask)fail('recovered_task_requires_end','The controller restarted with an unfinished task. Inspect the prior result without replay, then end the owning task before launching another application.');
    if(this.state==='stopped'&&persistenceFailure(this.lastControlReason))fail(this.lastControlReason,'Control storage failed. Inspect private storage; do not restart or send input.');
    if(this.state==='stopped'){await this.showControls();this.check();}
    if(this.state==='paused')this.check();
    const {app,executable}=launchTarget(args.app);
    if(/^(?:AxonHost|StorageGuard)(?:-[0-9a-f]+)?(?:\.exe|\.app)?$/i.test(path.basename(app)))fail('protected_app','Cannot launch internal runtime helpers as target applications.');
    if(classify({process:path.basename(app),path:app},Runtime.prototype.callerPolicy.call(this)).tier===TIER.BLOCKED)fail('protected_app','Cannot launch a protected application.');
    // Validate the execution desktop before showing controls or launching apps.
    await this.driver.start();
    await this.guardian.start();
    if(this.state==='stopped'||this.state==='paused')this.check();
    if(!this.token){this.sessionExpired=false;this.token=randomUUID();this.deadline=Date.now()+contract.session_ms;this.remaining=contract.action_budget;}
    const activationGeneration=this.generation;
    const active=await this.guardian.request({op:'activate',token:this.token,deadline:(BigInt(this.deadline)*10000n+621355968000000000n).toString()});
    if(!active.allowed||this.state==='stopped'||this.state==='paused'||this.generation!==activationGeneration)fail('control_inactive','Control changed during activation. Use local controls and observe again.');this.state='active';this.check();
    if(Date.now()>=this.deadline||this.remaining<=0)fail('session_limit','Session expired or action budget exhausted. Renew the task (end, then ready) and continue from a fresh observation.');
    const payload={app,args:args.args||[],...this.stamp(),__risk:'sensitive'};
    await this.driver.start();
    this.guardian.send({op:'attach',pid:this.driver.info.pid});
    payload.__worker_epoch=this.driver.epoch;
    const a=await this.guardian.prompt({kind:'action',host_pid:this.driver.info.pid,action_op:'launch',args:payload,label:'',message:`Launch this application?\r\n\r\n${args.reason}\r\n\r\n${JSON.stringify({app,args:payload.args},null,2)}\r\n\r\nThis starts software with your account's privileges. No shell is used. Approve only if intended.`});
    if(!a.allowed)fail(a.decision==='timeout'?'approval_timeout':'permission_denied',a.decision==='timeout'?'Application launch approval timed out.':'Human denied application launch.');
    this.check();const launchGeneration=this.generation;
    const result=await this.sessions.withInput('launch',{title:path.basename(app)},async()=>{
      this.check();if(launchGeneration!==this.generation)fail('control_changed','Cancelled before launch.');
      if(Date.now()>=this.deadline||this.remaining<=0)fail('session_limit','Session expired or action budget exhausted. Renew the task (end, then ready) and continue from a fresh observation.');
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
      // Splash screens and small helper windows appear before the main window.
      // Observe only once the matching window set has been unchanged for
      // LAUNCH_SETTLE_MS, within LAUNCH_SETTLE_LIMIT_MS of the first match; a
      // lone small window waits out that limit in case the main window follows.
      let firstMatch=null,lastKey=null,stableSince=0;
      do {
        this.check();if(generation!==this.generation)fail('control_changed','Control changed after launch.');
        const windows=(await this.driver.call('list_apps',{})).result.windows;
        const matches=windows.filter(w=>w.pid===result.pid&&executableKey(path.resolve(w.path||''))===executableKey(executable)&&!w.minimized&&!w.other_desktop&&w.rect?.[2]>0&&w.rect?.[3]>0);
        if(matches.length){
          const now=performance.now();firstMatch??=now;
          const key=matches.map(w=>[w.hwnd,...w.rect].join(',')).sort().join('|');
          if(key!==lastKey){lastKey=key;stableSince=now;}
          const chosen=mainWindow(matches),settleEnd=Math.min(until,firstMatch+LAUNCH_SETTLE_LIMIT_MS);
          const small=chosen&&chosen.rect[2]<SMALL_WINDOW[0]&&chosen.rect[3]<SMALL_WINDOW[1];
          if((now-stableSince>=LAUNCH_SETTLE_MS&&!(small&&now<settleEnd))||now>=settleEnd){
            if(!chosen)return {...result,input_completed:true,observe_pending:true,observation_hint:'Several matching windows opened. Discover apps and select the intended window; do not relaunch.'};
            this.check();if(generation!==this.generation)fail('control_changed','Control changed after launch.');
            // The new app comes to the front before the first look, so the
            // person sees what the agent will work on, and a window that
            // resizes as it activates settles before the first frame. This
            // is the same app approval observe asks for; a refused focus
            // still observes.
            try{
              await this.action('focus',{hwnd:Number(chosen.hwnd),reason:args.reason,risk:'routine'});
              await Runtime.prototype.settleWindow.call(this,Number(chosen.hwnd),generation);
            }catch(error){if(['control_stopped','control_changed','session_limit','recovered_task_requires_end'].includes(error.code))throw error;}
            const observed=await this.observe({hwnd:Number(chosen.hwnd),reason:args.reason});
            return {...observed,result,input_completed:true};
          }
          await new Promise(resolve=>setTimeout(resolve,200));continue;
        }
        firstMatch=null;lastKey=null;
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
  // Waits until a window's rectangle has held still for FOCUS_SETTLE_MS, at
  // most FOCUS_SETTLE_LIMIT_MS, so a frame is not taken mid-resize.
  async settleWindow(hwnd,generation){
    const until=performance.now()+FOCUS_SETTLE_LIMIT_MS;let last=null,since=performance.now();
    while(performance.now()<until){
      this.check();if(generation!==this.generation)fail('control_changed','Control changed after launch.');
      const w=(await this.driver.call('list_apps',{})).result.windows.find(v=>Number(v.hwnd)===hwnd);
      if(!w)return;
      const key=(w.rect||[]).join(',');
      if(key!==last){last=key;since=performance.now();}
      else if(performance.now()-since>=FOCUS_SETTLE_MS)return;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
  }
  async stop(){
    this.callerHost=null;
    if(this.stopping)return this.stopping;
    const priorUnconfirmed=this.lastControlReason==='guardian_stop_unconfirmed';
    this.generation++;this.frames.clear();this.grants.clear();this.state='stopped';this.lastControlReason='requested_stop';
    const work=Promise.resolve().then(()=>this.stopTransaction(priorUnconfirmed));this.stopping=work;
    try{return await work;}finally{if(this.stopping===work)this.stopping=null;}
  }
  async exitedCurrentCleanupVerified(){
    if(this.recoveredTask||!this.taskFile||this.driver.inputMayBeHeld!==false||!this.dispatchStarted||!this.watchdogsComplete)return false;
    if(this.driver.proc||this.driver.starting||this.guardian.proc||this.guardian.starting)return false;
    try{
      const record=readTaskRecord(this.taskFile),directory=path.dirname(this.taskFile);
      if(!record.open||record.guard!==path.basename(this.guardFile)||path.resolve(this.guardFile)!==path.join(directory,record.guard)||!record.guard.startsWith('guard-'+process.pid+'-')||record.children?.includes(process.pid)||JSON.stringify(record.children)!==JSON.stringify(this.dispatchChildren))return false;
      storageOperation('verify-data-tree',directory);
      // This same live JS instance owns the bound guard; only its native input
      // actors must have exited. No caller-supplied PID/verification flag exists.
      const probe=pid=>{if(pid===process.pid)throw Object.assign(Error('Current JS owner is not an input actor'),{code:'ESRCH'});process.kill(pid,0);};
      const until=performance.now()+500;
      do{if(priorWindowsCleanupVerified(directory,record,{probe})||priorMacCleanupVerified(directory,record,{probe}))return true;await new Promise(resolve=>setTimeout(resolve,25));}while(performance.now()<until);
    }catch{}
    return false;
  }
  async stopTransaction(priorUnconfirmed){
    if(typeof this.guardian.stopAcknowledged==='function'&&this.guardian.requiresStopAcknowledgement){
      const old=this.latchFile?readStopLatch(this.latchFile):null;
      const boundNonce=!this.recoveredTask&&old?.unconfirmed?currentStopNonce(this.latchFile,path.basename(this.guardFile)):null;
      const nonce=boundNonce||randomUUID().replaceAll('-','');let marker,rootIdentity,persistenceFailed=false;
      const maySettle=(!priorUnconfirmed&&!old?.unconfirmed||!!boundNonce)&&!old?.invalid&&!this.recoveredTask;
      try{if(!this.latchFile)throw Error('Missing Stop path');rootIdentity=fs.lstatSync(path.dirname(this.latchFile),{bigint:true});marker=persistRecoveryStop(this.latchFile,this.recoveredTask&&this.priorGuard?this.priorGuard:path.basename(this.guardFile),{unconfirmed:true,nonce});}
      catch{persistenceFailed=true;this.lastControlReason='stop_persistence_failed';}
      const outcomes=await Promise.allSettled([Promise.resolve().then(()=>this.guardian.stopAcknowledged(nonce)),Promise.resolve().then(()=>this.driver.abort?.())]);
      if(outcomes[1].status==='rejected'){this.lastControlReason='input_cleanup_failed';throw outcomes[1].reason;}
      if(persistenceFailed||persistenceFailure(this.lastControlReason))throw Object.assign(Error('Stop persistence is unconfirmed. Inspect private storage; do not restart.'),{code:'stop_persistence_failed'});
      const receipt=outcomes[0].status==='fulfilled'?outcomes[0].value:null;
      const freshReceipt=receipt?.stop_nonce===nonce&&receipt.workers_stopped===true&&receipt.input_cleanup_confirmed===true;
      const exitedProof=!freshReceipt&&maySettle&&await this.exitedCurrentCleanupVerified();
      if(!maySettle||marker?.value!=='unconfirmed:'+nonce||(!freshReceipt&&!exitedProof)||this.driver.inputMayBeHeld!==false){
        this.lastControlReason='guardian_stop_unconfirmed';throw Object.assign(Error('Native Stop or prior cleanup is unconfirmed. Inspect diagnostics; do not replay.'),{code:'guardian_stop_unconfirmed'});
      }
      try{settleFreshStopLatch(this.latchFile,nonce,rootIdentity);}catch{this.lastControlReason='guardian_stop_unconfirmed';throw Object.assign(Error('Stop changed before confirmation could be persisted; control remains stopped.'),{code:'guardian_stop_unconfirmed'});}
      this.lastControlReason='requested_stop';return {stopped:true,...STOP_ENDS_TASK,native_stop_confirmed:true,...(exitedProof?{exited_native_cleanup_verified:true}:{} )};
    }
    let unconfirmed=priorUnconfirmed||this.privateDataStorage===true&&typeof this.guardian.stopAcknowledged!=='function';
    try{const sent=this.guardian.send({op:'stop'});unconfirmed=unconfirmed||sent===false&&!!(this.guardian.proc||this.guardian.starting||this.guardian.cleanupFailed);}catch{unconfirmed=true;}
    let persistenceFailed=false;
    try{if(this.latchFile)unconfirmed=persistRecoveryStop(this.latchFile,this.recoveredTask&&this.priorGuard?this.priorGuard:path.basename(this.guardFile),{unconfirmed}).unconfirmed;}
    catch{persistenceFailed=true;this.lastControlReason='stop_persistence_failed';}
    if(unconfirmed&&!persistenceFailed)this.lastControlReason='guardian_stop_unconfirmed';
    await this.driver.abort?.();
    if(persistenceFailed)throw Object.assign(Error('Control is stopped, but the emergency Stop latch could not be saved. Do not restart the controller; inspect its private storage.'),{code:'stop_persistence_failed'});
    if(unconfirmed)throw Object.assign(Error('The local Stop latch and cleanup were attempted, but delivery to native controls is unconfirmed. Inspect status; do not replay.'),{code:'guardian_stop_unconfirmed'});
    return {stopped:true,...STOP_ENDS_TASK};
  }
  markActivity(){if(this.taskOpen===true)this.lastActivityAt=Date.now();}
  // Read-only evidence that tells a leftover task from a live one. Never includes tokens or window titles.
  taskInfo(now=Date.now()){
    const open=this.taskOpen===true,recovered=this.recoveredTask===true;
    let activityAt=this.lastActivityAt??null;
    if(open&&recovered&&activityAt===null&&this.taskFile){try{activityAt=fs.statSync(this.taskFile).mtimeMs;}catch{}}
    const held={grants:this.grants.size,input_held:this.driver?.inputMayBeHeld===true};
    const holding=held.grants>0||held.input_held;
    const idle=activityAt===null?null:Math.max(0,Math.round(now-activityAt));
    let liveness='none',rule='No task is open.';
    if(open){
      if(recovered){liveness='orphaned';rule='The task was found after a controller restart; no running controller owns it.';}
      else if(idle!==null&&idle>TASK_IDLE_MS&&!holding){liveness='orphaned';rule=`No action for over ${TASK_IDLE_MS/1000} s and no grant or input held.`;}
      else if(idle!==null&&idle>TASK_IDLE_MS){liveness='idle';rule=`No action for over ${TASK_IDLE_MS/1000} s but a grant or input is still held.`;}
      else{liveness='active';rule=`Opened or acted within ${TASK_IDLE_MS/1000} s.`;}
    }
    return {task_age_ms:open&&this.taskOpenedAt?Math.max(0,Math.round(now-this.taskOpenedAt)):null,last_activity_ms_ago:open?idle:null,actions_used:this.token&&Number.isFinite(this.remaining)?Math.max(0,contract.action_budget-this.remaining):0,actions_limit:contract.action_budget,held_resources:held,task_origin:!open?'none':recovered?'previous_controller':'this_controller',controller_uptime_ms:Math.round(process.uptime()*1000),task_liveness:liveness,task_liveness_rule:rule};
  }
  status(){return {...Runtime.prototype.taskInfo.call(this),state:this.state,task_open:this.taskOpen===true,recovered_task:this.recoveredTask===true,remaining_actions:this.remaining,approved_apps:[...this.grants.values()].map(w=>({pid:w.pid,path:w.path,tier:w.tier??accessTier(w,Runtime.prototype.callerPolicy.call(this))})),runtime:nativePlatform().runtime,build_version:VERSION,build_id:BUILD_ID,private_data_storage:this.privateDataStorage,real_cursor:true,custom_cursor:this.guardian.customCursor??null,permission_mode:this.permissionMode,...(this.approvalsSaved===false?{approvals_saved:false}:{}),takeover_mode:this.guardian.takeoverMode||savedTakeoverMode(path.join(dataDir(),'control-preferences.json'),this.takeoverMode),control_reason:this.lastControlReason,...(this.state==='stopped'&&HUMAN_STOP_REASONS.has(this.lastControlReason)?{stopped_by_human:true}:{}),...Runtime.prototype.callerReport.call(this)};}
  async close(){const normal=this.state==='idle';if(!normal)await this.stop();else await this.driver.abort?.();await this.guardian.close({normal});this.sessions.close();}
}
