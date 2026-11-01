import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import net from 'node:net';
import {createHash} from 'node:crypto';import {PassThrough} from 'node:stream';import {spawnSync} from 'node:child_process';
import {testDirectory,testRoot} from './paths.mjs';
import {stopConfig,newStopEvidence,verifyQualificationRelease,qualificationIdle,qualificationRequest,currentInputJournal,qualificationLedger,finishQualification,physicalStopSteps} from './installed-qualification.mjs';
import {beginSignal,installedStopQualification} from './installed-stop-resume.mjs';
import {request} from '../scripts/desktop.mjs';
import {validate} from '../server/desktop-tools.mjs';
const id='1'.repeat(64);
const config=extra=>stopConfig({installation:path.resolve('inert-installation.json'),expected_build_id:id,hwnd:1,from:[10,20],to:[30,20],...extra});
function folder(t){const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'installed-qualification-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}

test('qualification needs an explicit build and screenshot coordinates; model policy flags are rejected',()=>{
 assert.equal(config({}).close_owned_window,false);
 for(const extra of [{expected_build_id:undefined},{installation:'relative.json'},{hwnd:0},{from:[-1,0]},{to:[1.5,2]},{confirmed:true},{permission_mode:'host-managed'}])assert.throws(()=>config(extra));
 assert.throws(()=>config({evidence:path.resolve(testRoot,'../../outside')}));
});
test('physical qualification queues exactly one drag and seven harmless moves using the real schema',()=>{
 const steps=physicalStopSteps([10,20],[30,20]);
 validate('computer_run',{hwnd:1,observation_id:'inspected-frame',steps,reason:'Owned harmless physical Stop test'});
 assert.equal(steps.filter(step=>step.kind==='drag').length,1);assert.equal(steps.filter(step=>step.kind==='move').length,7);
 assert(!steps.some(step=>['key','resume','grant'].includes(step.kind)));
});
test('qualification evidence is project-local, fresh and never overwrites a failed run',t=>{
 const dir=folder(t),dest=path.join(dir,'run'),c=config({evidence:dest});
 assert.equal(newStopEvidence(c),dest);fs.writeFileSync(path.join(dest,'failed.json'),'retained');
 assert.throws(()=>newStopEvidence(c),e=>e.code==='EEXIST');assert.equal(fs.readFileSync(path.join(dest,'failed.json'),'utf8'),'retained');
 const automatic=newStopEvidence(config({}));assert(path.relative(testRoot,automatic).startsWith('installed-stop-resume'));fs.rmSync(automatic,{recursive:true});
});
test('qualification evidence cannot traverse a junction or symlink',t=>{
 const dir=folder(t),target=path.join(dir,'target'),link=path.join(dir,'link');fs.mkdirSync(target);
 fs.symlinkSync(target,link,process.platform==='win32'?'junction':'dir');
 assert.throws(()=>newStopEvidence(config({evidence:path.join(link,'run')})),e=>e.code==='qualification_evidence_link');assert(!fs.existsSync(path.join(target,'run')));
});
test('missing, whitespace, malformed and linked ledgers never prove empty cleanup',t=>{
 const dir=folder(t),file=path.join(dir,'inputs');
 assert.throws(()=>qualificationLedger(file));fs.writeFileSync(file,'');assert.equal(qualificationLedger(file),'');
 fs.writeFileSync(file,'m:4\nk:17:0:0');assert.equal(qualificationLedger(file),'m:4\nk:17:0:0');
 for(const text of ['\n',' ','corrupt','\ufeff']){fs.writeFileSync(file,text);assert.throws(()=>qualificationLedger(file),e=>e.code==='qualification_ledger_unverified');}
 const linked=path.join(dir,'linked');fs.symlinkSync(file,linked,process.platform==='win32'?'file':undefined);
 assert.throws(()=>qualificationLedger(linked),e=>e.code==='qualification_ledger_unverified');
});
test('qualification refuses active, reserved, paused, stopped or uncertain installs before input',()=>{
 const idle={ok:true,build_id:id,state:'idle',task_open:false,approved_apps:[],recovered_task:false,controller_ownership_lost:false,permission_mode:'host-managed',private_data_storage:true};
 qualificationIdle(idle,id);
 for(const extra of [{state:'active'},{state:'paused'},{state:'stopped'},{task_open:true},{task_open:undefined},{approved_apps:undefined},{approved_apps:[{pid:1}]},{recovered_task:true},{recovered_task:undefined},{controller_ownership_lost:true},{controller_ownership_lost:undefined},{permission_mode:'standalone'},{private_data_storage:undefined},{build_id:'2'.repeat(64)}])assert.throws(()=>qualificationIdle({...idle,...extra},id));
});
test('qualification binds to the sealed file map before loading installed client code',t=>{
 const dir=folder(t),payload=path.join(dir,'payload');fs.writeFileSync(payload,'inert');
 const files={payload:createHash('sha256').update('inert').digest('hex')},expected=createHash('sha256').update(JSON.stringify(files)).digest('hex');
 fs.writeFileSync(path.join(dir,'bundle-manifest.json'),JSON.stringify({build_id:expected,files,version:'fixture'}));
 assert.equal(verifyQualificationRelease(dir,expected).build_id,expected);
 assert.throws(()=>verifyQualificationRelease(dir,id),e=>e.code==='qualification_build_mismatch');
 fs.writeFileSync(payload,'changed');assert.throws(()=>verifyQualificationRelease(dir,expected),e=>e.code==='qualification_payload_mismatch');
});
test('the input journal comes from the durable current task, not a PID-prefix directory guess',t=>{
 const dir=folder(t),guard='guard-123-11111111-1111-1111-1111-111111111111.state';
 fs.writeFileSync(path.join(dir,'guard-123-00000000-0000-0000-0000-000000000000.state.inputs'),'old');
 fs.writeFileSync(path.join(dir,'task-state.json'),JSON.stringify({schema:1,open:true,guard,dispatched:true}));
 assert.equal(currentInputJournal(dir,123),path.join(dir,guard+'.inputs'));
 assert.throws(()=>currentInputJournal(dir,456),e=>e.code==='qualification_guard_unknown');
});
test('the real client carries the fixed installed permission-policy binding',async()=>{
 let seen;
 const server=net.createServer(socket=>{let text='';socket.setEncoding('utf8');socket.on('data',chunk=>{text+=chunk;if(text.includes('\n')){seen=JSON.parse(text);socket.end('{"ok":true}\n');}});});
 await new Promise(resolve=>server.listen({host:'127.0.0.1',port:0},resolve));
 try{
  const response=await qualificationRequest(request,{pipe:{host:'127.0.0.1',port:server.address().port},secret:'inert'}, {permission_mode:'host-managed'},'status');
  assert(response.ok);assert.equal(seen.expected_permission_mode,'host-managed');assert.equal(seen.command,'status');
  assert.throws(()=>qualificationRequest(()=>assert.fail('No request allowed'),{}, {permission_mode:'standalone'},'status'),e=>e.code==='qualification_policy_mismatch');
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('BEGIN is only a bounded start signal; closed, invalid and timed-out input cannot begin a drag',async()=>{
 const good=new PassThrough(),ready=beginSignal({input:good,timeoutMs:100});good.write('BEGIN\n');await ready;good.destroy();
 const bad=new PassThrough(),invalid=beginSignal({input:bad,timeoutMs:100});bad.write('done\n');await assert.rejects(invalid,e=>e.code==='qualification_begin_invalid');bad.destroy();
 const closed=new PassThrough(),ending=beginSignal({input:closed,timeoutMs:100});closed.end();await assert.rejects(ending,e=>e.code==='qualification_begin_closed');
 const quiet=new PassThrough();await assert.rejects(beginSignal({input:quiet,timeoutMs:5}),e=>e.code==='qualification_begin_timeout');quiet.destroy();
});
test('failed qualification never cleans up an unowned task and independently attempts owned cleanup',async()=>{
 const calls=[];
 const call=async command=>{calls.push(command);if(command==='stop')throw Error('unconfirmed');return {ok:true,ended:true};};
 assert.deepEqual(await finishQualification(call,{ownsTask:false,operationPending:true}),{cleanup_attempted:false});assert.deepEqual(calls,[]);
 assert.equal((await finishQualification(call,{ownsTask:true,operationPending:true})).cleanup_unconfirmed,true);assert.deepEqual(calls,['stop','end']);
 const known=[];const finished=await finishQualification(async command=>{known.push(command);return {ok:true,ended:true};},{ownsTask:true,operationPending:false});
 assert.equal(finished.cleanup_unconfirmed,false);assert.deepEqual(known,['end']);
});
test('importing the installed Stop harness cannot start control or require Windows',t=>{
 const dir=folder(t),module=new URL('./installed-stop-resume.mjs',import.meta.url).href;
 const run=spawnSync(process.execPath,['--input-type=module','-e','await import('+JSON.stringify(module)+');console.log("import-only");'],{encoding:'utf8',windowsHide:true,timeout:10000,env:{...process.env,AGCU_DATA_DIR:dir}});
 assert.equal(run.status,0,run.stderr);assert.equal(run.stdout.trim(),'import-only');assert.deepEqual(fs.readdirSync(dir),[]);
});

// Whole-flow fixture: no executable is started, no native connection exists and
// all apparent input/Stop/re-arm states below are explicitly simulated data.
async function simulatedQualification(t,{busy=false,incompleteStop=false}={}){
 const dir=folder(t),target=path.join(dir,'installation'),release=path.join(target,'releases','fixture'),data=path.join(target,'data');
 fs.mkdirSync(release,{recursive:true});fs.mkdirSync(data);
 const bytes='inert payload',files={'fixture.txt':createHash('sha256').update(bytes).digest('hex')};
 const expected=createHash('sha256').update(JSON.stringify(files)).digest('hex');fs.writeFileSync(path.join(release,'fixture.txt'),bytes);
 fs.writeFileSync(path.join(release,'bundle-manifest.json'),JSON.stringify({build_id:expected,files,version:'fixture'}));
 fs.writeFileSync(path.join(release,'desktop-policy.json'),JSON.stringify({permission_mode:'host-managed',data_dir:data}));
 const installation=path.join(target,'installation.json');fs.writeFileSync(installation,JSON.stringify({release,integration:'direct'}));
 fs.writeFileSync(path.join(data,'desktop-session.json'),JSON.stringify({pid:123,secret:'inert',pipe:'not-a-real-connection'}));
 const configFile=path.join(dir,'config.json'),evidence=path.join(dir,'evidence');
 fs.writeFileSync(configFile,JSON.stringify({installation,expected_build_id:expected,hwnd:1,from:[10,20],to:[30,20],evidence}));
 let state=busy?'active':'idle',open=busy,reason='';const calls=[];
 const guard='guard-123-11111111-1111-1111-1111-111111111111.state',journal=path.join(data,guard+'.inputs'),latch=path.join(data,'emergency.stop');
 fs.writeFileSync(journal,'');
 const status=()=>({ok:true,build_id:expected,state,task_open:open,approved_apps:state==='active'?[{pid:7}]:[],recovered_task:false,controller_ownership_lost:false,permission_mode:'host-managed',private_data_storage:true,custom_cursor:state==='active',control_reason:reason});
 const fixtures={
  verifyInstall:()=>({status:0,stdout:JSON.stringify({build_id:expected})}),begin:async()=>{},
  async request(_session,command,args,_timeout,policy){
   assert.equal(policy,'host-managed');calls.push(command);
   if(command==='status')return status();
   if(command==='ready'){open=true;return {...status(),ready:state==='idle',controls_visible:true};}
   if(command==='snapshot'){
    if(state==='stopped')return {ok:false};state='active';open=true;
    return {ok:true,metadata:{observation_id:'inert-frame'},image:{path:'inert-not-a-screenshot',width:100,height:100}};
   }
   if(command==='move'){fs.writeFileSync(path.join(data,'task-state.json'),JSON.stringify({schema:1,open:true,guard,dispatched:true}));return {ok:true,input_completed:true,metadata:{observation_id:'inert-next'}};}
   if(command==='run'){
    assert.equal(args.steps.length,8);fs.writeFileSync(journal,'m:4');await new Promise(resolve=>setTimeout(resolve,25));
    fs.writeFileSync(journal,'');fs.writeFileSync(latch,'inert-only');state='stopped';reason='escape';return {ok:false,failed_index:0,completed:[],skipped:incompleteStop?6:7};
   }
   if(command==='resume')return {ok:false};
   if(command==='end'){open=false;state=state==='stopped'?'stopped':'idle';return {ok:true,ended:true,state};}
   assert.fail('Unexpected simulated command '+command);
  },
  lifecycle(command){calls.push('cli:'+command);if(command==='shutdown')return {ok:true};if(command==='start')return {ok:true,state:'stopped'};
   assert.equal(command,'ready');open=true;setTimeout(()=>{fs.unlinkSync(latch);state='idle';reason='simulated-human-rearm';},15);
   return {ok:true,state:'stopped',task_open:true,controls_visible:true};
  }
 };
 const log=console.log;console.log=()=>{};
 try{
  if(busy){await assert.rejects(installedStopQualification(configFile,{fixtures}),e=>e.code==='qualification_not_idle');assert.deepEqual(calls,['status']);return;}
  if(incompleteStop){
   await assert.rejects(installedStopQualification(configFile,{fixtures}));
   const result=JSON.parse(fs.readFileSync(path.join(evidence,'result.json')));
   assert.equal(result.passed,false);assert.equal(result.evidence_kind,'inert_fixture');assert.equal(result.cleanup_unconfirmed,false);
   assert.equal(calls.filter(command=>command==='run').length,1);assert.equal(calls.at(-1),'end');
   assert(!calls.some(command=>command.startsWith('cli:')));assert(fs.existsSync(latch));return;
  }
  const result=await installedStopQualification(configFile,{fixtures});
  assert.equal(result.passed,true);assert.equal(result.evidence_kind,'inert_fixture');assert.equal(result.qualification_complete,false);assert.equal(result.target_release_delivery_verified,false);
  assert(calls.indexOf('cli:ready')>calls.indexOf('cli:start'));assert.equal(calls.filter(command=>command==='run').length,1);assert.equal(calls.includes('stop'),false);
 }finally{console.log=log;}
}
test('the complete installed protocol sequence has an explicitly inert regression',{skip:process.platform!=='win32'},async t=>simulatedQualification(t));
test('an already reserved installation is never shown, stopped, ended or driven by the harness',{skip:process.platform!=='win32'},async t=>simulatedQualification(t,{busy:true}));
test('incomplete Stop evidence fails without replay, restart or re-arm and ends only the owned task',{skip:process.platform!=='win32'},async t=>simulatedQualification(t,{incompleteStop:true}));
