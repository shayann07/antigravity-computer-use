// Interactive qualification of an explicitly selected, sealed Windows install.
// No injected Stop/Esc, permission approval or re-arm. Run only with the human
// available and the desktop reserved. Importing this module performs no test.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';import {createInterface} from 'node:readline';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {projectRoot} from './paths.mjs';
import {writeAtomicJSON} from '../server/atomic-json.mjs';
import {stopConfig,newStopEvidence,verifyQualificationRelease,qualificationIdle,qualificationRequest,currentInputJournal,qualificationLedger,finishQualification,physicalStopSteps} from './installed-qualification.mjs';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,timeout){
 const deadline=performance.now()+timeout;
 while(performance.now()<deadline){const result=await check();if(result)return result;await pause(100);}
 throw Object.assign(Error('Human/native checkpoint timed out. Nothing was re-armed or replayed.'),{code:'qualification_checkpoint_timeout'});
}
export async function beginSignal({input=process.stdin,timeoutMs=45000}={}){
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>45000)throw Error('Invalid BEGIN deadline.');
 const lines=createInterface({input});
 try{await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{reject(Object.assign(Error('No BEGIN signal; no drag was sent.'),{code:'qualification_begin_timeout'}));lines.close();},timeoutMs);
  lines.once('line',line=>{clearTimeout(timer);line.trim()==='BEGIN'?resolve():reject(Object.assign(Error('Expected BEGIN after image inspection.'),{code:'qualification_begin_invalid'}));});
  lines.once('close',()=>{clearTimeout(timer);reject(Object.assign(Error('Input closed before BEGIN.'),{code:'qualification_begin_closed'}));});
 });}finally{lines.close();input.pause();}
}

export async function installedStopQualification(configFile,{checkOnly=false}={}){
 assert.equal(process.platform,'win32','This harness qualifies the installed Windows helper');
 const config=stopConfig(JSON.parse(fs.readFileSync(configFile,'utf8'))),evidence=newStopEvidence(config);
 const record={passed:false,qualification_complete:false,stage:'preflight',expected_build_id:config.expected_build_id,checks:[],events:[],desktop_input_attempted:false,input_completion_acknowledged:false,target_release_delivery_verified:false};
 let aborting=false,ownsTask=false,operationPending=false,request,policy,directory,sequence=0,lastState;
 const save=()=>{if(aborting){record.passed=false;record.stage='aborted';}return writeAtomicJSON(path.join(evidence,'result.json'),record);};
 const call=async(command,args={})=>{
  if(aborting&&!['status','stop','end'].includes(command))throw Object.assign(Error('Qualification aborted; no more app commands are allowed.'),{code:'qualification_aborted'});
  const session=JSON.parse(fs.readFileSync(path.join(directory,'desktop-session.json')));
  const result=await qualificationRequest(request,session,policy,command,args);
  if(command==='status'){
   if(lastState!==result.state){lastState=result.state;record.events.push({state:result.state,reason:result.control_reason,at:new Date().toISOString()});save();}
  }else fs.writeFileSync(path.join(evidence,String(++sequence).padStart(2,'0')+'-'+command+'.json'),JSON.stringify({command,args,result},null,2),{flag:'wx'});
  return result;
 };
 const input=async(command,args)=>{operationPending=true;record.desktop_input_attempted=true;save();const result=await call(command,args);operationPending=false;if(result.input_completed===true)record.input_completion_acknowledged=true;return result;};
 const onSignal=()=>{
  if(aborting)return;aborting=true;record.passed=false;record.stage='aborted';
  finishQualification(call,{ownsTask,operationPending}).then(result=>{Object.assign(record,result);save();process.exit(130);}).catch(()=>process.exit(130));
 };
 process.once('SIGINT',onSignal);process.once('SIGTERM',onSignal);
 try{
  const install=JSON.parse(fs.readFileSync(config.installation));assert.equal(install.integration,'direct');
  const release=install.release,manifest=verifyQualificationRelease(release,config.expected_build_id);
  const verified=spawnSync(process.execPath,[path.join(projectRoot,'scripts/verify-install.mjs'),path.dirname(config.installation)],{encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(verified.status,0,'Installed identity/private-storage verification failed; inspect the private run.');
  assert.equal(JSON.parse(verified.stdout).build_id,config.expected_build_id);
  policy=JSON.parse(fs.readFileSync(path.join(release,'desktop-policy.json')));
  assert.equal(policy.permission_mode,'host-managed','Standalone approvals are never bypassed');
  directory=policy.data_dir;assert.equal(path.resolve(directory),path.join(path.dirname(config.installation),'data'));
  ({request}=await import(pathToFileURL(path.join(release,'scripts/desktop.mjs'))));
  const cli=command=>{
   const child=spawnSync(path.join(release,'node.exe'),[path.join(release,'scripts/desktop.mjs'),command],{encoding:'utf8',windowsHide:true,timeout:20000});
   assert.equal(child.status,0,'Installed lifecycle command failed: '+command);return JSON.parse(child.stdout);
  };
  record.version=manifest.version;record.build_id=manifest.build_id;record.native_sha256=manifest.host_sha256;save();
  qualificationIdle(await call('status'),manifest.build_id);
  record.checks.push('Exact published identity, private install, fixed policy and idle unowned task verified');
  if(checkOnly){record.stage='preflight_only';save();console.log(JSON.stringify({preflight_verified:true,build_id:manifest.build_id,desktop_input_sent:false,app_target_checked:false,evidence}));return record;}

  const ready=await call('ready');if(ready.ok&&ready.task_open===true)ownsTask=true;
  assert(ready.ok&&ready.ready===true&&ready.controls_visible===true,'Readiness did not confirm visible controls');
  let image=await call('snapshot',{hwnd:config.hwnd,reason:'Inspect the harmless test canvas before a physical Stop check'});
  assert(image.ok&&image.image?.path,'A fresh usable screenshot is required');
  for(const point of [config.from,config.to])assert(point[0]<image.image.width&&point[1]<image.image.height,'Coordinates are outside the actual screenshot');
  record.stage='awaiting_image_inspection';save();
  console.log(JSON.stringify({stage:record.stage,image:image.image,hwnd:config.hwnd,evidence,instruction:'Inspect this actual image and its harmless drag path. With the human ready, send BEGIN. The human must press Esc as soon as the selection starts moving. Do not re-arm until prompted.'}));
  await beginSignal();
  const moved=await input('move',{hwnd:config.hwnd,observation_id:image.metadata.observation_id,x:config.from[0],y:config.from[1],risk:'routine',reason:'Approach the inspected harmless drag start'});
  assert(moved.ok&&moved.metadata,moved.error?.code);
  const session=JSON.parse(fs.readFileSync(path.join(directory,'desktop-session.json')));
  const journal=currentInputJournal(directory,session.pid),latch=path.join(directory,'emergency.stop');
  let heldSeen=false,ledgerError;
  const sampler=setInterval(()=>{try{if(qualificationLedger(journal).split(/\r?\n/).includes('m:4'))heldSeen=true;}catch(error){ledgerError=error;}},5);
  const steps=physicalStopSteps(config.from,config.to);
  record.stage='awaiting_physical_escape_during_drag';save();
  console.log('Physical check starting: press Esc as soon as the selection moves. Do not click Re-arm yet.');
  let batch;try{batch=await input('run',{hwnd:config.hwnd,observation_id:moved.metadata.observation_id,steps,reason:'Physical Esc must stop the first drag and skip seven queued harmless moves'});}finally{clearInterval(sampler);}
  if(ledgerError)throw ledgerError;
  assert(heldSeen,'Held input was not independently sampled before Stop; do not replay automatically');
  const stopped=await until(async()=>{const state=await call('status');return state.state==='stopped'&&state;},5000);
  assert.equal(stopped.control_reason,'escape','Only the native physical-Esc path qualifies this stage');assert(fs.existsSync(latch));
  const summary=batch.batch||batch;assert.equal(summary.failed_index,0);assert.equal(summary.completed.length,0);assert.equal(summary.skipped,7);
  await until(()=>qualificationLedger(journal)==='',5000);
  record.held_input_sampled=true;record.native_escape_event_seen=true;record.input_ledger_verified_empty=true;
  record.checks.push('Native Esc reason, held-ledger sample, first-step interruption and seven skipped steps verified; target release still needs visual/human review');save();
  assert.equal((await call('resume')).ok,false);assert.equal((await call('snapshot',{hwnd:config.hwnd})).ok,false);
  assert.equal((await call('end')).state,'stopped');ownsTask=false;
  cli('shutdown');
  assert.equal(JSON.parse(fs.readFileSync(config.installation)).release,release,'The deployment changed during qualification; do not restart an older client');
  assert.equal(cli('start').state,'stopped');assert(fs.existsSync(latch));
  const controls=cli('ready');if(controls.ok&&controls.task_open===true)ownsTask=true;
  assert.equal(controls.controls_visible,true,'Do not ask for an invisible Re-arm button');assert.equal(controls.state,'stopped');assert.equal(controls.task_open,true);
  record.stage='awaiting_local_human_rearm';record.checks.push('Stop persisted across passive service restart; explicit controls are visible');save();
  console.log('LOCAL HUMAN: click the triangle Re-arm button once. No further Esc is needed. No app input is sent while waiting.');
  // Wait for local latch deletion using filesystem checks, without flooding the
  // receipt journal or pretending a model message performed human re-arm.
  await until(()=>!fs.existsSync(latch),30000);
  await until(async()=>{const state=await call('status');return state.state==='idle'&&state.task_open===true;},3000);
  image=await call('snapshot',{hwnd:config.hwnd,reason:'Verify a fresh second-session observation after local human re-arm'});assert(image.ok&&image.image?.path);ownsTask=true;
  const second=await input('move',{hwnd:config.hwnd,observation_id:image.metadata.observation_id,x:config.from[0],y:config.from[1],risk:'routine',reason:'Verify a harmless real pointer move in the second session'});assert(second.ok,second.error?.code);
  if(config.close_owned_window){const closed=await call('close_window',{hwnd:config.hwnd,reason:'Close the explicitly operator-owned disposable qualification window'});assert(closed.ok,closed.error?.code);}
  assert.equal((await call('end')).state,'idle');ownsTask=false;
  const final=await call('status');assert.equal(final.task_open,false);assert.equal(final.approved_apps.length,0);assert.notEqual(final.custom_cursor,true);
  if(aborting)throw Object.assign(Error('Qualification was aborted.'),{code:'qualification_aborted'});
  record.passed=true;record.stage='scoped_checks_complete';record.final_status=final;record.checks.push('Local re-arm, second-session observation/pointer action and End verified');save();
  console.log(JSON.stringify({passed:true,qualification_complete:false,target_release_delivery_verified:false,evidence,note:'Review actual target release, visuals and remaining release gates separately.'}));return record;
 }catch(error){
  record.stage='failed';record.error_code=error.code||'qualification_failed';save();fs.writeFileSync(path.join(evidence,'private-error.txt'),error.stack||String(error));
  Object.assign(record,await finishQualification(call,{ownsTask,operationPending}));
  save();throw Object.assign(Error('Qualification failed; inspect the retained private run: '+evidence),{code:record.error_code});
 }finally{process.removeListener('SIGINT',onSignal);process.removeListener('SIGTERM',onSignal);}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 if(!args[0]||args.length>2||args[1]!==undefined&&args[1]!=='--check-only')throw Error('Usage: node tests/installed-stop-resume.mjs CONFIG [--check-only]');
 installedStopQualification(args[0],{checkOnly:args[1]==='--check-only'}).catch(error=>{console.error(error.message);process.exitCode=1;});
}
