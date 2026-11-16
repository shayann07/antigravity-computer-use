import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {testDirectory} from './paths.mjs';
import {priorMacCleanupVerified,priorUndispatchedCleanupVerified,priorMacActiveActorsGone,macProcessStartSeconds,persistRecoveryStop,settlePriorStop,readStopLatch} from '../server/recovery.mjs';

// A guardian killed mid-task leaves "active" in its state file. On macOS that
// settles a stuck Stop only when every recorded actor is gone (by pid and
// recorded start time) and the input ledger is a plain file holding the empty
// ledger. Settling writes an ordinary "stopped" and never resumes the task.
const guard='guard-101-12345678-1234-1234-1234-123456789abc.state';
const EMPTY='{"keys":[],"buttons":[]}';
const ACTIVE='active|f156be59-b6d6-4aef-80ae-b6a5a4c41cc2|639304299518480000|aWQ=|21420859|0|';
const gone=()=>{throw Object.assign(Error('gone'),{code:'ESRCH'});};
const liveOnly=pids=>pid=>{if(pids.includes(pid))return true;gone();};
// Recorded start times of the fixture's actors.
const START={guardian:1794832541.463166,watchdog:1794832551.484657,worker:1794832550.474226};
const noStart=()=>{throw Error('start time must not be needed when every pid is gone');};

function fixture(name){
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),name)),state=path.join(dir,guard);
 fs.writeFileSync(state,ACTIVE);fs.writeFileSync(state+'.inputs',EMPTY);
 fs.writeFileSync(state+'.guardian',`201|${START.guardian}`);
 fs.writeFileSync(state+'.watchdog',`202|${START.watchdog}`);
 fs.writeFileSync(state+'.worker-203',String(START.worker));
 return {dir,state};
}
const undispatched={guard,open:true,children:[],dispatched:false,watchdogs_complete:true};
const dispatched={guard,open:true,children:[102,103,202],dispatched:true,watchdogs_complete:true};
const checks=[
 ['undispatched',(dir,options)=>priorUndispatchedCleanupVerified(dir,undispatched,{platform:'darwin',...options})],
 ['dispatched',(dir,options)=>priorMacCleanupVerified(dir,dispatched,{platform:'darwin',...options})],
];

test('mac active state: happy path settles when every actor is gone and the ledger is empty',()=>{
 const {dir}=fixture('mac-active-happy-');
 try{for(const [kind,verify] of checks)assert.equal(verify(dir,{probe:gone,startOf:noStart}),true,kind);}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('mac active state: a reused pid is told apart by its start time, both ways',()=>{
 const {dir,state}=fixture('mac-active-reuse-');
 try{for(const [kind,verify] of checks){
  // A new process now holds the guardian's pid: it started an hour later, so the guardian is gone.
  assert.equal(verify(dir,{probe:liveOnly([201]),startOf:()=>START.guardian+3600}),true,kind+' reused guardian pid');
  // The same process is still alive (start time matches within 2 s): not gone.
  assert.equal(verify(dir,{probe:liveOnly([201]),startOf:()=>START.guardian+1}),false,kind+' live guardian');
  // Live process whose start time cannot be read: not gone.
  assert.equal(verify(dir,{probe:liveOnly([201]),startOf:()=>null}),false,kind+' unknown start');
  // Another user's process (EPERM) at the pid is still identity-checked.
  const eperm=pid=>{if(pid===202)throw Object.assign(Error('perm'),{code:'EPERM'});gone();};
  assert.equal(verify(dir,{probe:eperm,startOf:()=>START.watchdog}),false,kind+' EPERM same start');
  // A dispatched task also lists the watchdog among its children, which must
  // have no process at all, so only the undispatched path tolerates reuse here.
  assert.equal(verify(dir,{probe:eperm,startOf:()=>START.watchdog-600}),kind==='undispatched',kind+' EPERM other start');
  // Worker markers carry their start time; a live worker with that start blocks.
  assert.equal(verify(dir,{probe:liveOnly([203]),startOf:()=>START.worker}),false,kind+' live worker');
  assert.equal(verify(dir,{probe:liveOnly([203]),startOf:()=>START.worker+90}),true,kind+' reused worker pid');
  // The controller (the pid in the guard name) has no recorded start time:
  // any live process there blocks, whatever its start time.
  assert.equal(verify(dir,{probe:liveOnly([101]),startOf:()=>1}),false,kind+' controller pid live');
 }
 // Children recorded by a dispatched task have no start time either.
 assert.equal(priorMacCleanupVerified(dir,dispatched,{platform:'darwin',probe:liveOnly([103]),startOf:()=>1}),false,'live child');
 // The plain .workers list is identity-checked too.
 fs.writeFileSync(state+'.workers','204:1794832000.5\n');
 assert.equal(priorMacActiveActorsGone(dir,undispatched,{probe:liveOnly([204]),startOf:()=>1794832000}),false);
 assert.equal(priorMacActiveActorsGone(dir,undispatched,{probe:liveOnly([204]),startOf:()=>1794839000}),true);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('mac active state: the ledger must exist, be a plain readable file, and be empty',()=>{
 const {dir,state}=fixture('mac-active-ledger-');const ledger=state+'.inputs',other=path.join(dir,'other-empty');
 const reset=()=>{fs.rmSync(ledger,{force:true,recursive:true});fs.writeFileSync(ledger,EMPTY);};
 try{for(const [kind,verify] of checks){
  const ok=()=>verify(dir,{probe:gone,startOf:noStart});
  fs.rmSync(ledger);assert.equal(ok(),false,kind+' missing ledger');reset();
  for(const held of ['{"keys":[42],"buttons":[]}','{"keys":[],"buttons":[0]}','','{"keys":[]}','garbage'])
  {fs.writeFileSync(ledger,held);assert.equal(ok(),false,kind+' ledger '+JSON.stringify(held));}reset();
  fs.writeFileSync(other,EMPTY);fs.rmSync(ledger);fs.linkSync(other,ledger);assert.equal(ok(),false,kind+' hard-linked ledger');fs.rmSync(other);reset();
  if(process.platform!=='win32'){fs.writeFileSync(other,EMPTY);fs.rmSync(ledger);fs.symlinkSync(other,ledger);assert.equal(ok(),false,kind+' symlinked ledger');fs.rmSync(ledger);fs.rmSync(other);reset();}
  fs.rmSync(ledger);fs.mkdirSync(ledger);assert.equal(ok(),false,kind+' directory ledger');reset();
  if(process.platform!=='win32'&&process.getuid?.()!==0){fs.chmodSync(ledger,0o000);assert.equal(ok(),false,kind+' unreadable ledger');fs.chmodSync(ledger,0o600);}
  assert.equal(ok(),true,kind+' restored');
 }}finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('mac active state: other evidence still fails closed',()=>{
 const {dir,state}=fixture('mac-active-closed-');
 try{for(const [kind,verify] of checks){
  const ok=(options={})=>verify(dir,{probe:gone,startOf:noStart,...options});
  fs.rmSync(state+'.guardian');assert.equal(ok(),false,kind+' missing guardian marker');fs.writeFileSync(state+'.guardian','nonsense');assert.equal(ok(),false,kind+' bad guardian marker');fs.writeFileSync(state+'.guardian',`201|${START.guardian}`);
  fs.writeFileSync(state+'.watchdog','garbage');assert.equal(ok(),false,kind+' bad watchdog marker');fs.writeFileSync(state+'.watchdog',`202|${START.watchdog}`);
  fs.writeFileSync(state+'.worker-203','garbage');assert.equal(ok(),false,kind+' bad worker marker');fs.writeFileSync(state+'.worker-203',String(START.worker));
  fs.writeFileSync(state+'.worker-x1','1');assert.equal(ok(),false,kind+' bad worker name');fs.rmSync(state+'.worker-x1');
  for(const bad of ['active|t|9||9|1|','active|t|9||9|0||extra','active|t|9|','paused|t|9||9|0|']){fs.writeFileSync(state,bad);assert.equal(ok(),false,kind+' '+bad);}
  fs.writeFileSync(state,ACTIVE);assert.equal(ok(),true,kind+' restored');
 }
 // Windows keeps its strict rule: "active" never settles there.
 assert.equal(priorUndispatchedCleanupVerified(dir,undispatched,{platform:'win32',probe:gone,startOf:noStart}),false);
 assert.equal(priorMacCleanupVerified(dir,dispatched,{platform:'win32',probe:gone,startOf:noStart}),false);
 // A dispatched task with complete watchdogs must have left its watchdog marker.
 fs.rmSync(state+'.watchdog');assert.equal(priorMacCleanupVerified(dir,dispatched,{platform:'darwin',probe:gone,startOf:noStart}),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('mac active state: settling writes an ordinary Stop for a human and never resumes the task',()=>{
 const {dir,state}=fixture('mac-active-settle-'),file=path.join(dir,'emergency.stop');
 try{
  persistRecoveryStop(file,guard,{unconfirmed:true,nonce:'b'.repeat(32)});
  assert.throws(()=>settlePriorStop(file,undispatched,{platform:'darwin',probe:liveOnly([201]),startOf:()=>START.guardian}));assert(readStopLatch(file).unconfirmed);
  const before=fs.readFileSync(state,'utf8'),ledger=fs.readFileSync(state+'.inputs','utf8');
  const result=settlePriorStop(file,undispatched,{platform:'darwin',probe:gone,startOf:noStart});
  assert.deepEqual(result,{stopped:true,task_ended:true,next_action:'report_and_wait_for_human',prior_cleanup_verified:true});
  assert.equal(readStopLatch(file).value,'stopped');assert.equal(readStopLatch(file).unconfirmed,false);
  assert.equal(fs.existsSync(file+'.unconfirmed'),false);
  // Read-only towards the old task: its state and ledger are left as found.
  assert.equal(fs.readFileSync(state,'utf8'),before);assert.equal(fs.readFileSync(state+'.inputs','utf8'),ledger);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('mac process start time is read from the live process',{skip:process.platform!=='darwin'},()=>{
 const start=macProcessStartSeconds(process.pid),expected=Date.now()/1000-process.uptime();
 assert(Math.abs(start-expected)<=2,`${start} vs ${expected}`);
 assert.equal(macProcessStartSeconds(4294967295),null);
});
