// Lifetime ownership for one controller per private data directory. The small
// existing Windows storage helper holds a kernel mutex until this pipe closes.
import {spawn,spawnSync} from 'node:child_process';import path from 'node:path';import {EventEmitter} from 'node:events';
import {ensureStorageGuard,storageOperationAsync} from './storage.mjs';
export async function acquireServiceLease(directory,{spawnProcess=spawn,helper=ensureStorageGuard(),prepareStorage=storageOperationAsync,startupTimeout=5000,cleanupTimeout=2000,releaseTimeout=2000}={}){
 const child=spawnProcess(helper,['lease',path.resolve(directory)],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 child.stdout.setEncoding('utf8');
 const lease=new EventEmitter();let ready=false,releasing=false,settled=false,buffer='',releasePending,publishPending,nativePrepared=false;
 let resolveExit;const exited=new Promise(resolve=>resolveExit=resolve);
 child.once('close',resolveExit);
 lease.pid=child.pid;lease.lost=false;
 const ownershipError=()=>Object.assign(Error('Controller ownership helper is unavailable. Control must stop.'),{code:'service_ownership_lost'});
 const markLost=()=>{if(!lease.lost){lease.lost=true;lease.emit('lost',ownershipError());}if(publishPending){const pending=publishPending;publishPending=null;clearTimeout(pending.timer);pending.reject(Object.assign(Error('Incident publication outcome is unknown.'),{code:'incident_publish_outcome_unknown'}));}};
 lease.assertHeld=()=>{if(releasing||lease.lost||child.exitCode!==null||child.signalCode!=null){markLost();throw ownershipError();}try{
  process.kill(child.pid,0);
  // A terminated POSIX child may remain a zombie until Node's event loop
  // reaps it. Synchronous rollback can block that loop between guard checks.
  if(process.platform==='darwin'){const state=spawnSync('/bin/ps',['-o','stat=','-p',String(child.pid)],{encoding:'utf8',timeout:3000});if(state.status!==0||!/^\s*[A-Z]/.test(state.stdout||'')||/^\s*Z/.test(state.stdout||''))throw Error('helper not live');}
 }catch{markLost();throw ownershipError();}};
 const startup=new Promise((resolve,reject)=>{
  const fail=error=>{if(settled)return;settled=true;clearTimeout(timer);releasing=true;try{child.kill();}catch{}
   // A killed helper may still hold the directory until Windows reaps it.
   // Wait for termination before the caller attempts recovery or cleanup.
   let wait;Promise.race([exited.then(()=>true),new Promise(resolve=>{wait=setTimeout(()=>resolve(false),cleanupTimeout);})]).then(closed=>{clearTimeout(wait);reject(closed?error:Object.assign(Error('Ownership helper termination could not be confirmed. Do not start another controller.'),{code:'service_lease_cleanup_unconfirmed',cause:error}));});};
  const timer=setTimeout(()=>fail(Object.assign(Error('Controller ownership helper did not answer; no controller was started.'),{code:'service_lease_timeout'})),startupTimeout);
  child.on('error',error=>fail(error));child.stderr.on('data',()=>{});
  child.stdin.on('error',()=>{if(ready&&!releasing)markLost();});
  child.stdout.on('data',chunk=>{
   buffer+=chunk;if(buffer.length>8192){if(!ready)fail(Error('Invalid ownership-helper reply.'));else {markLost();try{child.kill();}catch{}}return;}
   while(buffer.includes('\n')){const index=buffer.indexOf('\n'),line=buffer.slice(0,index);buffer=buffer.slice(index+1);
    try{const result=JSON.parse(line);if(!ready){if(!result.ok)throw Object.assign(Error(result.error?.message||'Controller ownership refused.'),{code:result.error?.code||'service_lease_refused'});if(!result.lease_acquired)throw Error('Missing controller ownership acknowledgement.');nativePrepared=result.private_storage_verified===true;clearTimeout(timer);settled=true;ready=true;resolve(lease);}
     else if(publishPending){const pending=publishPending;publishPending=null;clearTimeout(pending.timer);if(result.ok&&result.published)pending.resolve();else pending.reject(Object.assign(Error('Incident publication was not confirmed.'),{code:'incident_publish_outcome_unknown'}));}
    }catch(error){if(!ready)fail(error);else {markLost();try{child.kill();}catch{}}}
   }
  });
  child.once('exit',code=>{
   resolveExit(code);
   // stdout can still contain the structured refusal after exit. Node's
   // close event fires only after the streams drain; preserve that response.
   if(!ready)return;
   if(publishPending){const pending=publishPending;publishPending=null;clearTimeout(pending.timer);pending.reject(Object.assign(Error('Incident publication outcome is unknown.'),{code:'incident_publish_outcome_unknown'}));}
   if(!releasing)markLost();
  });
  child.once('close',()=>{if(!ready)fail(Object.assign(Error('Controller ownership helper exited before readiness.'),{code:'service_lease_exited'}));});
 });
 const publish=(bytes,op='publish_incidents')=>{
  lease.assertHeld();if(publishPending)throw Error('Incident publication already pending.');
  if(!Buffer.isBuffer(bytes)||bytes.length>256*1024)throw Error('Incident journal exceeds limit.');
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{publishPending=null;markLost();try{child.kill();}catch{}reject(Object.assign(Error('Incident publication outcome is unknown.'),{code:'incident_publish_outcome_unknown'}));},10000);
   publishPending={resolve,reject,timer};child.stdin.write(JSON.stringify({op,data:bytes.toString('base64')})+'\n',error=>{if(error)markLost();});
  });
 };
 lease.publishIncidents=bytes=>publish(bytes);
 lease.publishTaskOwner=bytes=>{if(!Buffer.isBuffer(bytes)||bytes.length>4096)throw Error('Task owner record exceeds limit');return publish(bytes,'publish_task_owner');};
 lease.release=()=>releasePending??=(async()=>{
  releasing=true;
  // A broken pipe can throw before signalling the helper. Still attempt
  // termination and confirm its exit; never turn that error into an assumed
  // release while an updater might be relying on the fence.
  let pipeClosed=true;try{child.stdin.end();}catch{pipeClosed=false;}
  const waitForExit=async ms=>{let timer;try{return await Promise.race([exited.then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),ms);})]);}finally{clearTimeout(timer);}};
  if(pipeClosed&&await waitForExit(releaseTimeout))return;
  try{child.kill();}catch{}
  if(!await waitForExit(cleanupTimeout))throw Object.assign(Error('Ownership helper termination could not be confirmed. Do not start another controller.'),{code:'service_lease_cleanup_unconfirmed'});
 })();
 const held=await startup;
 try{if(!nativePrepared||prepareStorage!==storageOperationAsync)await prepareStorage('data',directory,{helper});held.assertHeld();return held;}
 catch(error){await held.release();throw error;}
}
