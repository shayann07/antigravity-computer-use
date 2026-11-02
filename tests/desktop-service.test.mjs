import {testDirectory} from './paths.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import {serveDesktop,compact} from '../server/desktop-service.mjs';
import {request,describeCommand,encodeReply,failureReply} from '../scripts/desktop.mjs';
import net from 'node:net';
import {BUILD_ID} from '../server/version.mjs';
import {spawn,spawnSync} from 'node:child_process';import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {storageOperation} from '../server/storage.mjs';
import {Incidents} from '../server/incidents.mjs';
import {Runtime,appKey} from '../server/runtime.mjs';
import {EventEmitter} from 'node:events';
import {Driver} from '../server/driver.mjs';
import {Sessions} from '../server/sessions.mjs';import {acquireServiceLease} from '../server/service-lease.mjs';

test('direct command discovery exposes action schemas without source or session access',()=>{
 const click=describeCommand('click');assert.equal(click.command,'click');assert(click.inputSchema.required.includes('observation_id'));assert.deepEqual(click.inputSchema.properties.button.enum,['left','right','middle']);assert.equal(click.inputSchema.additionalProperties,false);
 assert.equal(describeCommand('computer_launch').inputSchema.properties.app.type,'string');
 const paste=describeCommand('paste');assert(paste.cliAliases.some(alias=>alias.flag==='--text-file'&&alias.replaces==='--text'));assert.equal(paste.inputSchema.additionalProperties,false);
 assert(describeCommand('run').cliAliases.some(alias=>alias.flag==='--steps-file'));
 assert.equal(describeCommand('click').cliAliases,undefined);
 assert.equal(describeCommand('snapshot').inputSchema.properties.settle_ms.maximum,2000);
 for(const command of ['start','shutdown','describe'])assert.equal(describeCommand(command).inputSchema.additionalProperties,false);
 assert.deepEqual(describeCommand('start').inputSchema.required,[]);
 assert.throws(()=>describeCommand('invented'),error=>error.code==='unknown_command');
});

test('one offline discovery call exposes multiple schemas and never creates a desktop session',()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-describe-'));
 try {
  for(const args of [['describe','click','paste','run'],['describe','--all']]){
   const result=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/desktop.mjs',import.meta.url)),...args],{windowsHide:true,encoding:'utf8',env:{...process.env,AGCU_DATA_DIR:dir}});
   assert.equal(result.status,0,result.stderr);const value=JSON.parse(result.stdout);assert(value.commands.length>=3);assert(value.commands.every(c=>c.inputSchema));
  }
  assert.deepEqual(fs.readdirSync(dir),[]);
 }finally{fs.rmdirSync(dir);}
});

test('importing the service library never treats an unrelated --serve argument as activation',()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-import-only-'));
 try{
  const script=`await import(${JSON.stringify(new URL('../server/desktop-service.mjs',import.meta.url).href)});console.log('import only');`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script,'--','--serve'],{windowsHide:true,encoding:'utf8',timeout:4000,env:{...process.env,AGCU_DATA_DIR:dir}});assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'import only');assert.deepEqual(fs.readdirSync(dir),[]);
 }finally{fs.rmdirSync(dir);}
});

test('foreground serve stays resident for host-owned background execution and shuts down normally',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-foreground-'));
 const child=spawn(process.execPath,[fileURLToPath(new URL('../scripts/desktop.mjs',import.meta.url)),'serve'],{windowsHide:true,env:{...process.env,AGCU_DATA_DIR:dir,AGCU_PERMISSION_MODE:'standalone'},stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',s=>stderr+=s);
 try{
  const ready=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Foreground startup timed out: '+stderr)),10000);child.once('error',reject);createInterface({input:child.stdout}).once('line',line=>{clearTimeout(timer);try{resolve(JSON.parse(line));}catch(error){reject(error);}});});
  assert.equal(ready.ok,true,JSON.stringify(ready));assert.equal(ready.service_mode,'foreground',JSON.stringify(ready));assert.equal(ready.private_data_storage,true);assert.equal(ready.state,'idle');
  await new Promise(resolve=>setTimeout(resolve,100));assert.equal(child.exitCode,null,'Do not exit after printing readiness');
  const session=JSON.parse(fs.readFileSync(path.join(dir,'desktop-session.json')));
  assert.equal((await request(session,'status')).state,'idle');const exited=new Promise(resolve=>child.once('exit',resolve));assert.equal((await request(session,'shutdown')).closed,true);assert.equal(await exited,0,stderr);
 }finally{if(child.exitCode===null)child.kill();fs.rmSync(dir,{recursive:true,force:true});}
});

test('CLI JSON survives legacy PowerShell stdout decoding without corrupting Unicode',()=>{
 const original={tree:'اردو — 4× 👩🏽‍💻 می\u200cخواهم',path:'D:/تصاویر/عکس.png'};
 const wire=encodeReply(original);assert(!/[^\x00-\x7f]/.test(wire));
 assert.deepEqual(JSON.parse(Buffer.from(wire,'ascii').toString('ascii')),original);
 assert.match(wire,/\\u200c/);assert.match(wire,/\\ud83d/);
});

test('a passive sidecar releases idle control and serves a later session without restarting',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-idle-'));let state='active',finishes=0,resumed=0;
 const runtime={status:()=>({state,task_open:false}),async finish(){finishes++;state='idle';},async observe(){state='active';resumed++;return {metadata:{observation_id:'next-session'}};},async close(){}};
 const service=await serveDesktop({directory:dir,runtime,idlePolicy:'release',idleTimeoutMs:25,idleCheckMs:5});const session=JSON.parse(fs.readFileSync(service.file));
 try{
  for(let i=0;i<30&&!finishes;i++)await new Promise(r=>setTimeout(r,10));assert.equal(finishes,1);assert(fs.existsSync(service.file));
  const status=await request(session,'status');assert.equal(status.state,'idle');assert.equal(status.listener_idle_policy,'release');
  assert.equal((await request(session,'snapshot',{hwnd:1})).metadata.observation_id,'next-session');assert.equal(resumed,1);
 }finally{await service.shutdown();fs.rmSync(dir,{recursive:true,force:true});}
});
test('idle cleanup cannot end an open or paused task during a long decision gap',async()=>{
 for(const idlePolicy of ['release','shutdown']){
  const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-open-idle-'));let taskOpen=true,state='active',finishes=0,closes=0;
  const runtime={status:()=>({state,task_open:taskOpen}),async finish(){finishes++;state='idle';},async close(){closes++;}};
  const service=await serveDesktop({directory:dir,runtime,idlePolicy,idleTimeoutMs:10,idleCheckMs:5});
  try{
   await new Promise(r=>setTimeout(r,80));assert.equal(finishes,0);assert.equal(closes,0);assert(fs.existsSync(service.file));
   taskOpen=false;state='paused';await new Promise(r=>setTimeout(r,60));assert.equal(finishes,0);assert.equal(closes,0);assert(fs.existsSync(service.file));
   state='idle';for(let i=0;i<30&&finishes+closes===0;i++)await new Promise(r=>setTimeout(r,10));
   assert.equal(idlePolicy==='release'?finishes:closes,1);
  }finally{await service.shutdown();fs.rmSync(dir,{recursive:true,force:true});}
 }
});
test('idle cleanup defers if runtime task state cannot be read',async()=>{
 for(const status of [()=>{throw Error('state unavailable');},()=>({state:'idle'}),()=>({state:'unknown',task_open:false})]){
  const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-idle-unknown-'));let closes=0;
  const service=await serveDesktop({directory:dir,runtime:{status,async close(){closes++;}},idlePolicy:'shutdown',idleTimeoutMs:10,idleCheckMs:5});
  try{await new Promise(r=>setTimeout(r,80));assert.equal(closes,0);assert(fs.existsSync(service.file));}
  finally{await service.shutdown();fs.rmSync(dir,{recursive:true,force:true});}
 }
});
test('update reservation refuses an idle task and unavailable task state',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-task-fence-'));let taskOpen=true,controlReason,state='idle';
 const runtime={status:()=>({state,control_reason:controlReason,approved_apps:[],...(taskOpen===undefined?{}:{task_open:taskOpen})}),async close(){}};
 const service=await serveDesktop({directory:dir,runtime});const session=JSON.parse(fs.readFileSync(service.file));
 try{
  assert.equal((await request(session,'prepare_update')).prepared,false);
  taskOpen=undefined;assert.equal((await request(session,'prepare_update')).prepared,false);
  taskOpen=false;state='stopped';
  for(const reason of ['guardian_stop_unconfirmed','stop_persistence_failed','guard_persistence_failed']){controlReason=reason;assert.equal((await request(session,'prepare_update')).prepared,false);}
  controlReason=undefined;state='idle';assert.equal((await request(session,'prepare_update')).prepared,true);
 }finally{await service.shutdown();fs.rmSync(dir,{recursive:true,force:true});}
});
test('direct IPC refuses replay and unverified cleanup after task recovery',async t=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-recovered-ipc-')),taskFile=path.join(dir,'task-state.json');
 try{storageOperation('data',dir);}catch(error){if(['storage_unsafe_ancestor','insecure_storage_ancestor','storage_permissions_conflict'].includes(error.code)){fs.rmSync(dir,{recursive:true,force:true});t.skip('native private storage qualification refused: '+error.code);return;}throw error;}
 fs.writeFileSync(taskFile,JSON.stringify({schema:1,open:true}));let nativeCalls=0,cleanups=0,guardianRequests=0;
 const guardian=new EventEmitter();guardian.send=()=>{};guardian.request=async()=>{guardianRequests++;return {state:'idle',controls_visible:true};};guardian.close=async()=>{};
 const runtime=new Runtime({taskFile,guardian,driver:{async abort(){cleanups++;},async call(){nativeCalls++;throw Error('no native call expected');}},sessions:{register(){},close(){}}});
 const service=await serveDesktop({directory:dir,runtime});const session=JSON.parse(fs.readFileSync(service.file));
 const send=(command,args={})=>request(session,command,args,5000,'standalone');
 try{
  const ready=await send('ready');assert.equal(ready.ready,false);assert.equal(ready.next_action,'inspect_prior_input_cleanup');assert.equal(ready.error.code,'recovered_cleanup_unverified');assert.equal(ready.recovered_task,true);assert.equal(ready.replay_allowed,false);assert.equal(guardianRequests,0);
  const controls=await send('controls');assert.equal(controls.error.code,'recovered_cleanup_unverified');assert.equal(controls.next_action,'inspect_prior_input_cleanup');assert.equal(guardianRequests,0);
  const result=await send('click',{hwnd:1,observation_id:'old',index:1,reason:'Do not replay'});assert.equal(result.error.code,'recovered_task_requires_end');assert.equal(result.replay_allowed,false);assert.equal(nativeCalls,0);
  assert.equal((await send('prepare_update')).prepared,false);
  const ended=await send('end');assert.equal(ended.error.code,'recovered_cleanup_unverified');assert.equal(ended.next_action,'inspect_prior_input_cleanup');assert.equal(cleanups,1);assert.equal((await send('status')).recovered_task,true);assert.equal(JSON.parse(fs.readFileSync(taskFile)).open,true);
 }finally{await service.shutdown();fs.rmSync(dir,{recursive:true,force:true});}
});
test('direct IPC runtime dispatch holds its native input fence',async t=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-ipc-input-fence-')),taskFile=path.join(dir,'task-state.json');
 try{storageOperation('data',dir);}catch(error){if(['storage_unsafe_ancestor','insecure_storage_ancestor','storage_permissions_conflict'].includes(error.code)){fs.rmSync(dir,{recursive:true,force:true});t.skip('native private storage qualification refused: '+error.code);return;}throw error;}
 const guardian=new EventEmitter();guardian.pid=101;guardian.send=()=>{};guardian.close=async()=>{};let calls=0;
 const sessions=new Sessions({dir:path.join(dir,'sessions')});
 const driver={info:{pid:102},epoch:1,async start(){},async abort(){},async call(op){if(op==='authorize')return {result:{sensitive:false}};assert.equal(op,'clipboard');calls++;await assert.rejects(acquireServiceLease(sessions.inputFence),e=>e.code==='service_already_running');const task=JSON.parse(fs.readFileSync(taskFile));assert.equal(task.dispatched,true);return {result:{fixture:true}};}};
 const runtime=new Runtime({guardian,driver,sessions,taskFile});runtime.guardFile=path.join(dir,path.basename(runtime.guardFile));fs.writeFileSync(runtime.guardFile,'idle||0|');runtime.beginTask();fs.writeFileSync(runtime.guardFile+'.watchdog','103|12345');runtime.state='active';runtime.deadline=Date.now()+60000;
 const service=await serveDesktop({directory:dir,runtime});const session=JSON.parse(fs.readFileSync(service.file));const send=(name,args={})=>request(session,name,args,10000,'standalone');
 try{const reply=await send('clipboard',{reason:'Inert fence fixture'});assert.equal(reply.input_completed,true);assert.equal(calls,1);assert.equal((await send('end')).ended,true);assert.equal(JSON.parse(fs.readFileSync(taskFile)).open,false);}
 finally{await service.shutdown();fs.rmSync(dir,{recursive:true,force:true});}
});

test('service shutdown removes its process signal handlers',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-signal-cleanup-'));
 const before={term:process.listenerCount('SIGTERM'),int:process.listenerCount('SIGINT')};
 const runtime={status:()=>({state:'idle'}),async close(){}};
 try{
  const service=await serveDesktop({directory:dir,runtime});
  assert.equal(process.listenerCount('SIGTERM'),before.term+1);
  assert.equal(process.listenerCount('SIGINT'),before.int+1);
  await service.shutdown();
  assert.equal(process.listenerCount('SIGTERM'),before.term);
  assert.equal(process.listenerCount('SIGINT'),before.int);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('passive idle cleanup never resumes or clears a human Pause or Stop',async()=>{
 for(const state of ['paused','stopped']){
  const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-idle-stop-'));let finishes=0;
  const runtime={status:()=>({state}),async finish(){finishes++;},async close(){}};
  const service=await serveDesktop({directory:dir,runtime,idlePolicy:'release',idleTimeoutMs:10,idleCheckMs:5});
  try{await new Promise(r=>setTimeout(r,60));assert.equal(finishes,0);assert.equal((await request(JSON.parse(fs.readFileSync(service.file)),'status')).state,state);}
  finally{await service.shutdown();fs.rmSync(dir,{recursive:true,force:true});}
 }
});

test('an unreachable saved service has a recovery message, never raw pipe errors',async()=>{
 await assert.rejects(request({pipe:process.platform==='win32'?'\\\\.\\pipe\\agcu-missing-'+process.pid:path.join(testDirectory('tmp'),'missing-agcu-'+process.pid),secret:'test'},'status'),error=>error.code==='session_unavailable'&&/Emergency Stop remains latched/.test(error.message));
});

test('a standalone client cannot silently reuse a host-managed service with the same build',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-policy-'));let inputs=0;
 const runtime={permissionMode:'host-managed',status:()=>({state:'active',permission_mode:'host-managed'}),async action(){inputs++;return {};},async close(){}};
 const service=await serveDesktop({directory:dir,runtime});try{
  const session=JSON.parse(fs.readFileSync(service.file));
  for(const mode of ['standalone',undefined]){
   const result=await request(session,'clipboard',{reason:'Explicit access'},1000,mode);assert.equal(result.ok,false);assert.equal(result.error.code,'deployment_policy_mismatch');
  }
  assert.equal(inputs,0);const result=await request(session,'clipboard',{reason:'Explicit access'},1000,'host-managed');assert.equal(result.ok,true);assert.equal(inputs,1);
  assert.equal((await request(session,'status',{},1000,'standalone')).permission_mode,'host-managed');
 }finally{await service.shutdown();fs.rmSync(dir,{recursive:true,force:true});}
});
test('status exposes a different client build and mismatched actions are refused',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-build-mismatch-'));let calls=0;
 const runtime={permissionMode:'host-managed',status:()=>({state:'idle',build_id:BUILD_ID,permission_mode:'host-managed'}),async listApps(){calls++;return[];},async close(){}};
 const service=await serveDesktop({directory:dir,runtime});try{
  const session=JSON.parse(fs.readFileSync(service.file));
  const send=command=>new Promise((resolve,reject)=>{const socket=net.createConnection(session.pipe);socket.setEncoding('utf8');let data='';socket.on('error',reject);socket.on('data',x=>data+=x);socket.on('end',()=>resolve(JSON.parse(data)));socket.on('connect',()=>socket.write(JSON.stringify({secret:session.secret,command,expected_build_id:'older-build',expected_permission_mode:'host-managed',args:{}})+'\n'));});
  const status=await send('status');assert.equal(status.client_build_mismatch,true);assert.equal(status.next_action,'resolve_version_mismatch');assert.equal(status.build_id,BUILD_ID);
  const refused=await send('apps');assert.equal(refused.error.code,'version_mismatch');assert.equal(refused.next_action,'resolve_version_mismatch');assert.equal(refused.replay_allowed,false);assert.equal(calls,0);
 }finally{await service.shutdown();fs.rmSync(dir,{recursive:true,force:true});}
});
test('foreign build or policy cannot end or shut down an open task, but can stop',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-foreign-end-'));let ends=0,stops=0,closes=0,open=true,state='active';
 const runtime={permissionMode:'host-managed',status:()=>({state,task_open:open,permission_mode:'host-managed'}),async finish(){ends++;return {ended:true};},async stop(){stops++;return {stopped:true};},async close(){closes++;}};
 const service=await serveDesktop({directory:dir,runtime});const session=JSON.parse(fs.readFileSync(service.file));
 const send=(command,build,mode)=>new Promise((resolve,reject)=>{const socket=net.createConnection(session.pipe);socket.setEncoding('utf8');let data='';socket.on('error',reject);socket.on('data',x=>data+=x);socket.on('end',()=>resolve(JSON.parse(data)));socket.on('connect',()=>socket.write(JSON.stringify({secret:session.secret,command,expected_build_id:build,expected_permission_mode:mode,args:{}})+'\n'));});
 try{
  for(const [build,mode,code] of [['older-build','host-managed','version_mismatch'],[BUILD_ID,'standalone','deployment_policy_mismatch']]){
   assert.equal((await send('end',build,mode)).error.code,code);assert.equal((await send('shutdown',build,mode)).error.code,code);
   assert.equal((await send('stop',build,mode)).stopped,true);
  }
  assert.equal(ends,0);assert.equal(closes,0);assert.equal(stops,2);assert(fs.existsSync(service.file));
  open=undefined;assert.equal((await send('shutdown','older-build','host-managed')).error.code,'version_mismatch');assert.equal(closes,0);
  open=false;for(state of ['active','paused','unknown']){assert.equal((await send('shutdown','older-build','host-managed')).error.code,'version_mismatch');assert.equal(closes,0);}
  state='idle';assert.equal((await send('shutdown','older-build','standalone')).closed,true);
 }finally{await service.shutdown();fs.rmSync(dir,{recursive:true,force:true});}
});
test('foreign shutdown is refused while any operation is in flight',{timeout:30000},async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-foreign-busy-'));let release,entered,closes=0;
 const started=new Promise(resolve=>entered=resolve);
 const runtime={permissionMode:'host-managed',guardian:{},driver:{info:{},async call(){entered();await new Promise(resolve=>release=resolve);return {result:{windows:[]}};}},status:()=>({state:'idle',task_open:false,permission_mode:'host-managed'}),async close(){closes++;}};
 const service=await serveDesktop({directory:dir,runtime});const session=JSON.parse(fs.readFileSync(service.file));let pending;
 const foreign=()=>new Promise((resolve,reject)=>{const socket=net.createConnection(session.pipe);socket.setEncoding('utf8');let data='';socket.on('error',reject);socket.on('data',x=>data+=x);socket.on('end',()=>resolve(JSON.parse(data)));socket.on('connect',()=>socket.write(JSON.stringify({secret:session.secret,command:'shutdown',expected_build_id:'older-build',expected_permission_mode:'host-managed',args:{}})+'\n'));});
 let timer;try{pending=request(session,'apps',{},15000,'host-managed');pending.catch(()=>{});await Promise.race([started,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Discovery fixture did not enter')),8000);})]);clearTimeout(timer);assert.equal((await foreign()).error.code,'version_mismatch');assert.equal(closes,0);release();await pending;pending=null;}
 finally{clearTimeout(timer);if(release)release();if(pending)await Promise.allSettled([pending]);await service.shutdown();fs.rmSync(dir,{recursive:true,force:true});}
});
test('unreadable status refuses foreign shutdown without blocking matching cleanup',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-unreadable-shutdown-'));let closes=0;
 const runtime={permissionMode:'host-managed',status(){throw Error('status unavailable');},async close(){closes++;}};
 const service=await serveDesktop({directory:dir,runtime});const session=JSON.parse(fs.readFileSync(service.file));
 const foreign=()=>new Promise((resolve,reject)=>{const socket=net.createConnection(session.pipe);socket.setEncoding('utf8');let data='';socket.on('error',reject);socket.on('data',x=>data+=x);socket.on('end',()=>resolve(JSON.parse(data)));socket.on('connect',()=>socket.write(JSON.stringify({secret:session.secret,command:'shutdown',expected_build_id:'older-build',expected_permission_mode:'host-managed',args:{}})+'\n'));});
 try{assert.equal((await foreign()).error.code,'version_mismatch');assert.equal(closes,0);assert.equal((await request(session,'shutdown',{},5000,'host-managed')).closed,true);assert.equal(closes,1);}
 finally{await service.shutdown();fs.rmSync(dir,{recursive:true,force:true});}
});
test('diagnostic persistence does not delay an error reply and shutdown waits for it',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-async-incident-'));let release,started;const gate=new Promise(r=>release=r),entered=new Promise(r=>started=r),original=Incidents.prototype.recordSerialized;
 Incidents.prototype.recordSerialized=async()=>{started();await gate;};
 const runtime={permissionMode:'host-managed',status:()=>({state:'idle',permission_mode:'host-managed'}),async close(){}};let service;
 try{
  service=await serveDesktop({directory:dir,runtime});const session=JSON.parse(fs.readFileSync(service.file));
  const result=await request(session,'clipboard',{reason:'Denied policy'},1000,'standalone');assert.equal(result.error.code,'deployment_policy_mismatch');assert.equal(result.diagnostic_pending,true);assert.match(result.incident_id,/^[a-f0-9]{24}$/);await entered;assert.equal((await request(session,'status',{},1000,'host-managed')).diagnostic_pending,1);
  let closed=false;const shutting=service.shutdown().then(()=>{closed=true;});await new Promise(r=>setTimeout(r,30));assert.equal(closed,false);release();await shutting;assert.equal(closed,true);
 }finally{release();if(service)await service.shutdown();Incidents.prototype.recordSerialized=original;fs.rmSync(dir,{recursive:true,force:true});}
});

test('start refuses to replace a live but unresponsive service',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-start-'));const file=path.join(dir,'desktop-session.json');
 // Establish a dedicated native data root before populating a saved session.
 // Reconnection verifies an already-private root on both platforms; it must
 // not mutate a live service's ACL tree to make this fixture valid.
 storageOperation('data',dir);
 const raw=JSON.stringify({pid:process.pid,pipe:process.platform==='win32'?'\\\\.\\pipe\\agcu-unresponsive-'+process.pid:path.join(dir,'missing.sock'),secret:'fixture'});fs.writeFileSync(file,raw);
 try{
  const result=await new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,[fileURLToPath(new URL('../scripts/desktop.mjs',import.meta.url)),'start'],{windowsHide:true,env:{...process.env,AGCU_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
   let stdout='',stderr='';child.stdout.on('data',s=>stdout+=s);child.stderr.on('data',s=>stderr+=s);child.on('error',reject);child.on('exit',code=>resolve({code,stdout,stderr}));
  });
  assert.equal(result.code,1,result.stderr);assert.equal(JSON.parse(result.stdout).error.code,'session_unresponsive');assert.equal(fs.readFileSync(file,'utf8'),raw);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('shutdown reports cleanup failure and remains reachable for recovery',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-close-'));let fail=true;
 const runtime={status:()=>({state:'stopped'}),async close(){await new Promise(r=>setTimeout(r,20));if(fail)throw Object.assign(Error('Held-input cleanup failed'),{code:'input_cleanup_failed'});}};
 const service=await serveDesktop({directory:dir,runtime});const session=JSON.parse(fs.readFileSync(service.file));
 try{
  for(const rejected of await Promise.all([request(session,'shutdown'),request(session,'shutdown')])){assert.equal(rejected.ok,false);assert.equal(rejected.error.code,'input_cleanup_failed');}
  assert(fs.existsSync(service.file));assert.equal((await request(session,'status')).state,'stopped');
  fail=false;assert.equal((await request(session,'shutdown')).closed,true);assert(!fs.existsSync(service.file));
 }finally{fail=false;await service.shutdown();fs.rmSync(dir,{recursive:true,force:true});}
});
test('IPC End and shutdown refuse unconfirmed worker exit, then recover without clearing Stop',async t=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-unconfirmed-worker-')),taskFile=path.join(dir,'task-state.json'),latch=path.join(dir,'emergency.stop');
 try{storageOperation('data',dir);}catch(error){if(['storage_unsafe_ancestor','insecure_storage_ancestor','storage_permissions_conflict'].includes(error.code)){fs.rmSync(dir,{recursive:true,force:true});t.skip('native private storage qualification refused: '+error.code);return;}throw error;}
 const guardian=new EventEmitter();guardian.send=()=>{};guardian.close=async()=>{};
 const child=new EventEmitter();child.exitCode=null;child.signalCode=null;child.stdin={destroy(){}};child.kill=()=>false;
 const driver=new Driver();driver.proc=child;driver.inputMayBeHeld=true;driver.exitTimeoutMs=10;driver.releaseHeldInputs=async()=>true;
 const runtime=new Runtime({guardian,driver,sessions:{register(){},close(){}},taskFile,latchFile:latch});runtime.guardFile=path.join(dir,path.basename(runtime.guardFile));runtime.beginTask();runtime.state='active';driver.onEvent=event=>{if(event.event==='input_cleanup_failed')runtime.stop().catch(()=>{});};
 const service=await serveDesktop({directory:dir,runtime});const session=JSON.parse(fs.readFileSync(service.file));const send=(name,args={})=>request(session,name,args,5000,'standalone');
 try{
  const ended=await send('end');assert.equal(ended.error.code,'input_cleanup_failed');assert.equal(JSON.parse(fs.readFileSync(taskFile)).open,true);assert.equal((await send('status')).state,'stopped');
  guardian.emit('state','idle','normal_shutdown');assert.equal((await send('status')).state,'stopped','a stale idle event must not undo Stop');
  const shutdown=await send('shutdown');assert.equal(shutdown.error.code,'input_cleanup_failed');assert(fs.existsSync(service.file));assert.equal((await send('prepare_update')).prepared,false);
  child.exitCode=0;child.emit('exit',0);assert.equal((await send('end')).ended,true);assert.equal(JSON.parse(fs.readFileSync(taskFile)).open,false);assert.equal(fs.readFileSync(latch,'utf8'),'stopped');assert.equal((await send('status')).state,'stopped');
 }finally{child.exitCode=0;await service.shutdown();fs.rmSync(dir,{recursive:true,force:true});}
});
test('direct skill IPC authenticates, rejects overlapping actions, and permits independent stop',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-direct-'));let release,stops=0,calls=0;
 const runtime={status(){return {state:'idle'};},async stop(){stops++;return {stopped:true};},async close(){},async observe(){calls++;return new Promise(resolve=>{release=()=>resolve({metadata:{observation_id:'test'}});});}};
 const service=await serveDesktop({directory:dir,runtime});const session=JSON.parse(fs.readFileSync(service.file));
 try{
  assert.equal((await request(session,'status')).state,'idle');
  assert.equal((await request({...session,secret:'wrong'},'status')).ok,false);
  const pending=request(session,'snapshot',{hwnd:1});
  while(!release)await new Promise(r=>setTimeout(r,5));
  const blocked=await request(session,'snapshot',{hwnd:1});assert.equal(blocked.ok,false);assert.match(blocked.error.message,/pending/);
  assert.equal((await request(session,'stop')).stopped,true);assert.equal(stops,1);assert.equal(calls,1);
  release();await pending;
  assert.equal((await request(session,'click',{hwnd:1,confirmed:true})).ok,false);
 }finally{await service.shutdown();fs.rmSync(dir,{recursive:true,force:true});}
});

test('direct IPC batches use a fresh change-wait frame without replaying prior actions',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-change-ipc-'));const app={hwnd:7,pid:9,started:'one',path:'fixture.exe'};const key=appKey(app),seen=[];
 const runtime={frames:new Map(),generation:1,driver:{epoch:1},status(){return{state:'active'};},check(){},async grant(){return app;},async close(){},
  async action(op,a){seen.push({op,frame:a.observation_id});if(seen.length===1){this.frames.set('post-action',{at:Date.now(),hwnd:7,key,workerEpoch:1,viewTree:'"App" hwnd=7\nLoading'});return{metadata:{observation_id:'post-action'}};}return{metadata:{observation_id:'finished'}};},
  async observe(){this.frames.set('changed',{key,workerEpoch:1});return{metadata:{observation_id:'changed',tree:'new-snapshot "App" hwnd=7\nReady'}};}};
 runtime.waitChange=Runtime.prototype.waitChange.bind(runtime);
 const service=await serveDesktop({directory:dir,runtime});const session=JSON.parse(fs.readFileSync(service.file));
 try{
  const reply=await request(session,'run',{hwnd:7,observation_id:'initial',reason:'Verify IPC',steps:[{kind:'click',name:'Start'},{kind:'wait_change',timeout_ms:1000},{kind:'click',name:'Details'}]});
  assert.equal(reply.ok,true);assert.equal(reply.batch.completed.length,3);
  assert.deepEqual(seen,[{op:'click',frame:'initial'},{op:'click',frame:'changed'}]);assert(!runtime.frames.has('post-action'));
 }finally{await service.shutdown();fs.rmSync(dir,{recursive:true,force:true});}
});
test('direct IPC retains real wait metrics after a later batch action',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-wait-metrics-'));let reads=0;
 const runtime={frames:new Map(),status(){return{state:'active'};},check(){},async close(){},async observe(){const id='v'+(++reads);this.frames.set(id,{});return{metadata:{observation_id:id,tree:'Ready'}};},async action(){return{metadata:{observation_id:'after'}};}};
 runtime.wait=Runtime.prototype.wait.bind(runtime);
 const service=await serveDesktop({directory:dir,runtime});const session=JSON.parse(fs.readFileSync(service.file));
 try{
  const reply=await request(session,'run',{hwnd:7,observation_id:'initial',reason:'Observe',steps:[{kind:'wait',until:'Ready',timeout_ms:1000},{kind:'click',name:'Continue'}]});
  assert.equal(reply.ok,true);assert.equal(reply.batch.completed[0].wait_metrics.observations,2);assert.equal(reply.batch.completed[0].wait_metrics.polling_budget_ms,1000);assert(reply.batch.completed[0].wait_metrics.elapsed_ms>=0);
 }finally{await service.shutdown();fs.rmSync(dir,{recursive:true,force:true});}
});
test('an incomplete batch wait tells the agent to inspect without replay over IPC',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-wait-recovery-'));let inputs=0;
 const runtime={status:()=>({state:'active'}),async close(){},async action(){inputs++;return{};},async wait(){return{matched:false,incomplete:true,metadata:{observation_id:'fresh'}};}};
 const service=await serveDesktop({directory:dir,runtime});const session=JSON.parse(fs.readFileSync(service.file));
 try{
  const reply=await request(session,'run',{hwnd:7,observation_id:'initial',reason:'Observe',steps:[{kind:'click',name:'Start'},{kind:'wait',until:'Ready',abort_on:['Failed']},{kind:'click',name:'Continue'}]});
  assert.equal(inputs,1);assert.equal(reply.verification_error.code,'wait_observation_incomplete');assert.equal(reply.next_action,'inspect_effect_without_replay');assert.equal(reply.replay_allowed,false);assert.equal(reply.batch.skipped,1);
 }finally{await service.shutdown();fs.rmSync(dir,{recursive:true,force:true});}
});
test('failure matching does not expose captured text omitted from the rendered view over IPC',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-wait-private-'));const privateText='Private task data: Failed';
 const runtime={frames:new Map(),status:()=>({state:'active'}),check(){},async close(){},async observe(){this.frames.set('frame',{});return{metadata:{observation_id:'frame',tree:'Ready',elements:[{name:privateText}]}};}};
 runtime.wait=Runtime.prototype.wait.bind(runtime);
 const service=await serveDesktop({directory:dir,runtime});const session=JSON.parse(fs.readFileSync(service.file));
 try{
  const reply=await request(session,'wait',{hwnd:7,until:'Ready',abort_on:['Failed'],with_image:false,reason:'Observe'});
  assert.equal(reply.aborted,true);assert.equal(reply.abort_match,'Failed');assert.equal(reply.metadata.elements,undefined);assert(!JSON.stringify(reply).includes(privateText));
 }finally{await service.shutdown();fs.rmSync(dir,{recursive:true,force:true});}
});
test('IPC wait propagates its budget to snapshots and stops on native truncation',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-wait-budget-'));let inputs=0;const budgets=[];
 const runtime={frames:new Map(),generation:1,status:()=>({state:'active'}),check(){},stamp(){return{};},guardian:{send(){}},async close(){},async grant(){return{hwnd:7,pid:9,started:'one',path:'fixture.exe'};},driver:{epoch:1,async call(op,a){assert.equal(op,'snapshot');budgets.push(a.time_budget_ms);return{result:{snapshot_id:'s'+budgets.length,truncated:true,nodes:[{i:1,role:'Button',name:'Ready'}]}};}},async action(){inputs++;return{};}};
 runtime.observe=Runtime.prototype.observe.bind(runtime);runtime.wait=Runtime.prototype.wait.bind(runtime);
 const service=await serveDesktop({directory:dir,runtime});const session=JSON.parse(fs.readFileSync(service.file));
 try{
  const reply=await request(session,'run',{hwnd:7,observation_id:'initial',reason:'Observe',steps:[{kind:'wait',until:'Ready',abort_on:['Failed'],timeout_ms:1000},{kind:'click',name:'Continue'}]});
  assert.equal(reply.verification_error.code,'wait_observation_incomplete');assert.equal(reply.metadata.tree_incomplete,true);assert.equal(reply.batch.skipped,1);assert.equal(inputs,0);assert.equal(budgets.length,2);assert(budgets.every(value=>value>=100&&value<=1000));
 }finally{await service.shutdown();fs.rmSync(dir,{recursive:true,force:true});}
});
test('expired budget after a slow grant skips the snapshot and later batch input',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-wait-slow-grant-'));let inputs=0,snapshots=0;
 const runtime={frames:new Map(),generation:1,status:()=>({state:'active'}),check(){},stamp(){return{};},guardian:{send(){}},async close(){},async grant(){await new Promise(resolve=>setTimeout(resolve,120));return{hwnd:7,pid:9,started:'one',path:'fixture.exe'};},driver:{epoch:1,async call(){snapshots++;return{result:{snapshot_id:'s',nodes:[]}};}},async action(){inputs++;return{};}};
 runtime.observe=Runtime.prototype.observe.bind(runtime);runtime.wait=Runtime.prototype.wait.bind(runtime);
 const service=await serveDesktop({directory:dir,runtime});const session=JSON.parse(fs.readFileSync(service.file));
 try{
  const reply=await request(session,'run',{hwnd:7,observation_id:'initial',reason:'Observe',steps:[{kind:'click',name:'Start'},{kind:'wait',until:'Ready',timeout_ms:100},{kind:'click',name:'Continue'}]});
  assert.equal(reply.error.code,'wait_observation_timeout');assert.equal(reply.next_action,'inspect_effect_without_replay');assert.equal(reply.replay_allowed,false);assert.equal(reply.skipped,1);assert.equal(reply.completed.length,1);assert.equal(snapshots,0);assert.equal(inputs,1);assert.equal(reply.wait_metrics.observations,1);assert.equal(reply.wait_metrics.polling_budget_ms,100);assert(reply.wait_metrics.elapsed_ms>=100);
 }finally{await service.shutdown();fs.rmSync(dir,{recursive:true,force:true});}
});
test('direct wait returns numeric metrics when an observation fails',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-wait-error-metrics-'));
 const runtime={frames:new Map(),status:()=>({state:'active'}),check(){},async close(){},async observe(){throw Object.assign(Error('provider failed'),{code:'op_timeout'});}};
 runtime.wait=Runtime.prototype.wait.bind(runtime);const service=await serveDesktop({directory:dir,runtime});const session=JSON.parse(fs.readFileSync(service.file));
 try{const reply=await request(session,'wait',{hwnd:7,until:'Ready',reason:'Observe',timeout_ms:1000});assert.equal(reply.error.code,'op_timeout');assert.equal(reply.wait_metrics.observations,1);assert.equal(reply.wait_metrics.polling_budget_ms,1000);assert(reply.wait_metrics.elapsed_ms>=0);}
 finally{await service.shutdown();fs.rmSync(dir,{recursive:true,force:true});}
});
test('a disconnected app-discovery client does not stop an active task',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-apps-disconnect-'));let release,entered,stops=0;
 const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
 const runtime={guardian:{pid:2},driver:{info:{pid:3},async call(op){assert.equal(op,'list_apps');entered();await gate;return {result:{windows:[]}};}},status:()=>({state:'active',task_open:true}),async stop(){stops++;},async close(){}};
 const service=await serveDesktop({directory:dir,runtime});const session=JSON.parse(fs.readFileSync(service.file));
 try{
  const pending=request(session,'apps',{},100);const rejected=assert.rejects(pending,e=>e.code==='request_timeout');await started;await rejected;
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(stops,0);
  release();await new Promise(resolve=>setImmediate(resolve));assert.equal((await request(session,'status')).state,'active');assert.equal(stops,0);
 }finally{release();await service.shutdown();fs.rmSync(dir,{recursive:true,force:true});}
});
test('a returned batch failure gets explicit no-replay guidance over IPC',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-batch-failure-'));let calls=0;
 const runtime={status:()=>({state:'active'}),async action(){calls++;return {ok:false,input_completed:true};},async close(){}};
 const service=await serveDesktop({directory:dir,runtime});const session=JSON.parse(fs.readFileSync(service.file));
 try{
  const result=await request(session,'run',{hwnd:1,observation_id:'frame',reason:'test',steps:[{kind:'key',keys:'tab'},{kind:'key',keys:'enter'}]});
  assert.equal(calls,1);assert.equal(result.ok,false);assert.equal(result.input_completed,true);assert.equal(result.error.code,'batch_step_failed');
  assert.equal(result.next_action,'inspect_effect_without_replay');assert.equal(result.replay_allowed,false);assert.equal(result.skipped,1);
 }finally{await service.shutdown();fs.rmSync(dir,{recursive:true,force:true});}
});
test('cleanup failure with uncertain delivery survives direct and batch IPC',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-cleanup-unknown-'));let calls=0;
 const runtime={status:()=>({state:'stopped'}),async action(){calls++;throw Object.assign(Error('Cleanup unconfirmed'),{code:'input_cleanup_failed',delivery_unknown:true});},async close(){}};
 const service=await serveDesktop({directory:dir,runtime});const session=JSON.parse(fs.readFileSync(service.file));
 try{
  for(const [command,args] of [['key',{hwnd:1,observation_id:'frame',reason:'test',keys:'tab'}],['run',{hwnd:1,observation_id:'frame',reason:'test',steps:[{kind:'key',keys:'tab'},{kind:'key',keys:'enter'}]}]]){
   const result=await request(session,command,args);assert.equal(result.ok,false);assert.equal(result.error.code,'input_cleanup_failed');assert.equal(result.delivery_unknown,true);assert.equal(result.replay_allowed,false);assert.equal(result.next_action,'inspect_input_cleanup');
   if(command==='run')assert.equal(result.skipped,1);
  }
  assert.equal(calls,2);
 }finally{await service.shutdown();fs.rmSync(dir,{recursive:true,force:true});}
});

test('direct IPC accepts bounded feedback without desktop input or arbitrary task content',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-feedback-ipc-'));const original=Incidents.prototype.recordSerialized;let recorded;
 Incidents.prototype.recordSerialized=async function(op,result){recorded={op,result};return 'feedback-id';};
 const runtime={state:'idle',status(){return{state:this.state};},async close(){}};runtime.feedback=Runtime.prototype.feedback.bind(runtime);
 let service;
 try{
  service=await serveDesktop({directory:dir,runtime});const session=JSON.parse(fs.readFileSync(service.file));
  const result=await request(session,'feedback',{category:'focus',operation:'type',evidence:'observed'});
  assert.equal(result.recorded,true);assert.equal(result.classification,'agent_report_unverified');assert.equal(recorded.result.error.code,'agent_focus_type_observed');
  const invalid=await request(session,'feedback',{category:'focus',operation:'type',evidence:'observed',text:'private task data'});
  assert.equal(invalid.ok,false);assert(!JSON.stringify(recorded).includes('private task data'));
 }finally{if(service)await service.shutdown();Incidents.prototype.recordSerialized=original;fs.rmSync(dir,{recursive:true,force:true});}
});
test('direct IPC client timeout cancels active work without replay',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-direct-'));let stops=0,actions=0,release;
 const runtime={async action(){actions++;return new Promise(resolve=>release=()=>resolve({input_completed:true}));},async stop(){stops++;},async close(){}};
 const service=await serveDesktop({directory:dir,runtime});const session=JSON.parse(fs.readFileSync(service.file));
 try{
  await assert.rejects(request(session,'click',{hwnd:1,observation_id:'observed',index:1,reason:'Inert action'},100),error=>{
   const result=failureReply(error,{record:false});assert.equal(result.delivery_unknown,true);assert.equal(result.next_action,'inspect_effect_without_replay');return /timed out/.test(error.message);
  });
  await new Promise(resolve=>setTimeout(resolve,40));assert.equal(stops,1);assert.equal(actions,1);release();
 }finally{await service.shutdown();fs.rmSync(dir,{recursive:true,force:true});}
});
test('direct observations return an actual local image without duplicate tree payload',()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-image-'));
 try{const r=compact({metadata:{observation_id:'abc',tree:'controls',elements:[1]},image:{data:Buffer.from('image').toString('base64'),width:100,height:80,source:[-100,0,100,80]}},dir);
 assert.equal(fs.readFileSync(r.image.path,'utf8'),'image');assert(!r.metadata.elements);assert(!r.image.data);assert.equal(r.metadata.tree,'controls');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('updater health startup stays passive and rejects tasks until installation unlocks',async()=>{
 const parent=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-update-gate-')),dir=path.join(parent,'data');let inputs=0;
 const runtime={status:()=>({state:'idle'}),async ready(){inputs++;return {};},async close(){}};
 const service=await serveDesktop({directory:dir,runtime});const session=JSON.parse(fs.readFileSync(service.file));
 try{fs.writeFileSync(path.join(parent,'update-switching.json'),'fixture');assert.equal((await request(session,'status')).state,'idle');assert.equal((await request(session,'ready')).error.code,'update_in_progress');assert.equal(inputs,0);fs.unlinkSync(path.join(parent,'update-switching.json'));assert.equal((await request(session,'ready')).ok,true);assert.equal(inputs,1);}finally{await service.shutdown();fs.rmSync(parent,{recursive:true,force:true});}
});
test('stale input returns an explicit fresh-observation instruction without retrying',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-stale-advice-'));let calls=0;
 const runtime={async action(){calls++;throw Object.assign(Error('Expired frame'),{code:'stale_observation'});},async close(){}};
 const service=await serveDesktop({directory:dir,runtime});try{const result=await request(JSON.parse(fs.readFileSync(service.file)),'click',{hwnd:1,observation_id:'expired',index:1,reason:'Observed target'});assert.equal(result.error.code,'stale_observation');assert.equal(result.next_action,'observe_again');assert.equal(result.replay_allowed,false);assert.equal(calls,1);}finally{await service.shutdown();fs.rmSync(dir,{recursive:true,force:true});}
});
test('completed input with a stale verification error directs inspection without replay',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-completed-advice-'));let calls=0;
 const runtime={async action(){calls++;return {input_completed:true,verification_error:{code:'stale_observation'}};},async close(){}};
 const service=await serveDesktop({directory:dir,runtime});try{const result=await request(JSON.parse(fs.readFileSync(service.file)),'click',{hwnd:1,observation_id:'fresh',index:1,reason:'Observed target'});assert.equal(result.next_action,'inspect_effect_without_replay');assert.equal(result.replay_allowed,false);assert.equal(result.input_completed,true);assert.equal(calls,1);}finally{await service.shutdown();fs.rmSync(dir,{recursive:true,force:true});}
});

test('direct IPC preserves Urdu and emoji when UTF-8 bytes arrive separately',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-utf8-'));const unicode='اردو — café 👩🏽‍💻';
 const runtime={async observe(args){return {metadata:{tree:args.query}};},async close(){}};
 const service=await serveDesktop({directory:dir,runtime});const session=JSON.parse(fs.readFileSync(service.file));
 try {
  const result=await new Promise((resolve,reject)=>{
   const socket=net.createConnection(session.pipe);socket.setEncoding('utf8');let output='';socket.on('error',reject);
   socket.on('data',part=>output+=part);socket.on('end',()=>resolve(JSON.parse(output)));
   socket.on('connect',async()=>{
    const bytes=Buffer.from(JSON.stringify({secret:session.secret,command:'snapshot',expected_build_id:BUILD_ID,args:{hwnd:1,query:unicode}})+'\n');
    for(const byte of bytes){socket.write(Buffer.from([byte]));await new Promise(r=>setImmediate(r));}
   });
  });
  assert.equal(result.metadata.tree,unicode);
 }finally{await service.shutdown();fs.rmSync(dir,{recursive:true,force:true});}
});
