// One command per observed desktop step. Persistent native session via local IPC.
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {dataDir} from '../server/build.mjs';
import {VERSION,BUILD_ID} from '../server/version.mjs';
import {TOOLS,validate} from '../server/desktop-tools.mjs';
import {parseArguments,parseRunArguments} from './arguments.mjs';
import {storageOperation} from '../server/storage.mjs';
import {loadDeployment,applyDeployment} from '../server/deployment.mjs';
import {diagnostics} from './diagnostics.mjs';
import {scheduleUpdates} from '../server/auto-update.mjs';
import {Incidents} from '../server/incidents.mjs';
import {recoveryAdvice} from '../server/recovery.mjs';
const EMPTY_INPUT={type:'object',properties:{},required:[],additionalProperties:false};
const LIFECYCLE=[
  {command:'start',description:'Start or reconnect to this exact installed build. No arguments. Never clears emergency Stop or changes the installed permission policy.',inputSchema:EMPTY_INPUT},
  {command:'serve',description:'Run the exact installed service in the foreground. For an interactive host terminal use run_command IsDaemon:true and WaitMsBeforeAsync:1000. Windows exebox terminals need the installed App sidecar or local starter. No permission/data overrides. Reuses only a matching live build/policy.',inputSchema:EMPTY_INPUT},
  {command:'shutdown',description:'Shut down the native service after input cleanup. No arguments. Preserves emergency Stop for human re-arm.',inputSchema:EMPTY_INPUT},
  {command:'describe',description:'Read command descriptions or the exact argument schema for one command, without desktop access.',usage:'describe [COMMAND]',inputSchema:{type:'object',properties:{command:{type:'string'}},required:[],additionalProperties:false}}
];

export function describeCommand(name){
  const normalized=String(name).replace(/^computer_/,'');
  const intrinsic=LIFECYCLE.find(tool=>tool.command===normalized);if(intrinsic)return intrinsic;
  const tool=TOOLS.find(tool=>tool.name==='computer_'+normalized);
  if(!tool)throw Object.assign(Error('Unknown desktop command. Run --help for the command list.'),{code:'unknown_command'});
  const properties=tool.inputSchema.properties||{};
  const cliAliases=[];
  if(properties.text)cliAliases.push({flag:'--text-file',replaces:'--text',description:'Read UTF-8 text from a local file; do not combine with --text. The same text limit and permissions apply.'});
  if(properties.steps)cliAliases.push({flag:'--steps-file',replaces:'--steps',description:'Read the steps JSON array from a local file; do not combine with --steps.'});
  return {command:tool.name.replace(/^computer_/,''),description:tool.description,inputSchema:tool.inputSchema,...(cliAliases.length?{cliAliases}:{})};
}

// Windows PowerShell can decode native stdout using its legacy OEM code page
// before piping it to UTF-8. ASCII JSON preserves every Unicode code unit even
// through that boundary; JSON.parse restores the original text exactly.
export function encodeReply(value){return JSON.stringify(value).replace(/[^\x00-\x7f]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));}
export function briefReply(value){
 const out={...value};
 if(out.metadata){const m=out.metadata;delete out.metadata;out.observation_id=m.observation_id;out.hwnd=m.hwnd;out.tree=m.tree;
  if(typeof m.tree_incomplete==='boolean')out.tree_incomplete=m.tree_incomplete||out.tree_incomplete===true;
 }
 if(out.image){out.image={path:out.image.path,width:out.image.width,height:out.image.height};}
 if(out.windows)out.windows=out.windows.map(({hwnd,title,process,minimized,hidden,fullscreen,other_desktop,foreground})=>({hwnd,title,process,minimized,...(hidden?{hidden:true}:{}),...(fullscreen?{fullscreen:true}:{}),...(other_desktop?{other_desktop:true}:{}),foreground}));
 return out;
}
let replyMode='json';
const printReply=value=>console.log(encodeReply(replyMode==='brief'?briefReply(value):value));
export function failureReply(error){
 const result={ok:false,error:{code:error.code||'refused',message:error.message},next_action:'inspect_diagnostics'};
 for(const field of ['delivery_unknown','observe_before_continuing','cancellation_requested','repeated_failure'])if(error[field]===true)result[field]=true;
 if(Number.isSafeInteger(error.recovery_attempts_remaining))result.recovery_attempts_remaining=error.recovery_attempts_remaining;
 Object.assign(result,recoveryAdvice(result));
 return result;
}
export async function recordedFailureReply(error){
 const result=failureReply(error);
 try{applyDeployment(loadDeployment());const folder=dataDir();storageOperation('verify',folder);result.incident_id=await new Incidents(folder).recordSerialized('computer_startup',result);}
 catch{result.diagnostic_error='private_diagnostic_storage_unavailable';}
 return result;
}

export function request(session,command,args={},timeout=100000,expectedPermissionMode){
  return new Promise((resolve,reject)=>{
    let buffer='',settled=false,connected=false;
    const socket=net.createConnection(session.pipe);
    socket.setEncoding('utf8');
    const transportFailure=(code,message)=>Object.assign(Error(message),{code,...(connected?{delivery_unknown:true,observe_before_continuing:true,cancellation_requested:true}:{})});
    const done=(error,result)=>{if(settled)return;settled=true;clearTimeout(deadline);socket.destroy();error?reject(error):resolve(result);};
    // Absolute deadline: partial bytes cannot keep a hung action alive forever.
    // Closing the connection requests server cancellation, not proof of cleanup.
    const deadline=setTimeout(()=>done(transportFailure('request_timeout','Desktop request timed out. Cancellation was requested; completion is unconfirmed. Inspect status and the actual app before continuing; do not replay the action.')),timeout);
    socket.on('connect',()=>{connected=true;socket.write(JSON.stringify({secret:session.secret,command,args,expected_build_id:BUILD_ID,expected_permission_mode:expectedPermissionMode})+'\n');});
    socket.on('data',chunk=>{
      buffer+=chunk;
      if(Buffer.byteLength(buffer)>4*1024*1024)return done(transportFailure('service_response_too_large','Desktop response exceeded its limit. Completion is unconfirmed; inspect the app without replaying the action.'));
      const newline=buffer.indexOf('\n');if(newline<0)return;
      let result;
      try{
        result=JSON.parse(buffer.slice(0,newline));
        if(!result||Array.isArray(result)||typeof result!=='object'||typeof result.ok!=='boolean')throw Error();
      }catch{
        return done(transportFailure('invalid_service_response','Desktop returned an invalid acknowledgement. Completion is unconfirmed; inspect the app without replaying the action.'));
      }
      done(null,result);
    });
    socket.on('error',()=>done(transportFailure(connected?'connection_lost':'session_unavailable',connected?'Desktop connection lost; input delivery may be unknown. Do not replay the action. Inspect status and observe again.':'The saved desktop service is unreachable. Inspect/restart the installed Computer Use App sidecar or use its human starter from the normal Windows desktop, then discover apps and observe again. Isolated exebox terminals cannot start visible-desktop control. Do not use WMI or bypass host security. Emergency Stop remains latched.')));
    socket.on('end',()=>{if(!settled)done(transportFailure('session_disconnected','Desktop session disconnected before acknowledging completion; inspect the app without replaying the action.'));});
    socket.on('close',()=>{if(!settled)done(transportFailure(connected?'connection_lost':'session_unavailable','Desktop connection closed before acknowledging completion; inspect status before continuing.'));});
  });
}

export async function main(){
  const [rawCommand,...rest]=process.argv.slice(2);const command=rawCommand?.replace(/^computer_/,'');
  if(command==='diagnostics'){applyDeployment(loadDeployment());if(rest.some(a=>a!=='--submit'))throw Error('Use diagnostics [--submit]');printReply(await diagnostics(dataDir(),{submit:rest.includes('--submit')}));return;}
  if(command==='update'){
    const deployment=applyDeployment(loadDeployment());if(!deployment.installed)throw Error('Updates require a supported installation.');
    if(rest.length!==1||!['status','check','apply','rollback'].includes(rest[0]))throw Error('Use update status|check|apply|rollback');
    // Use immutable release Node, not the mutable short launcher being replaced.
    const {spawn}=await import('node:child_process');const {nativePlatform}=await import('../server/platform.mjs');
    const asynchronous=['apply','rollback'].includes(rest[0]);
    const child=spawn(fileURLToPath(new URL('../'+nativePlatform().node,import.meta.url)),[fileURLToPath(new URL('./update.mjs',import.meta.url)),path.dirname(dataDir()),rest[0],...(asynchronous?[String(process.pid)]:[])],{windowsHide:true,detached:asynchronous,stdio:asynchronous?'ignore':['ignore','inherit','inherit']});
    if(asynchronous){await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();printReply({queued:true,next_action:'inspect_update_status',message:'Update worker waits for this launcher to exit before replacing files.'});return;}
    await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>{process.exitCode=code??1;resolve();});});return;
  }
  if(rest[0]==='--help'){printReply(describeCommand(command));return;}
  if(command==='describe'||(command==='--help'&&rest[0])){
    if(rest[0]==='--all')printReply({commands:[...LIFECYCLE,...TOOLS.map(tool=>describeCommand(tool.name))]});
    else if(rest.length>1)printReply({commands:rest.map(describeCommand)});
    else printReply(rest[0]?describeCommand(rest[0]):{commands:[...LIFECYCLE,...TOOLS.map(tool=>({command:tool.name.replace(/^computer_/,''),description:tool.description}))].map(({command,description})=>({command,description}))});return;
  }
  if(!command||command==='--help'){
    console.log('Native desktop skill (no MCP)\nserve | start | shutdown | describe [COMMAND...] | describe --all | '+TOOLS.map(tool=>tool.name.replace(/^computer_/,'' )).join(' | ')+'\nAntigravity: reuse the installed App sidecar; isolated exebox terminals cannot start visible-desktop control. The human starter runs on the normal Windows desktop. Interactive external terminals may use start or foreground serve. Fast path: snapshot --hwnd 123; click --hwnd 123 --observation-id FRAME --index 7 --reason "Open settings". Named action flags return a compact tree without a new image unless --image is requested. Open actual image.path at visual checkpoints. Use --text-file for generated bulk text. Fast batches: run --hwnd 123 --observation-id FRAME --reason "Import sample" --step click --index 7 --risk routine --step file_dialog --path "D:/sample.png" --action open --entry-method clipboard. Owner/frame/reason precede all --step groups. No JSON/plan file is needed; the final step returns an image by default. No per-action request/result files or JPEG copies are needed. One describe call can fetch multiple schemas; do not interrogate every command at startup. JSON inline and --request FILE remain supported; --json retains full output. Esc stops; only the human can re-arm.');return;
  }
  const jsonMode=rest[0]==='--json';if(jsonMode)rest.shift();
  replyMode=jsonMode||(rest.length&&(!rest[0].startsWith('--')||rest[0]==='--request'))?'json':'brief';
  const schema=describeCommand(command).inputSchema;
  const args=command==='run'?parseRunArguments(schema,rest,describeCommand):parseArguments(schema,rest);
  if(TOOLS.some(tool=>tool.name==='computer_'+command))validate('computer_'+command,args);
  else if(Object.keys(args).length)throw Object.assign(Error('This lifecycle command takes no arguments.'),{code:'bad_arguments'});
  const policy=applyDeployment(loadDeployment());
  const file=path.join(dataDir(),'desktop-session.json');
  if(command==='start'||command==='serve'||command==='ready'){
    storageOperation('data',dataDir());
    let existing,saved;
    try{saved=JSON.parse(fs.readFileSync(file));existing=await request(saved,'status',{},1500,policy.permission_mode);}catch{}
    if(existing?.ok){
      if(existing.build_id!==BUILD_ID||existing.build_version!==VERSION)throw Object.assign(Error('This skill and the running service use different builds. Do not interrupt an active task or change a pinned deployment. Inspect the intended scope and use a matching installed version.'),{code:'version_mismatch'});
      if(existing.permission_mode!==policy.permission_mode)throw Object.assign(Error('A different permission policy owns the live session. Finish and shutdown its task before using this installed policy; no override was applied.'),{code:'deployment_policy_mismatch'});
      printReply(command==='ready'?await request(saved,'ready',{},15000,policy.permission_mode):existing);return;
    }
    // An unresponsive live service may still be controlling the desktop. Never
    // replace its capability file or create a competing guardian after timeout.
    if(Number.isSafeInteger(saved?.pid)&&saved.pid>0){
      let alive=true;try{process.kill(saved.pid,0);}catch(error){if(error.code==='ESRCH')alive=false;}
      if(alive)throw Object.assign(Error('The existing desktop service is still running but did not answer. Do not start another controller. Wait for recovery or use the local Stop control; no replacement was launched.'),{code:'session_unresponsive'});
    }
    if(command==='serve'){
      const {serveDesktop}=await import('../server/desktop-service.mjs');
      const service=await serveDesktop({idlePolicy:policy.idle_policy||'shutdown'});
      const cancel=scheduleUpdates(policy);service.server.once('close',cancel);
      printReply({ok:true,...service.status(),service_mode:'foreground',requires_background_execution:true});return;
    }
    // Fixed deployment policy: never accept permission overrides in an action.
    // Host-managed is opt-in at installation; default is local human dialogs.
    if(!['standalone','host-managed'].includes(policy.permission_mode))throw Error('Invalid installed desktop policy');
    const child=spawn(process.execPath,[fileURLToPath(new URL('../server/desktop-service.mjs',import.meta.url)),'--serve'],{detached:true,windowsHide:true,stdio:'ignore',env:{...process.env,AGCU_PERMISSION_MODE:policy.permission_mode}});child.unref();
    for(let i=0;i<100;i++){
      await new Promise(resolve=>setTimeout(resolve,100));
      try{const session=JSON.parse(fs.readFileSync(file));const found=await request(session,'status',{},1500,policy.permission_mode);if(found.ok&&found.build_id===BUILD_ID&&found.permission_mode===policy.permission_mode){printReply(command==='ready'?await request(session,'ready',{},15000,policy.permission_mode):found);return;}}catch(error){if(command==='ready'&&error.code!=='session_unavailable')throw error;}
    }
    throw Error('Native session did not start; run the service in foreground for diagnostics.');
  }
  if(!fs.existsSync(file)){
    if(command==='status'){printReply({ok:true,state:fs.existsSync(path.join(dataDir(),'emergency.stop'))?'stopped':'not_running',build_version:VERSION,build_id:BUILD_ID,reconnect_required:true});return;}
    throw Object.assign(Error('No desktop session is running (it may have expired after15 idle minutes). Restart the installed App sidecar (or use its human starter on the normal Windows desktop), then discover apps and take a fresh observation. Antigravity does not need to restart; emergency Stop remains latched.'),{code:'no_session'});
  }
  const session=JSON.parse(fs.readFileSync(file));
  if(command==='shutdown'){
    const previous=await request(session,'status',{},100000,policy.permission_mode);
    // Preserve an old adapter's stop during migration, before that process exits.
    if(previous.state==='stopped')fs.writeFileSync(path.join(dataDir(),'emergency.stop'),'stopped');
  }
  const result=await request(session,command,args,100000,policy.permission_mode);printReply(result);if(!result.ok)process.exitCode=1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(async error=>{printReply(await recordedFailureReply(error));process.exitCode=1;});
