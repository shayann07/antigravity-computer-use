import {testDirectory} from './paths.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {Sessions} from '../server/sessions.mjs';
import {EventEmitter,once} from 'node:events';import {storageOperation} from '../server/storage.mjs';import {acquireServiceLease} from '../server/service-lease.mjs';
import {spawn} from 'node:child_process';
const inertFence=()=>({assertHeld(){},async release(){}});

test('stale cleanup distinguishes a new verified fence helper from live or replaced owners',async t=>{
 for(const scenario of ['own-helper','foreign-live','already-live','changed-record']){
  const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'pid-reuse-'));let spawned=false,released=0;
  const s=new Sessions({dir,isAlive:()=>scenario==='already-live'||spawned&&scenario!=='changed-record',acquireInputLease:async()=>{
   spawned=true;if(scenario==='changed-record')fs.writeFileSync(s.lease,JSON.stringify({pid:124,at:2}));
   return {pid:scenario==='own-helper'?123:456,assertHeld(){},async release(){released++;}};
  }});
  try{
   fs.writeFileSync(s.lease,JSON.stringify({pid:123,at:1}));
   if(scenario==='own-helper'){assert((await s.clearVerifiedStale(123)).cleared);assert(!fs.existsSync(s.lease));}
   else{await assert.rejects(s.clearVerifiedStale(123),/not confirmed gone/);assert(fs.existsSync(s.lease));}
   assert.equal(released,scenario==='already-live'?0:1);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
 }
});
test('peer guidance describes only the scope actually coordinated',()=>{
 const s=new Sessions({dir:testDirectory('peer-guidance'),sessionId:'advisory'});s.peers=()=>[{pid:123,label:'session 2',session_id:'different'}];
 const note=s.note(null,{always:true}),description=s.describe();
 assert.match(note,/only within this data directory/);assert.match(note,/sharing one Sidecar are not identified/);
 assert.match(description,/registrations in this data directory/);assert.doesNotMatch(note+description,/Claude|grants.*never shared/i);
});
test('unavailable input lease fails closed without executing action',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-lease-'));const s=new Sessions({dir,acquireInputLease:async()=>inertFence()});s.lease=path.join(dir,'missing','input.lease');let executed=false;
 await assert.rejects(s.withInput('click',{},async()=>{executed=true;}),e=>e.code==='input_lease_unavailable');assert.equal(executed,false);
 fs.rmSync(dir,{recursive:true,force:true});
});
test('live or incompletely written metadata is never stolen because of age',()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-metadata-'));const s=new Sessions({dir,now:()=>10_000_000,isAlive:()=>true});
 try{
  fs.writeFileSync(s.lease,JSON.stringify({pid:123,at:1}));assert.equal(s._tryClaim('click',null),false);assert(fs.existsSync(s.lease));assert.equal(s.holder().pid,123);
  fs.writeFileSync(s.lease,'{');assert.equal(s._tryClaim('click',null),false);assert.equal(fs.readFileSync(s.lease,'utf8'),'{');
  s.alive=()=>false;for(const pid of ['123',0,4294967296]){const raw=JSON.stringify({pid});fs.writeFileSync(s.lease,raw);assert.equal(s._tryClaim('click',null),false);assert.equal(fs.readFileSync(s.lease,'utf8'),raw);}
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('a dead metadata owner is refused until verified cleanup holds the native fence',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-dead-owner-'));let held=false;const s=new Sessions({dir,isAlive:()=>false,acquireInputLease:async()=>{held=true;return {assertHeld(){assert(held);},async release(){held=false;}};}});
 try{fs.writeFileSync(s.lease,JSON.stringify({pid:123,at:1}));await assert.rejects(s.withInput('fixture',null,async()=>assert.fail('must not dispatch')),e=>e.code==='input_lease_stale');assert(fs.existsSync(s.lease));await assert.rejects(s.clearVerifiedStale(124));assert(fs.existsSync(s.lease));assert((await s.clearVerifiedStale(123)).cleared);const result=await s.withInput('fixture',null,async()=>{assert(held);return {ok:true};});assert(result.ok);assert.equal(held,false);assert(!fs.existsSync(s.lease));}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('input wait remains bounded if the wall clock stops or moves backwards',async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-clock-'));let tick=0,wall=1000;const s=new Sessions({dir,now:()=>wall--,monotonic:()=>tick,sleep:async ms=>{tick+=ms;},isAlive:()=>true,acquireInputLease:async()=>inertFence()});
 try{fs.writeFileSync(s.lease,JSON.stringify({pid:123,at:1}));await assert.rejects(s.withInput('fixture',null,async()=>assert.fail('must not execute'),{waitMs:80}),e=>e.code==='another_session_busy');assert.equal(tick,80);assert(fs.existsSync(s.lease));}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('lost or unconfirmed native input fence requests Stop and forbids replay',async()=>{
 for(const failure of ['lost','release']){const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-input-lost-'));const fence=new EventEmitter();fence.lost=false;fence.assertHeld=()=>{if(fence.lost)throw Error('lost');};fence.release=async()=>{if(failure==='release')throw Error('unconfirmed');};let stops=0,calls=0;
  const s=new Sessions({dir,acquireInputLease:async()=>fence,onInputLeaseLost:()=>stops++});
  try{await assert.rejects(s.withInput('click',null,async()=>{calls++;if(failure==='lost'){fence.lost=true;fence.emit('lost');}return {ok:true};}),e=>e.code==='input_outcome_unknown');assert.equal(calls,1);assert.equal(stops,1);}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
 }
});
test('real input-fence helper death requests Stop and prevents replay',{timeout:30000},async t=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-input-death-'));let release,entered,lease,action,assertion;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);let stops=0,calls=0;
 try{
  try{storageOperation('data',dir);}catch(error){if(['storage_unsafe_ancestor','insecure_storage_ancestor','storage_permissions_conflict'].includes(error.code)){t.skip('native private storage qualification refused: '+error.code);return;}throw error;}
  const s=new Sessions({dir,acquireInputLease:async folder=>lease=await acquireServiceLease(folder),onInputLeaseLost:()=>stops++});
  action=s.withInput('fixture',null,async()=>{calls++;entered();await gate;return {ok:true};});assertion=assert.rejects(action,e=>e.code==='input_outcome_unknown');await started;
  const lost=once(lease,'lost');process.kill(lease.pid);await lost;release();await assertion;assert.equal(stops,1);assert.equal(calls,1);
 }finally{release();if(assertion)await Promise.allSettled([assertion]);fs.rmSync(dir,{recursive:true,force:true});}
});
test('native input fences prevent independent sessions from overlapping',{timeout:30000},async t=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-input-fence-'));let releaseFirst,firstEntered,secondBlocked,first,second;
 const gate=new Promise(resolve=>releaseFirst=resolve),entered=new Promise(resolve=>firstEntered=resolve),blocked=new Promise(resolve=>secondBlocked=resolve);
 try{
  try{storageOperation('data',dir);}catch(error){if(['storage_unsafe_ancestor','insecure_storage_ancestor','storage_permissions_conflict'].includes(error.code)){t.skip('native private storage qualification refused: '+error.code);return;}throw error;}
  const one=new Sessions({dir}),two=new Sessions({dir,acquireInputLease:async folder=>{try{return await acquireServiceLease(folder);}catch(error){if(error.code==='service_already_running')secondBlocked();throw error;}}});let secondRan=false;
  first=one.withInput('click',null,async()=>{firstEntered();await gate;return {ok:true};});await Promise.race([entered,first.then(()=>{throw Error('First action ended before its barrier');})]);
  second=two.withInput('click',null,async()=>{secondRan=true;return {ok:true};},{waitMs:10000});await Promise.race([blocked,second.then(()=>{throw Error('Second action completed before first released');})]);assert.equal(secondRan,false);releaseFirst();await first;await second;assert.equal(secondRan,true);
 }finally{releaseFirst();await Promise.allSettled([first,second].filter(Boolean));fs.rmSync(dir,{recursive:true,force:true});}
});
test('separate processes cannot overlap input actions under the native fence',{timeout:30000},async t=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-input-processes-'));let first,second;
 try{
  try{storageOperation('data',dir);}catch(error){if(['storage_unsafe_ancestor','insecure_storage_ancestor','storage_permissions_conflict'].includes(error.code)){t.skip('native private storage qualification refused: '+error.code);return;}throw error;}
  const script=`import fs from 'node:fs';import {Sessions} from ${JSON.stringify(new URL('../server/sessions.mjs',import.meta.url).href)};import {acquireServiceLease} from ${JSON.stringify(new URL('../server/service-lease.mjs',import.meta.url).href)};
   const s=new Sessions({dir:process.argv[1],acquireInputLease:async p=>{try{return await acquireServiceLease(p);}catch(e){if(e.code==='service_already_running')console.log('blocked');throw e;}}});
   await s.withInput('fixture',null,async()=>{console.log('entered');if(process.argv[2]==='first'){const b=Buffer.alloc(1);fs.readSync(0,b,0,1,null);}},{waitMs:10000});`;
  const start=label=>{const child=spawn(process.execPath,['--input-type=module','-e',script,dir,label],{stdio:['pipe','pipe','pipe'],windowsHide:true});child.output='';child.errors='';child.stdout.on('data',x=>child.output+=x);child.stderr.on('data',x=>child.errors+=x);child.done=new Promise(resolve=>child.once('close',resolve));return child;};
  const until=Date.now()+15000,waitFor=async(child,word)=>{while(!child.output.includes(word)&&child.exitCode===null&&child.signalCode===null&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,20));assert(child.output.includes(word),child.errors+' '+child.output);};
  first=start('first');await waitFor(first,'entered');second=start('second');await waitFor(second,'blocked');assert(!second.output.includes('entered'));first.stdin.end('x');assert.equal(await first.done,0,first.errors);assert.equal(await second.done,0,second.errors);assert(second.output.includes('entered'));
 }finally{
  if(first&&first.exitCode===null&&first.signalCode===null){first.stdin.end('x');first.kill();}if(second&&second.exitCode===null&&second.signalCode===null)second.kill();
  await Promise.allSettled([first?.done,second?.done].filter(Boolean));fs.rmSync(dir,{recursive:true,force:true});
 }
});
test('a killed owner leaves stale metadata until explicitly verified cleanup',{timeout:30000},async t=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-input-crash-'));let child;
 try{
  try{storageOperation('data',dir);}catch(error){if(['storage_unsafe_ancestor','insecure_storage_ancestor','storage_permissions_conflict'].includes(error.code)){t.skip('native private storage qualification refused: '+error.code);return;}throw error;}
  const script=`import fs from 'node:fs';import {Sessions} from ${JSON.stringify(new URL('../server/sessions.mjs',import.meta.url).href)};const s=new Sessions({dir:process.argv[1]});await s.withInput('fixture',null,async()=>{console.log('entered');const b=Buffer.alloc(1);fs.readSync(0,b,0,1,null);});`;
  child=spawn(process.execPath,['--input-type=module','-e',script,dir],{stdio:['pipe','pipe','pipe'],windowsHide:true});let output='',errors='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>errors+=x);child.done=new Promise(resolve=>child.once('close',resolve));
  const deadline=Date.now()+15000;while(!output.includes('entered')&&child.exitCode===null&&child.signalCode===null&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));assert(output.includes('entered'),errors);const pid=child.pid;child.kill();await child.done;
  const s=new Sessions({dir});await assert.rejects(s.withInput('fixture',null,async()=>assert.fail('must not execute'),{waitMs:10000}),e=>e.code==='input_lease_stale');assert(fs.existsSync(s.lease));
  // In production the caller reaches this internal method only after the
  // previous guard, processes and ledger are verified; this fixture sent no input.
  assert((await s.clearVerifiedStale(pid)).cleared);assert((await s.withInput('fixture',null,async()=>({ok:true}))).ok);
 }finally{if(child&&child.exitCode===null&&child.signalCode===null)child.kill();if(child)await child.done;fs.rmSync(dir,{recursive:true,force:true});}
});
