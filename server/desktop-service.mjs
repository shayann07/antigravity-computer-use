// Local, capability-authenticated IPC for skill scripts. No MCP or model SDK.
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {Runtime} from './runtime.mjs';
import {call} from './desktop-tools.mjs';
import {dataDir} from './build.mjs';
import {BUILD_ID} from './version.mjs';
import {Receipts} from './receipts.mjs';
import {loadDeployment,applyDeployment} from './deployment.mjs';
import {acquireServiceLease} from './service-lease.mjs';
import {fileURLToPath} from 'node:url';
import {ipcEndpoint} from './platform.mjs';
import {Incidents} from './incidents.mjs';
import {scheduleUpdates} from './auto-update.mjs';
import {recoveryAdvice,safeWaitMetrics} from './recovery.mjs';

export function compact(result,dir){
  const value={...result};
  if(value.metadata){value.metadata={...value.metadata};delete value.metadata.elements;delete value.metadata.image;}
  if(result.image?.data){
   try {
    const folder=path.join(dir,'observations');fs.mkdirSync(folder,{recursive:true});
    const file=path.join(folder,result.metadata.observation_id+'.jpg');
    fs.writeFileSync(file,Buffer.from(result.image.data,'base64'),{mode:0o600});
    value.image={path:file,width:result.image.width,height:result.image.height,source:result.image.source,capture:result.image.capture};
    // Observations are short-lived local data, not an unbounded screen archive.
    const files=fs.readdirSync(folder).map(name=>({name,at:fs.statSync(path.join(folder,name)).mtimeMs})).sort((a,b)=>b.at-a.at);
    for(const old of files.slice(50))fs.unlinkSync(path.join(folder,old.name));
   }catch{
    delete value.image;value.image_error={code:'image_delivery_failed',message:'The image could not be stored. Observe again; completed input must not be repeated.'};
    value.observation_valid=false;value.observe_before_continuing=true;
    if(value.input_completed&&!value.verification_error)value.verification_error=value.image_error;
   }
  }
  return value;
}

export async function serveDesktop({directory=dataDir(),runtime,idlePolicy='shutdown',idleTimeoutMs=15*60000,idleCheckMs=10000}={}){
  if(!['release','shutdown'].includes(idlePolicy))throw Error('Invalid listener idle policy.');
  fs.mkdirSync(directory,{recursive:true});
  const ownership=await acquireServiceLease(directory);let ownershipLost=false,initialized=false;
  ownership.on('lost',()=>{ownershipLost=true;Promise.resolve().then(()=>runtime?.stop?.()).catch(()=>{});});
  const file=path.join(directory,'desktop-session.json');
  try{
    ownership.assertHeld();
    // Also respect an older controller that predates kernel ownership leases.
    if(fs.existsSync(file)){
      const previous=JSON.parse(fs.readFileSync(file,'utf8'));
      if(!Number.isSafeInteger(previous.pid)||previous.pid<=0)throw Object.assign(Error('Invalid saved controller metadata; inspect it before recovery.'),{code:'invalid_session_metadata'});
      let alive=true;try{process.kill(previous.pid,0);}catch(error){if(error.code==='ESRCH')alive=false;}
      if(alive)throw Object.assign(Error('A live controller already owns the saved session. No replacement was created.'),{code:'service_already_running'});
    }
    runtime??=new Runtime();initialized=true;await runtime.prepare?.();
    if(ownership.lost)throw Object.assign(Error('Controller ownership was lost during startup.'),{code:'service_ownership_lost'});
  }catch(error){if(initialized)await Promise.resolve().then(()=>runtime.close?.()).catch(()=>{});await ownership.release();throw error;}
  const secret=randomBytes(32).toString('hex');
  let pipe=ipcEndpoint(directory,randomBytes(18).toString('hex'));
  let busy=false,closing=false,lastCall=Date.now(),expiry,shutdownPending,idleReleased=false;
  let maintenanceUntil=0;
  const sockets=new Set();
  const receipts=new Receipts(directory);
  const incidents=new Incidents(directory);
  const pendingIncidents=new Set();
  const queueIncident=(name,reply)=>{const id=incidents.identify(name,reply);if(!id)return;reply.incident_id=id;reply.diagnostic_pending=true;
   const pending=new Promise(resolve=>setImmediate(resolve)).then(()=>incidents.recordSerialized(name,reply)).catch(()=>{runtime.diagnosticError='private_diagnostic_storage_unavailable';});
   pendingIncidents.add(pending);pending.finally(()=>pendingIncidents.delete(pending));};
  const shutdown=()=>{
    if(shutdownPending)return shutdownPending;
    shutdownPending=(async()=>{closing=true;
    try{await runtime.close();while(pendingIncidents.size)await Promise.allSettled([...pendingIncidents]);}catch(error){closing=false;throw error;}
    clearInterval(expiry);
    for(const socket of sockets)socket.end();server.close();
    try{const saved=JSON.parse(fs.readFileSync(file));if(saved.pid===process.pid&&saved.secret===secret)fs.unlinkSync(file);}catch{}
    await ownership.release();
    })().catch(error=>{shutdownPending=null;throw error;});
    return shutdownPending;
  };
  const server=net.createServer(socket=>{
    socket.setEncoding('utf8');
    sockets.add(socket);let buffer='',received=false,executing=false,finished=false,stopOnDisconnect=true,ticket;
    socket.setTimeout(105000,()=>socket.destroy());
    socket.on('error',()=>{});
    socket.on('close',()=>{sockets.delete(socket);if(executing&&!finished&&stopOnDisconnect)runtime.stop().catch(()=>{});});
    socket.on('data',chunk=>{
      if(received)return;buffer+=chunk;
      if(Buffer.byteLength(buffer)>1024*1024){received=true;socket.destroy();return;}
      if(!buffer.includes('\n'))return;received=true;
      (async()=>{
        let request;try{request=JSON.parse(buffer.slice(0,buffer.indexOf('\n')));}catch{throw Error('Invalid request');}
        const given=Buffer.from(String(request.secret||''));const expected=Buffer.from(secret);
        if(given.length!==expected.length||!timingSafeEqual(given,expected))throw Error('Unauthorized local client');
        lastCall=Date.now();idleReleased=false;
        const name=request.command?.startsWith('computer_')?request.command:'computer_'+request.command;
        // Discovery sends no desktop input and changes no grants. Losing its
        // client must not latch emergency Stop on an otherwise active task.
        // Observations can open permission dialogs, so they still cancel.
        stopOnDisconnect=name!=='computer_apps';
        // A replacement starts passively under the updater's installation lock.
        // No task may acquire control until health verification and unlock.
        if(fs.existsSync(path.join(path.dirname(directory),'update-switching.json'))&&!['computer_status','computer_stop','computer_shutdown','computer_prepare_update'].includes(name))throw Object.assign(Error('Installation update is in progress; no desktop input was accepted.'),{code:'update_in_progress'});
        ticket=receipts.begin(name,request.args);
        if(!closing)try{ownership.assertHeld();}catch{ownershipLost=true;}
        if(ownershipLost&&!['computer_status','computer_stop','computer_end','computer_shutdown'].includes(name))throw Object.assign(Error('Controller ownership was lost. Control is stopped; do not send or replay input.'),{code:'service_ownership_lost',hint:'End/shutdown for cleanup, then restart the App sidecar. A latched Stop still needs local human re-arm. Do not repeat the interrupted action.'});
        if(closing&&!['computer_status','computer_stop','computer_shutdown'].includes(name))throw Error('Desktop service is shutting down; no more actions are accepted.');
        const versionMismatch=request.expected_build_id!==BUILD_ID;
        const policyMismatch=['standalone','host-managed'].includes(runtime.permissionMode)&&request.expected_permission_mode!==runtime.permissionMode;
        let foreignShutdown=false;
        if(name==='computer_shutdown'&&(versionMismatch||policyMismatch)){
          let state;try{state=runtime.status();}catch{}
          foreignShutdown=busy||state?.task_open!==false||!['idle','stopped'].includes(state?.state);
        }
        if(versionMismatch&&(!['computer_status','computer_stop','computer_pause','computer_shutdown'].includes(name)||foreignShutdown))
          throw Object.assign(Error('This command belongs to a different build. Use the running release; do not silently mix runtime versions.'),{code:'version_mismatch'});
        if(policyMismatch&&(!['computer_status','computer_stop','computer_pause','computer_shutdown'].includes(name)||foreignShutdown))
          throw Object.assign(Error('This client and live service use different permission policies. Finish the owning task and shutdown before starting the intended policy.'),{code:'deployment_policy_mismatch'});
        if(name==='computer_prepare_update'){
          const state=runtime.status();
          const allowed=!busy&&!closing&&state.task_open===false&&['idle','stopped'].includes(state.state)&&!['guardian_stop_unconfirmed','stop_persistence_failed','guard_persistence_failed'].includes(state.control_reason)&&!state.approved_apps?.length;
          if(allowed)maintenanceUntil=Date.now()+30000;
          finished=true;socket.end(JSON.stringify({ok:allowed,prepared:allowed,next_action:allowed?'shutdown_for_update':'wait_for_task_end'})+'\n');return;
        }
        if(maintenanceUntil>Date.now()&&!['computer_status','computer_stop','computer_shutdown'].includes(name))throw Object.assign(Error('An installation update is preparing. No new input was accepted.'),{code:'update_in_progress'});
        const control=['computer_status','computer_stop','computer_pause','computer_shutdown'].includes(name);
        if(busy&&!control)throw Error('Desktop operation pending; send one action at a time.');
        if(name==='computer_shutdown'){
          // Do not acknowledge a closed service before native cleanup succeeds.
          // Keep this reply socket alive while retiring all other clients.
          sockets.delete(socket);await shutdown();finished=true;
          const result={ok:true,closed:true};result.receipt=receipts.finish(ticket,result);socket.end(JSON.stringify(result)+'\n');return;
        }
        if(!control){busy=true;executing=true;}
        try{
          const raw=await call(runtime,name,request.args||{});
          const result=compact(name==='computer_status'?{...raw,listener_idle_policy:idlePolicy,controller_ownership_lost:ownershipLost,...(request.expected_build_id!==BUILD_ID?{client_build_mismatch:true,next_action:'resolve_version_mismatch'}:{}),...(pendingIncidents.size?{diagnostic_pending:pendingIncidents.size}:{}),...(runtime.diagnosticError?{diagnostic_error:runtime.diagnosticError}:{})}:raw,directory);
          if(result.observation_valid===false)runtime.frames?.delete(result.metadata?.observation_id);
          const reply={ok:true,...result};reply.receipt=receipts.finish(ticket,reply);
          if(reply.error||reply.verification_error)Object.assign(reply,recoveryAdvice(reply));
          queueIncident(name,reply);
          finished=true;socket.end(JSON.stringify(reply)+'\n');
        }finally{if(!control)busy=false;}
      })().catch(error=>{finished=true;const result={ok:false,...(safeWaitMetrics(error.wait_metrics)?{wait_metrics:safeWaitMetrics(error.wait_metrics)}:{}),...(error.delivery_unknown===true||error.code==='input_outcome_unknown'?{delivery_unknown:true,observe_before_continuing:true}:{}),...(error.repeated_failure===true?{repeated_failure:true}:{}),...(Number.isSafeInteger(error.recovery_attempts_remaining)?{recovery_attempts_remaining:error.recovery_attempts_remaining}:{}),error:{code:error.code||'refused',message:error.message,...(error.hint?{hint:error.hint}:{})}};Object.assign(result,recoveryAdvice(result));queueIncident(ticket?.command,result);if(ticket)result.receipt=receipts.finish(ticket,result);socket.end(JSON.stringify(result)+'\n');});
    });
  });
  server.on('error',()=>shutdown().catch(()=>{}));
  const temporary=path.join(directory,`desktop-session-${process.pid}-${randomBytes(6).toString('hex')}.tmp`);
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(pipe,resolve);});
    if(process.platform==='darwin')pipe={host:'127.0.0.1',port:server.address().port};
    ownership.assertHeld();fs.writeFileSync(temporary,JSON.stringify({pid:process.pid,pipe,secret}),{mode:0o600});fs.renameSync(temporary,file);
  }catch(error){try{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}catch{}await shutdown();throw error;}
  expiry=setInterval(()=>{
    if(busy||closing||Date.now()-lastCall<=idleTimeoutMs)return;
    // A long host/model decision gap is not task completion. In particular,
    // never clear grants, close the service, or disturb a human pause while an
    // explicitly open task awaits its next call.
    let state;try{state=runtime.status();}catch{return;}
    if(!state||typeof state!=='object'||state.task_open!==false||!['idle','active','paused','stopped'].includes(state.state))return;
    if(state.state==='paused')return;
    if(idlePolicy==='shutdown'){shutdown().catch(()=>{});return;}
    // A local sidecar may keep its private listener, never its control grants.
    // Preserve a human Pause/Stop; this is not an automatic Resume/re-arm.
    if(idleReleased||state.state==='stopped')return;
    idleReleased=true;busy=true;
    Promise.resolve().then(()=>runtime.finish({preserveTask:true})).catch(()=>runtime.stop()).catch(()=>{}).finally(()=>{busy=false;});
  },idleCheckMs);expiry.unref();
  const onSignal=()=>shutdown().catch(()=>{});
  process.once('SIGTERM',onSignal);process.once('SIGINT',onSignal);
  server.once('close',()=>{process.removeListener('SIGTERM',onSignal);process.removeListener('SIGINT',onSignal);});
  return {shutdown,server,file,ownership,status:()=>({...runtime.status(),listener_idle_policy:idlePolicy,controller_ownership_lost:ownershipLost})};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)&&process.argv[2]==='--serve'){const policy=applyDeployment(loadDeployment());const service=await serveDesktop({idlePolicy:policy.idle_policy||'shutdown'});const cancel=scheduleUpdates(policy);service.server.once('close',cancel);}
