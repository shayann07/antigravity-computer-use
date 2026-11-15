import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {Incidents} from '../server/incidents.mjs';import {diagnostics} from '../scripts/diagnostics.mjs';import {testDirectory} from './paths.mjs';
import {spawn} from 'node:child_process';
import {storageOperation} from '../server/storage.mjs';import {acquireServiceLease} from '../server/service-lease.mjs';
import {Runtime} from '../server/runtime.mjs';import {call,validate} from '../server/desktop-tools.mjs';
const acquire=async()=>({assertHeld(){},async release(){}});
function fixture(reporting){const target=fs.mkdtempSync(path.join(testDirectory('tmp'),'reporting-')),directory=path.join(target,'data');fs.mkdirSync(directory);fs.writeFileSync(path.join(target,'update-settings.json'),JSON.stringify({mode:'manual',channel:'stable',reporting}));const i=new Incidents(directory);i.record('computer_click',{error:{code:'stale_observation',message:'private password'}});return {target,directory,i,clean:()=>fs.rmSync(target,{recursive:true})};}
test('agent feedback accepts only fixed classifications and never persists task content',async()=>{
 const original=Incidents.prototype.recordSerialized;let saved;
 Incidents.prototype.recordSerialized=async function(operation,result){saved={operation,result};return 'fixed-incident';};
 try{
  const args={category:'performance',operation:'wait',evidence:'observed'};
  const result=await call({feedback:a=>Runtime.prototype.feedback.call({state:'idle'},a)},'computer_feedback',args);
  assert.equal(result.incident_id,'fixed-incident');assert.equal(result.classification,'agent_report_unverified');
  assert.deepEqual(saved,{operation:'computer_feedback',result:{state:'idle',error:{code:'agent_performance_wait_observed'}}});
  for(const invalid of [{...args,category:'secret_personal_data'},{...args,screenshot:'private'},{...args,evidence:'confirmed'}])assert.throws(()=>validate('computer_feedback',invalid));
  await assert.rejects(Runtime.prototype.feedback.call({state:'idle'},{...args,category:'secret_personal_data'}),e=>e.code==='invalid_feedback');
 }finally{Incidents.prototype.recordSerialized=original;}
});
test('agent concerns remain pending without consent and are labeled unverified when submitted',async()=>{
 const f=fixture(false);try{
  f.i.record('computer_feedback',{error:{code:'agent_focus_type_observed'}});
  assert.equal((await diagnostics(f.directory,{submit:true,target:f.target,acquire,run:()=>assert.fail('no consent')})).next_action,'reporting_consent_required');
  fs.writeFileSync(path.join(f.target,'update-settings.json'),JSON.stringify({mode:'manual',channel:'stable',reporting:true}));let body;
  const run=(_exe,args,options)=>{if(args[1]==='list')return {status:0,stdout:'[]'};if(options.input.includes('agent_focus_type_observed'))body=options.input;return{status:0,stdout:'https://github.com/example/issue'};};
  assert.equal((await diagnostics(f.directory,{submit:true,target:f.target,acquire,run})).submitted,2);
  assert.match(body,/Agent-reported concern \(unverified/);assert(!body.includes('private password'));assert(!f.i.read().some(x=>x.pending));
 }finally{f.clean();}
});
test('no reporting consent means no network command and reports stay pending',async()=>{const f=fixture(false);try{assert.equal((await diagnostics(f.directory,{submit:true,target:f.target,acquire,run:()=>assert.fail('must not contact GitHub')})).next_action,'reporting_consent_required');assert(f.i.read()[0].pending);}finally{f.clean();}});
test('an empty check does not throttle a subsequently recorded incident',async()=>{
 const f=fixture(true);try{
  fs.writeFileSync(f.i.file,'[]');
  const run=(_exe,args)=>args[1]==='list'?{status:0,stdout:'[]'}:{status:0};
  assert.equal((await diagnostics(f.directory,{submit:true,target:f.target,acquire,run,now:10000000})).submitted,0);
  assert.equal(fs.existsSync(path.join(f.directory,'reporting-state.json')),false);
  f.i.record('computer_ready',{error:{code:'guardian_exited'}});
  assert.equal((await diagnostics(f.directory,{submit:true,target:f.target,acquire,run,now:10000001})).submitted,1);
 }finally{f.clean();}
});
test('missing GitHub authentication keeps pending reports and applies retry backoff',async()=>{const f=fixture(true);try{let calls=0;const run=()=>{calls++;return {status:1,stderr:'private credentials'};};assert.equal((await diagnostics(f.directory,{submit:true,target:f.target,acquire,run})).next_action,'github_authentication_or_network_required');assert.equal((await diagnostics(f.directory,{submit:true,target:f.target,acquire,run})).next_action,'reporting_backoff');assert.equal(calls,1);assert(f.i.read()[0].pending);}finally{f.clean();}});
test('consented submission sends sanitized metadata once and resolves duplicate issues',async()=>{for(const duplicate of [false,true]){const f=fixture(true);try{let created=0;const run=(_exe,args,options)=>{if(args[1]==='list')return {status:0,stdout:JSON.stringify(duplicate?[{number:1,title:'[automatic incident '+f.i.read()[0].id+'] '+process.platform+': stale_observation'}]:[])};created++;assert(!options.input.includes('private password'));assert(args.includes('--body-file'));return {status:0,stdout:'https://github.com/example/issue'};};assert.equal((await diagnostics(f.directory,{submit:true,target:f.target,acquire,run})).submitted,1);assert.equal(created,duplicate?0:1);assert.equal(f.i.read()[0].pending,false);}finally{f.clean();}}});
test('submission revalidates stored incidents and drops injected private fields',async()=>{const f=fixture(true);try{const records=f.i.read();records[0].screenshot='C:/private-secret';records[0].clipboard='private-secret';fs.writeFileSync(f.i.file,JSON.stringify(records));let created=false;await diagnostics(f.directory,{submit:true,target:f.target,acquire,run:(_exe,args,options)=>{if(args[1]==='list')return {status:0,stdout:'[]'};created=true;assert(!options.input.includes('private-secret'));return {status:0};}});assert(created);}finally{f.clean();}});
test('identifier-shaped task content is excluded from new and older incident exports',async()=>{
 const f=fixture(true);try{
  f.i.record('private_operation',{state:'private_state',error:{code:'private_identifier'}});
  assert(!fs.readFileSync(f.i.file,'utf8').includes('private_identifier'));
  const records=f.i.read();records[0].code='private_old_code';records[0].operation='private_old_operation';records[0].state='private_old_state';records[0].build='private_old_build';fs.writeFileSync(f.i.file,JSON.stringify(records));
  const safe=f.i.read()[0];assert.equal(safe.code,'unknown');assert.equal(safe.operation,'unknown');assert.equal(safe.state,'unknown');assert.equal(safe.build,'unknown');
  let submissions=0;const run=(_exe,args,options)=>{assert(!JSON.stringify(args).includes('private_'));if(args[1]==='list')return {status:0,stdout:'[]'};submissions++;assert(!options.input.includes('private_'));return {status:0};};
  await diagnostics(f.directory,{submit:true,target:f.target,acquire,run});assert.equal(submissions,2);
 }finally{f.clean();}
});
test('known native permission and file-dialog failures retain useful classifications',()=>{
 const f=fixture(false);try{
  const expected=['mac_permissions_required','file_dialog_path_mismatch','accessibility_denied','window_fullscreen','window_hidden','other_desktop'];
  for(const code of expected)f.i.record('computer_file_dialog',{error:{code}});
  const values=f.i.read().map(item=>item.code);for(const code of expected)assert(values.includes(code));
 }finally{f.clean();}
});
test('corrupt incident data is preserved and prevents recording or submission',async()=>{
 for(const corrupt of ['journal','ack','oversized']){const f=fixture(true);try{
  const file=corrupt==='ack'?f.i.ackFile:f.i.file,contents=corrupt==='oversized'?'x'.repeat(256*1024+1):'{broken';fs.writeFileSync(file,contents);
  assert.throws(()=>f.i.record('computer_ready',{error:{code:'guardian_exited'}}),e=>e.code==='diagnostic_journal_invalid');assert.equal(fs.readFileSync(file,'utf8'),contents);
  assert.equal((await diagnostics(f.directory)).next_action,'diagnostic_journal_invalid');
  assert.equal((await diagnostics(f.directory,{submit:true,target:f.target,acquire,run:()=>assert.fail('must not contact GitHub')})).next_action,'diagnostic_journal_invalid');
 }finally{f.clean();}}
});

test('overlapping reporters defer the second submission and preserve pending incidents',async()=>{
 const f=fixture(true);let held=false,entered,release;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);let creates=0;
 const exclusive=async()=>{if(held)throw Object.assign(Error('held'),{code:'service_already_running'});held=true;entered();await gate;return {assertHeld(){assert(held);},async release(){held=false;}};};
 const run=(_exe,args)=>args[1]==='list'?{status:0,stdout:'[]'}:(creates++,{status:0});
 try{
  const first=diagnostics(f.directory,{submit:true,target:f.target,acquire:exclusive,run});await started;
  const second=await diagnostics(f.directory,{submit:true,target:f.target,acquire:exclusive,run});
  assert.equal(second.next_action,'reporting_in_progress');assert.equal(creates,0);assert(f.i.read()[0].pending);
  release();assert.equal((await first).submitted,1);assert.equal(creates,1);
 }finally{release();f.clean();}
});

test('revoked consent during issue lookup prevents submission',async()=>{
 const f=fixture(true);let created=0;
 try{
  const run=(_exe,args)=>{if(args[1]==='list'){fs.writeFileSync(path.join(f.target,'update-settings.json'),JSON.stringify({mode:'manual',channel:'stable',reporting:false}));return {status:0,stdout:'[]'};}created++;return {status:0};};
  const result=await diagnostics(f.directory,{submit:true,target:f.target,acquire,run});
  assert.equal(result.next_action,'reporting_consent_required');assert.equal(created,0);assert(f.i.read()[0].pending);
 }finally{f.clean();}
});

test('uncertain issue creation is not replayed while search is stale and later reconciles',async()=>{
 const f=fixture(true);let creates=0,found=false;
 try{
  const run=(_exe,args)=>args[1]==='list'?{status:0,stdout:JSON.stringify(found?[{number:1,title:'[automatic incident '+f.i.read()[0].id+'] '+process.platform+': stale_observation'}]:[])}:(creates++,{status:null});
  const first=await diagnostics(f.directory,{submit:true,target:f.target,acquire,run,now:10000000});assert.equal(first.next_action,'github_submission_outcome_unknown');
  assert.equal((await diagnostics(f.directory)).next_action,'github_submission_outcome_unknown');
  const second=await diagnostics(f.directory,{submit:true,target:f.target,acquire,run,now:14000000});assert.equal(second.next_action,'github_submission_outcome_unknown');assert.equal(creates,1);assert(f.i.read()[0].pending);
  found=true;const third=await diagnostics(f.directory,{submit:true,target:f.target,acquire,run,now:18000000});assert.equal(third.submitted,1);assert.equal(creates,1);assert.equal(f.i.read()[0].pending,false);
 }finally{f.clean();}
});
test('completed acknowledgement clears an intent left by an interrupted cleanup',async()=>{
 const f=fixture(true);try{
  const item=f.i.read()[0];fs.writeFileSync(f.i.ackFile,JSON.stringify({[item.id]:item.count}));
  const intent=path.join(f.directory,'reporting-intent.json');fs.writeFileSync(intent,JSON.stringify({id:item.id,count:item.count}));
  const result=await diagnostics(f.directory,{submit:true,target:f.target,acquire,run:()=>assert.fail('no remote work expected')});
  assert.equal(result.submitted,0);assert(!fs.existsSync(intent));assert.equal(f.i.read()[0].pending,false);
 }finally{f.clean();}
});
test('new occurrences remain pending after the previous counter limit',()=>{
 const f=fixture(true);try{
  const item=f.i.read()[0];item.count=1000000;fs.writeFileSync(f.i.file,JSON.stringify([item]));fs.writeFileSync(f.i.ackFile,JSON.stringify({[item.id]:item.count}));
  f.i.record('computer_click',{error:{code:'stale_observation'}});
  const current=f.i.read()[0];assert.equal(current.count,1000001);assert.equal(current.pending,true);
 }finally{f.clean();}
});
test('a similar GitHub search result does not reconcile an uncertain submission',async()=>{
 const f=fixture(true);let creates=0;try{
  const first=(_exe,args)=>args[1]==='list'?{status:0,stdout:'[]'}:(creates++,{status:null});
  await diagnostics(f.directory,{submit:true,target:f.target,acquire,run:first,now:10000000});
  const other=()=>({status:0,stdout:JSON.stringify([{number:12,title:'Unrelated '+f.i.read()[0].id}])});
  const result=await diagnostics(f.directory,{submit:true,target:f.target,acquire,run:other,now:14000000});
  assert.equal(result.next_action,'github_submission_outcome_unknown');assert.equal(creates,1);assert(f.i.read()[0].pending);
 }finally{f.clean();}
});

test('a previously submitted legacy code reconciles after export sanitization',async()=>{
 for(const interrupted of [false,true]){
  const f=fixture(true);try{
   const item=f.i.read()[0],records=JSON.parse(fs.readFileSync(f.i.file));records[0].code='legacy_provider_failure';fs.writeFileSync(f.i.file,JSON.stringify(records));
   if(interrupted)fs.writeFileSync(path.join(f.directory,'reporting-intent.json'),JSON.stringify({id:item.id,count:item.count}));
   let creates=0;const run=(_exe,args)=>args[1]==='list'?{status:0,stdout:JSON.stringify([{number:12,title:`[automatic incident ${item.id}] ${process.platform}: legacy_provider_failure`}])}:(creates++,{status:0});
   const result=await diagnostics(f.directory,{submit:true,target:f.target,acquire,run});
   assert.equal(result.submitted,1);assert.equal(creates,0);assert.equal(f.i.read()[0].pending,false);
  }finally{f.clean();}
 }
});

test('native reporting lease excludes another reporter and recovers after helper death',async t=>{
 const base=testDirectory('tmp'),target=fs.mkdtempSync(path.join(base,'report-native-')),directory=path.join(target,'data'),lockDir=path.join(directory,'reporting-lease');let held;
 try{
  try{storageOperation('data',directory);storageOperation('data',lockDir);held=await acquireServiceLease(lockDir);}
  catch(error){if(['storage_unsafe_ancestor','insecure_storage_ancestor','storage_permissions_conflict'].includes(error.code)){t.skip('native private storage qualification refused: '+error.code);return;}throw error;}
  fs.writeFileSync(path.join(target,'update-settings.json'),JSON.stringify({mode:'manual',channel:'stable',reporting:true}));
  const incidents=new Incidents(directory);incidents.record('computer_click',{error:{code:'stale_observation'}});let created=0;
  const run=(_exe,args)=>args[1]==='list'?{status:0,stdout:'[]'}:(created++,{status:0});
  assert.equal((await diagnostics(directory,{submit:true,target,run})).next_action,'reporting_in_progress');assert.equal(created,0);assert(incidents.read()[0].pending);
  const lost=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Lease loss was not observed')),5000);held.once('lost',()=>{clearTimeout(timer);resolve();});});
  process.kill(held.pid);await lost;assert.throws(()=>held.assertHeld(),e=>e.code==='service_ownership_lost');
  await held.release();held=null;assert.equal((await diagnostics(directory,{submit:true,target,run})).submitted,1);assert.equal(created,1);
 }finally{if(held)await held.release();fs.rmSync(target,{recursive:true,force:true});}
});

test('incident recording survives overlapping report publication',async()=>{
 const f=fixture(true);
 const script=`import fs from 'node:fs';import {diagnostics} from ${JSON.stringify(new URL('../scripts/diagnostics.mjs',import.meta.url).href)};
 const rename=fs.renameSync;fs.renameSync=(from,to)=>{if(String(to).endsWith('incident-acks.json')){console.log('before-rename');const b=Buffer.alloc(1);fs.readSync(0,b,0,1,null);}return rename(from,to);};
 await diagnostics(${JSON.stringify(f.directory)},{submit:true,target:${JSON.stringify(f.target)},acquire:async()=>({assertHeld(){},async release(){}}),run:(_exe,args)=>args[1]==='list'?{status:0,stdout:'[]'}:{status:0}});`;
 const child=spawn(process.execPath,['--input-type=module','-e',script],{stdio:['pipe','pipe','pipe'],windowsHide:true});
 let output='',errors='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>errors+=chunk);
 const closed=new Promise(resolve=>child.once('close',resolve));
 try{
  const deadline=Date.now()+5000;while(!output.includes('before-rename')&&child.exitCode===null&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
  assert(output.includes('before-rename'),'reporter must reach the publication barrier: '+errors);
  f.i.record('computer_click',{error:{code:'stale_observation'}});
  f.i.record('computer_snapshot',{error:{code:'capture_failed'}});
  child.stdin.end('x');assert.equal(await closed,0,errors);
  assert(f.i.read().some(item=>item.code==='capture_failed'),'concurrent incident must survive');
  assert(f.i.read().find(item=>item.code==='stale_observation').pending,'a newer occurrence remains pending');
 }finally{if(child.exitCode===null)child.kill();await closed;f.clean();}
});

test('interrupted acknowledgement publication leaves the incident pending',async()=>{
 const f=fixture(true);
 const script=`import fs from 'node:fs';import {diagnostics} from ${JSON.stringify(new URL('../scripts/diagnostics.mjs',import.meta.url).href)};
 const rename=fs.renameSync;fs.renameSync=(from,to)=>{if(String(to).endsWith('incident-acks.json')){console.log('before-rename');const b=Buffer.alloc(1);fs.readSync(0,b,0,1,null);}return rename(from,to);};
 await diagnostics(${JSON.stringify(f.directory)},{submit:true,target:${JSON.stringify(f.target)},acquire:async()=>({assertHeld(){},async release(){}}),run:(_exe,args)=>args[1]==='list'?{status:0,stdout:'[]'}:{status:0}});`;
 const child=spawn(process.execPath,['--input-type=module','-e',script],{stdio:['pipe','pipe','pipe'],windowsHide:true});let output='';child.stdout.on('data',chunk=>output+=chunk);
 const closed=new Promise(resolve=>child.once('close',resolve));
 try{
  const deadline=Date.now()+5000;while(!output.includes('before-rename')&&child.exitCode===null&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
  assert(output.includes('before-rename'),'reporter must reach acknowledgement publication');
  child.kill();await closed;
  assert.equal(f.i.read()[0].pending,true);
 }finally{if(child.exitCode===null)child.kill();await closed;f.clean();}
});
test('task ownership and Guardian identifiers survive incident sanitization while unknown ones still collapse',()=>{
 const target=fs.mkdtempSync(path.join(testDirectory('tmp'),'incident-ownership-')),i=new Incidents(path.join(target,'data'));fs.mkdirSync(i.directory);
 try{
  const pairs=[['computer_claim','task_owned'],['computer_shutdown','task_owned'],['computer_shutdown','task_requires_end'],['computer_claim','task_required'],['computer_guardian','guardian_exited']];
  for(const [operation,code] of pairs)i.record(operation,{error:{code,message:'private password'}});
  const read=i.read();assert.equal(read.length,pairs.length);
  for(const [operation,code] of pairs)assert(read.some(e=>e.operation===operation&&e.code===code),operation+' '+code);
  assert.notEqual(i.identify('computer_claim',{error:{code:'task_owned'}}),i.identify('computer_shutdown',{error:{code:'task_owned'}}));
  const odd=i.read().length;i.record('computer_made_up',{error:{code:'task_made_up'}});const last=i.read().at(-1);assert.equal(last.operation,'unknown');assert.equal(last.code,'unknown');assert.equal(i.read().length,odd+1);
 }finally{fs.rmSync(target,{recursive:true,force:true});}
});
