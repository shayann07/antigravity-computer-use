// Exercise the real updater and installer; only native storage and service calls
// are inert. No live home, installation, network or desktop is touched.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {generateKeyPairSync,sign} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {updateNotice} from '../server/update-notice.mjs';
import {install} from '../scripts/install.mjs';import {rollback} from '../scripts/rollback.mjs';import {update} from '../scripts/update.mjs';
import {sha256,newerVersion,updateSettings} from '../server/update-core.mjs';import {nativePlatform} from '../server/platform.mjs';import {testDirectory} from './paths.mjs';
function fixture({omitFresh=null,badFreshHash=false}={}){
 const directory=fs.mkdtempSync(path.join(testDirectory('tmp'),'update-transaction-')),target=path.join(directory,'installed'),home=path.join(directory,'home');
 const native=nativePlatform(),storage=()=>({ok:true,private_storage:true});
 const createBundle=(name,version)=>{
  const bundle=path.join(directory,name);fs.mkdirSync(bundle,{recursive:true});
  const data={[native.node]:'inert node fixture',['bin/'+native.host]:'inert host fixture',['bin/'+native.storage]:'inert storage fixture','skills/computer-use/SKILL.md':'Use {{DESKTOP_COMMAND}} ready '+version,'scripts/desktop.mjs':'inert CLI fixture'};
  for(const module of 'index desktop-service service-lease desktop-tools receipts incidents update-core storage deployment mcp runtime guardian driver build sessions policy render upstream-utils version platform macos-build auto-update recovery update-notice atomic-json'.split(' '))data['server/'+module+'.mjs']='inert fixture';
  for(const file of ['server/control-contract.json','scripts/arguments.mjs','scripts/diagnostics.mjs','scripts/install.mjs','scripts/update.mjs','scripts/rollback.mjs','scripts/sidecar.mjs','release-public-key.pem',...(process.platform==='win32'?['install.cmd']:['install.command','Setup.Mac.Permissions.command'])])data[file]='inert fixture';
  if(process.platform==='win32'){data['liquidglass/LiquidGlass.Host.exe']='inert visual fixture';data['liquidglass/libSkiaSharp.dll']='inert visual library fixture';}
  if(name==='fresh'&&omitFresh)delete data[omitFresh];
  for(const [name,bytes]of Object.entries(data)){const file=path.join(bundle,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);}
  const files=Object.fromEntries(Object.entries(data).map(([name,bytes])=>[name,sha256(bytes)]));if(name==='fresh'&&badFreshHash)files['server/runtime.mjs']='0'.repeat(64);const build_id=sha256(JSON.stringify(files));
  fs.writeFileSync(path.join(bundle,'bundle-manifest.json'),JSON.stringify({version,build_id,platform:process.platform,arch:process.arch,files}));return {bundle,build_id};
 };
 const old=createBundle('old','1.0.0'),fresh=createBundle('fresh','1.1.0');
 const installer=options=>install({home,prepareStorage:storage,...options});
 installer({bundle:old.bundle,target,sidecar:true});
 const {privateKey,publicKey}=generateKeyPairSync('ed25519'),keyFile=path.join(directory,'public.pem');fs.writeFileSync(keyFile,publicKey.export({type:'spki',format:'pem'}));
 const payload={};const files={};const walk=folder=>{for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.isDirectory())walk(file);else {const name=path.relative(fresh.bundle,file).replaceAll('\\','/'),bytes=fs.readFileSync(file),url='https://github.com/shayann07/antigravity-computer-use/releases/download/v1.1.0/'+sha256(bytes);files[name]={size:bytes.length,sha256:sha256(bytes),url};payload[url]=bytes;}}};walk(fresh.bundle);
 const bytes=Buffer.from(JSON.stringify({schema:1,version:'1.1.0',build_id:fresh.build_id,platform:process.platform,arch:process.arch,sequence:2,min_os:'0.0.0',expires:'2099-01-01',files}));
 const envelope={manifest:bytes.toString('base64'),signature:sign(null,bytes,privateKey).toString('base64')};let fetches=0,state='idle',failHealth=false;const calls=[];
 const adapters={storage,install:installer,keyFile,rollback,prepare:async()=>({ok:true,prepared:true}),cli(record,args){calls.push(args[0]);if(args[0]==='shutdown'){state='not_running';return {ok:true,closed:true};}if(args[0]==='start'){const b=JSON.parse(fs.readFileSync(path.join(record.release,'bundle-manifest.json')));if(failHealth&&b.build_id===fresh.build_id)throw Error('native health fixture failure');state='idle';return {ok:true,state,task_open:false,build_id:b.build_id};}return {ok:true,state,task_open:false,approved_apps:[]};}};
 const fetcher=async url=>{fetches++;if(url.includes('api.github.com'))return {ok:true,json:async()=>({assets:[{name:`update-${process.platform}-${process.arch}.json`,browser_download_url:'https://github.com/shayann07/antigravity-computer-use/releases/download/v1.1.0/metadata.json'}]})};if(url.endsWith('/metadata.json'))return {ok:true,text:async()=>JSON.stringify(envelope)};return {ok:true,body:(async function*(){yield payload[url];})()};};
 return {directory,target,home,old,fresh,adapters,fetcher,calls,setState:v=>state=v,setFailHealth:()=>failHealth=true,fetches:()=>fetches,cleanup:()=>fs.rmSync(directory,{recursive:true,force:true})};
}
test('signed incomplete bundle is refused before shutdown or configuration changes',async()=>{
 const f=fixture({omitFresh:'server/runtime.mjs'});try{
  const before=fs.readFileSync(path.join(f.target,'installation.json'),'utf8');
  await assert.rejects(update(f.target,'check',f),/update_bundle_incomplete/);
  assert.equal(fs.readFileSync(path.join(f.target,'installation.json'),'utf8'),before);assert(!f.calls.includes('shutdown'));assert.equal((await update(f.target,'status',f)).available!==true,true);
 }finally{f.cleanup();}
});
test('signed Windows update cannot omit the promised LiquidGlass helper',{skip:process.platform!=='win32'},async()=>{
 const f=fixture({omitFresh:'liquidglass/LiquidGlass.Host.exe'});try{
  await assert.rejects(update(f.target,'check',f),/update_bundle_incomplete/);
  assert(!f.calls.includes('shutdown'));
 }finally{f.cleanup();}
});
test('signed payload with conflicting bundle inventory is refused before shutdown',async()=>{
 const f=fixture({badFreshHash:true});try{
  await assert.rejects(update(f.target,'check',f),/update_bundle_inventory_mismatch/);
  assert(!f.calls.includes('shutdown'));assert.equal((await update(f.target,'status',f)).available!==true,true);
 }finally{f.cleanup();}
});
test('failed manual check cannot apply a previously staged offer',async()=>{
 const f=fixture();try{
  await update(f.target,'check',f);assert.equal((await update(f.target,'status',f)).available,true);
  await assert.rejects(update(f.target,'check',{...f,fetcher:async()=>{throw Error('offline');}}),/offline/);
  assert.equal((await update(f.target,'status',f)).available,false);
  await assert.rejects(update(f.target,'apply',f),/update_not_staged/);assert(!f.calls.includes('shutdown'));
 }finally{f.cleanup();}
});
test('oversized release listings are refused before payload download or shutdown',async()=>{
 const f=fixture();try{
  let requests=0;const fetcher=async()=>{requests++;return {ok:true,headers:{get:()=>null},body:(async function*(){yield Buffer.alloc(4*1024*1024+1);})()};};
  await assert.rejects(update(f.target,'check',{...f,fetcher}),/update_metadata_size/);
  assert.equal(requests,1);assert(!f.calls.includes('shutdown'));assert.equal((await update(f.target,'status',f)).available,false);
 }finally{f.cleanup();}
});
test('a new check invalidates the prior offer durably before network work',async()=>{
 const f=fixture();let entered,release;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
 try{
  await update(f.target,'check',f);const old=JSON.parse(fs.readFileSync(path.join(f.target,'update-state.json')));assert.equal(old.available,true);
  const checking=update(f.target,'check',{...f,fetcher:async()=>{entered();await gate;throw Error('offline');}});const failure=assert.rejects(checking,/offline/);await started;
  const saved=JSON.parse(fs.readFileSync(path.join(f.target,'update-state.json')));assert.equal(saved.available,false);assert.equal(saved.staged,old.staged);assert(fs.existsSync(old.staged));
  release();await failure;assert(!f.calls.includes('shutdown'));
 }finally{release();f.cleanup();}
});
test('signed full-bundle update preserves settings and Stop, then rollback restores old pins',async()=>{
 const f=fixture();try{
  const config=path.join(f.home,'.gemini/config/config.json');const before=JSON.parse(fs.readFileSync(config));before.unrelated={keep:true};fs.writeFileSync(config,JSON.stringify(before));
  fs.mkdirSync(path.join(f.target,'data'),{recursive:true});fs.writeFileSync(path.join(f.target,'data/emergency.stop'),'stopped');
  await update(f.target,'check',f);assert((await update(f.target,'status',f)).available);
  const result=await update(f.target,'apply',f);assert(result.applied);assert(!fs.existsSync(path.join(f.target,'update-switching.json')));const current=JSON.parse(fs.readFileSync(path.join(f.target,'installation.json')));assert.equal(JSON.parse(fs.readFileSync(path.join(current.release,'bundle-manifest.json'))).build_id,f.fresh.build_id);
  assert(fs.existsSync(path.join(f.target,'data/emergency.stop')));assert(JSON.parse(fs.readFileSync(config)).unrelated.keep);assert.equal(updateSettings(f.target).mode,'automatic');
  assert((await update(f.target,'rollback',f)).rolled_back);assert(!fs.existsSync(path.join(f.target,'update-switching.json')));const restored=JSON.parse(fs.readFileSync(path.join(f.target,'installation.json')));assert.equal(JSON.parse(fs.readFileSync(path.join(restored.release,'bundle-manifest.json'))).build_id,f.old.build_id);
 }finally{f.cleanup();}
});
test('active and paused tasks defer before shutdown or installation',async()=>{
 const f=fixture();try{await update(f.target,'check',f);for(const state of ['active','paused']){f.setState(state);assert((await update(f.target,'apply',f)).deferred);}assert(!f.calls.includes('shutdown'));}finally{f.cleanup();}
});
test('idle open tasks and older services without task state defer before shutdown',async()=>{
 for(const taskOpen of [true,undefined]){const f=fixture();try{
  await update(f.target,'check',f);const original=f.adapters.cli;
  f.adapters.cli=(record,args)=>args[0]==='status'?{ok:true,state:'idle',approved_apps:[],...(taskOpen===undefined?{}:{task_open:taskOpen})}:original(record,args);
  const result=await update(f.target,'apply',f);assert.equal(result.next_action,taskOpen?'wait_for_task_end':'task_state_unavailable');assert(!f.calls.includes('shutdown'));
 }finally{f.cleanup();}}
});
test('update requires explicit reservation and cleanup acknowledgements',async()=>{
 const f=fixture();try{
  await update(f.target,'check',f);const before=fs.readFileSync(path.join(f.target,'installation.json'),'utf8');
  f.adapters.prepare=async()=>({ok:false,prepared:true});assert.equal((await update(f.target,'apply',f)).next_action,'wait_for_task_end');assert(!f.calls.includes('shutdown'));
  f.adapters.prepare=async()=>({ok:true,prepared:true});const original=f.adapters.cli;f.adapters.cli=(record,args)=>args[0]==='shutdown'?{ok:true,closed:false}:original(record,args);
  await assert.rejects(update(f.target,'apply',f),/update_cleanup_unconfirmed/);assert.equal(fs.readFileSync(path.join(f.target,'installation.json'),'utf8'),before);
 }finally{f.cleanup();}
});
test('new service health failure rolls back actual installer changes and restarts prior build',async()=>{
 const f=fixture();try{await update(f.target,'check',f);f.setFailHealth();await assert.rejects(update(f.target,'apply',f),/native health fixture failure/);const restored=JSON.parse(fs.readFileSync(path.join(f.target,'installation.json')));assert.equal(JSON.parse(fs.readFileSync(path.join(restored.release,'bundle-manifest.json'))).build_id,f.old.build_id);assert.equal((await update(f.target,'status',f)).last_error,'update_rolled_back');}finally{f.cleanup();}
});
test('updater rolls back the journal of a partially switched installer under its lease',async()=>{
 const f=fixture();let rename=fs.renameSync,held=false,restores=0;
 try{
  f.adapters.diskInfo=()=>({bavail:1_000_000,bsize:4096});await update(f.target,'check',f);
  f.adapters.acquireControllerLease=async()=>{assert(!held);held=true;return {assertHeld(){assert(held);},async release(){assert(held);held=false;}};};
  const restore=f.adapters.rollback;f.adapters.rollback=file=>{assert(held);restores++;return restore(file);};
  const launcher=path.join(f.target,'cu.mjs');let injected=false;
  fs.renameSync=(from,to)=>{if(!injected&&to===launcher){injected=true;throw Error('injected launcher switch failure');}return rename(from,to);};
  try{await assert.rejects(update(f.target,'apply',f),e=>e.code==='installation_recovery_required');}finally{fs.renameSync=rename;}
  assert(injected);assert.equal(restores,1);assert.equal(held,false);assert(!fs.existsSync(path.join(f.target,'update-switching.json')));
  const current=JSON.parse(fs.readFileSync(path.join(f.target,'installation.json')));assert.equal(JSON.parse(fs.readFileSync(path.join(current.release,'bundle-manifest.json'))).build_id,f.old.build_id);
 }finally{fs.renameSync=rename;f.cleanup();}
});
test('failed startup with no service rolls back after a positive not-running check',async()=>{
 const f=fixture();try{await update(f.target,'check',f);f.setFailHealth();const original=f.adapters.cli;let shutdowns=0;
  f.adapters.cli=(record,args)=>{if(args[0]==='shutdown'&&++shutdowns>1)throw Error('no_session');return original(record,args);};
  await assert.rejects(update(f.target,'apply',f),/native health fixture failure/);
  const restored=JSON.parse(fs.readFileSync(path.join(f.target,'installation.json')));assert.equal(JSON.parse(fs.readFileSync(path.join(restored.release,'bundle-manifest.json'))).build_id,f.old.build_id);assert.equal((await update(f.target,'status',f)).last_error,'update_rolled_back');
 }finally{f.cleanup();}
});
test('failed startup does not roll back when service status is ambiguous or active',async()=>{
 for(const status of [{ok:false,state:'not_running'}, {ok:true,state:'active'}]){const f=fixture();try{await update(f.target,'check',f);f.setFailHealth();const original=f.adapters.cli;let shutdowns=0;
  f.adapters.cli=(record,args)=>{if(args[0]==='shutdown'&&++shutdowns>1)throw Error('no_session');if(args[0]==='status'&&shutdowns>1)return status;return original(record,args);};
  await assert.rejects(update(f.target,'apply',f),/update_recovery_requires_operator/);assert(fs.existsSync(path.join(f.target,'update-switching.json')));
 }finally{f.cleanup();}}
});
test('a false or missing new-service success acknowledgement triggers rollback',async()=>{
 for(const ok of [false,undefined]){const f=fixture();try{
  await update(f.target,'check',f);const original=f.adapters.cli;
  f.adapters.cli=(record,args)=>{if(args[0]==='start'&&JSON.parse(fs.readFileSync(path.join(record.release,'bundle-manifest.json'))).build_id===f.fresh.build_id)return {ok,state:'idle',build_id:f.fresh.build_id};return original(record,args);};
  await assert.rejects(update(f.target,'apply',f),/update_health_failed/);const restored=JSON.parse(fs.readFileSync(path.join(f.target,'installation.json')));assert.equal(JSON.parse(fs.readFileSync(path.join(restored.release,'bundle-manifest.json'))).build_id,f.old.build_id);assert.equal((await update(f.target,'status',f)).last_error,'update_rolled_back');
 }finally{f.cleanup();}}
});
test('a failed controller status never authorizes update shutdown',async()=>{
 const f=fixture();try{await update(f.target,'check',f);const original=f.adapters.cli;f.adapters.cli=(record,args)=>args[0]==='status'?{ok:false,state:'idle',approved_apps:[]}:original(record,args);
  await assert.rejects(update(f.target,'apply',f),/update_controller_check_failed/);assert(!f.calls.includes('shutdown'));
 }finally{f.cleanup();}
});
test('rollback refuses false or mismatched restored health and retains recovery journal',async()=>{
 for(const bad of [{ok:false,state:'idle'}, {ok:true,state:'idle',build_id:'wrong'}]){
  const f=fixture();try{
   await update(f.target,'check',f);await update(f.target,'apply',f);
   const original=f.adapters.cli;f.adapters.cli=(record,args)=>args[0]==='start'?bad:original(record,args);
   await assert.rejects(update(f.target,'rollback',f),/update_rollback_health_failed/);
   assert(fs.existsSync(path.join(f.target,'update-switching.json')),'failed health must retain the recovery journal');
   assert((await update(f.target,'status',f)).interrupted_switch);
  }finally{f.cleanup();}
 }
});
test('automatic rollback retains recovery journal if prior service health is wrong',async()=>{
 const f=fixture();try{
  await update(f.target,'check',f);const original=f.adapters.cli;
  f.adapters.cli=(record,args)=>{if(args[0]==='start'){const b=JSON.parse(fs.readFileSync(path.join(record.release,'bundle-manifest.json')));if(b.build_id===f.fresh.build_id)throw Error('new_build_failed');return {state:'idle',build_id:'wrong'};}return original(record,args);};
  await assert.rejects(update(f.target,'apply',f),/update_recovery_health_failed/);
  assert(fs.existsSync(path.join(f.target,'update-switching.json')));
 }finally{f.cleanup();}
});
test('daily scheduler throttles checks and manual mode performs no network work',async()=>{
 const f=fixture();try{fs.writeFileSync(path.join(f.target,'update-settings.json'),JSON.stringify({mode:'notify',channel:'stable',reporting:false}));await update(f.target,'scheduled',f);const first=f.fetches();await update(f.target,'scheduled',f);assert.equal(f.fetches(),first);fs.writeFileSync(path.join(f.target,'update-settings.json'),JSON.stringify({mode:'manual',channel:'stable',reporting:false}));await update(f.target,'scheduled',f);assert.equal(f.fetches(),first);}finally{f.cleanup();}
});
test('a release without this platform clears an older staged update without applying it',async()=>{
 const f=fixture();try{
  await update(f.target,'check',f);
  const old=JSON.parse(fs.readFileSync(path.join(f.target,'update-state.json')));assert(old.available&&old.staged);
  const missing={...f,fetcher:async()=>({ok:true,json:async()=>({assets:[]})})};
  const result=await update(f.target,'check',missing);assert.equal(result.next_action,'no_signed_release_for_platform');
  const status=await update(f.target,'status',f);assert.equal(status.available,false);assert.equal(status.staged,false);
  assert(fs.existsSync(old.staged),'retained evidence is not deleted');
  await assert.rejects(update(f.target,'apply',f),/update_not_staged/);
  await update(f.target,'scheduled',f);assert(!f.calls.includes('shutdown'));
 }finally{f.cleanup();}
});
test('version ordering blocks downgrade and respects numeric prerelease segments',()=>{assert(!newerVersion('1.0.0','2.0.0'));assert(newerVersion('1.0.0-beta.10','1.0.0-beta.2'));assert(newerVersion('1.0.0','1.0.0-beta.10'));assert(!newerVersion('1.0.0-beta.2','1.0.0'));});
test('corrupted staged bundle is refused before any service shutdown',async()=>{
 const f=fixture();try{await update(f.target,'check',f);const state=JSON.parse(fs.readFileSync(path.join(f.target,'update-state.json')));fs.appendFileSync(path.join(state.staged,'scripts/desktop.mjs'),'tamper');await assert.rejects(update(f.target,'apply',f),/release_payload_mismatch/);assert(!f.calls.includes('shutdown'));}finally{f.cleanup();}
});
test('scheduled reporting checks again after an empty journal but throttles attempts',async()=>{
 const f=fixture();try{
  fs.writeFileSync(path.join(f.target,'update-settings.json'),JSON.stringify({mode:'manual',channel:'stable',reporting:true}));
  let pending=false,calls=0;
  f.adapters.diagnostics=async()=>{calls++;return {submitted:pending?1:0};};
  await update(f.target,'scheduled',f);assert.equal(calls,1);
  pending=true;await update(f.target,'scheduled',f);assert.equal(calls,2);
  await update(f.target,'scheduled',f);assert.equal(calls,2);
  const stateFile=path.join(f.target,'update-state.json'),state=JSON.parse(fs.readFileSync(stateFile));
  state.reporting_at=Date.now()-3600001;fs.writeFileSync(stateFile,JSON.stringify(state));
  await update(f.target,'scheduled',f);assert.equal(calls,3);
 }finally{f.cleanup();}
});
test('offline checks retain the working installation and throttle scheduled retries',async()=>{
 const f=fixture();try{let attempts=0;const offline={...f,fetcher:async()=>{attempts++;throw Error('network_failure');}};await update(f.target,'scheduled',offline);await update(f.target,'scheduled',offline);assert.equal(attempts,1);assert(!f.calls.includes('shutdown'));assert.equal((await update(f.target,'status',f)).last_error,'network_failure');}finally{f.cleanup();}
});

test('a backward clock correction rebases a future update check without a network burst',async()=>{
 const f=fixture();try{
  fs.writeFileSync(path.join(f.target,'update-settings.json'),JSON.stringify({mode:'notify',channel:'stable',reporting:false}));
  const file=path.join(f.target,'update-state.json');fs.writeFileSync(file,JSON.stringify({attempt_at:Date.now()+86400000}));
  await update(f.target,'scheduled',f);const first=f.fetches(),rebased=JSON.parse(fs.readFileSync(file));assert.equal(first,0);assert(rebased.attempt_at<=Date.now());
  await update(f.target,'scheduled',f);assert.equal(f.fetches(),first);
  rebased.attempt_at=Date.now()-86400001;fs.writeFileSync(file,JSON.stringify(rebased));await update(f.target,'scheduled',f);assert(f.fetches()>first);
 }finally{f.cleanup();}
});

test('a future reporting timestamp is rebased without silently submitting reports',async()=>{
 const f=fixture();try{
  fs.writeFileSync(path.join(f.target,'update-settings.json'),JSON.stringify({mode:'manual',channel:'stable',reporting:true}));
  const file=path.join(f.target,'update-state.json');fs.writeFileSync(file,JSON.stringify({reporting_at:Date.now()+7200000}));let calls=0;
  f.adapters.diagnostics=async()=>{calls++;return{submitted:1};};await update(f.target,'scheduled',f);assert.equal(calls,0);
  const state=JSON.parse(fs.readFileSync(file));assert(state.reporting_at<=Date.now());state.reporting_at=Date.now()-3600001;fs.writeFileSync(file,JSON.stringify(state));
  await update(f.target,'scheduled',f);assert.equal(calls,1);
 }finally{f.cleanup();}
});
test('a failed scheduled check never applies a previously staged update on a later tick',async()=>{
 const f=fixture();try{
  await update(f.target,'check',f);
  const stateFile=path.join(f.target,'update-state.json'),state=JSON.parse(fs.readFileSync(stateFile));
  assert(state.available&&state.staged);state.attempt_at=0;fs.writeFileSync(stateFile,JSON.stringify(state));
  let attempts=0;const offline={...f,fetcher:async()=>{attempts++;throw Error('network_failure');}};
  assert.equal((await update(f.target,'scheduled',offline)).next_action,'retry_next_day');
  assert.equal((await update(f.target,'status',f)).available,false);
  await update(f.target,'scheduled',offline);
  assert.equal(attempts,1);assert(!f.calls.includes('shutdown'));assert(fs.existsSync(state.staged));
  const retry=JSON.parse(fs.readFileSync(stateFile));retry.attempt_at=0;fs.writeFileSync(stateFile,JSON.stringify(retry));
  assert((await update(f.target,'scheduled',f)).applied,'a later successful check can stage and apply the update');
 }finally{f.cleanup();}
});
test('a missing signing key clears prior availability and does not attempt a stale apply',async()=>{
 const f=fixture();try{
  await update(f.target,'check',f);const stateFile=path.join(f.target,'update-state.json');const state=JSON.parse(fs.readFileSync(stateFile));state.attempt_at=0;fs.writeFileSync(stateFile,JSON.stringify(state));
  fs.unlinkSync(f.adapters.keyFile);await update(f.target,'scheduled',f);
  const status=await update(f.target,'status',f);assert.equal(status.available,false);assert.equal(status.last_error,'release_signing_not_configured');assert(!f.calls.includes('shutdown'));
  await update(f.target,'scheduled',f);assert(!f.calls.includes('shutdown'));
 }finally{f.cleanup();}
});
test('a failed scheduled apply waits for a new check before retrying',async()=>{
 const f=fixture();try{
  await update(f.target,'check',f);const state=JSON.parse(fs.readFileSync(path.join(f.target,'update-state.json')));fs.appendFileSync(path.join(state.staged,'scripts/desktop.mjs'),'tamper');
  assert.equal((await update(f.target,'scheduled',f)).next_action,'inspect_update_status');
  assert.equal((await update(f.target,'status',f)).available,false);assert(!f.calls.includes('shutdown'));
  assert.equal((await update(f.target,'scheduled',f)).checked,true);assert(!f.calls.includes('shutdown'));
 }finally{f.cleanup();}
});
test('explicit install update preferences and reporting consent survive upgrades',()=>{
 const f=fixture();try{f.adapters.install({bundle:f.fresh.bundle,target:f.target,updateMode:'manual',updateChannel:'beta',reporting:true});f.adapters.install({bundle:f.fresh.bundle,target:f.target});assert.deepEqual(updateSettings(f.target),{mode:'manual',channel:'beta',reporting:true});}finally{f.cleanup();}
});
test('a persisted interrupted-switch journal restores the old installation on scheduled recovery',async()=>{
 const f=fixture();try{
  const previous=JSON.parse(fs.readFileSync(path.join(f.target,'installation.json')));
  const staged=f.adapters.install({bundle:f.fresh.bundle,target:f.target});
  fs.writeFileSync(path.join(f.target,'update-switching.json'),JSON.stringify({previous_installation:previous,rollback:[path.join(staged.backup,'rollback.json')]}));
  assert.equal((await update(f.target,'status',f)).interrupted_switch,true);
  const recovered=await update(f.target,'scheduled',f);assert(recovered.recovered);assert(!fs.existsSync(path.join(f.target,'update-switching.json')));
  const restored=JSON.parse(fs.readFileSync(path.join(f.target,'installation.json')));assert.equal(JSON.parse(fs.readFileSync(path.join(restored.release,'bundle-manifest.json'))).build_id,f.old.build_id);
 }finally{f.cleanup();}
});
test('rollback and interrupted recovery hold the controller fence while restoring files',async()=>{
 for(const mode of ['rollback','recover']){const f=fixture();let held=false,restores=0;try{
  if(mode==='rollback'){await update(f.target,'check',f);await update(f.target,'apply',f);}
  else{const previous=JSON.parse(fs.readFileSync(path.join(f.target,'installation.json'))),staged=f.adapters.install({bundle:f.fresh.bundle,target:f.target});fs.writeFileSync(path.join(f.target,'update-switching.json'),JSON.stringify({previous_installation:previous,rollback:[path.join(staged.backup,'rollback.json')]}));}
  const rollback=f.adapters.rollback,cli=f.adapters.cli;f.adapters.acquireControllerLease=async()=>{assert.equal(held,false);held=true;return {async release(){assert(held);held=false;}};};
  f.adapters.rollback=file=>{assert(held,'rollback must hold controller ownership');restores++;return rollback(file);};
  f.adapters.cli=(record,args)=>{if(args[0]==='start')assert.equal(held,false,'release the fence before starting the service');return cli(record,args);};
  const result=await update(f.target,mode,f);assert(mode==='rollback'?result.rolled_back:result.recovered);assert(restores>0);assert.equal(held,false);
 }finally{f.cleanup();}}
});
test('a competing controller prevents rollback and retains the recovery journal',async()=>{
 const f=fixture();try{await update(f.target,'check',f);await update(f.target,'apply',f);let restored=false;f.adapters.rollback=()=>{restored=true;};f.adapters.acquireControllerLease=async()=>{throw Object.assign(Error('owned'),{code:'service_already_running'});};
  await assert.rejects(update(f.target,'rollback',f),e=>e.code==='service_already_running');assert.equal(restored,false);assert(fs.existsSync(path.join(f.target,'update-switching.json')));
 }finally{f.cleanup();}
});
test('unconfirmed ownership release keeps the recovery journal and never rolls back without a confirmed fence',async()=>{
 const f=fixture();let restores=0;try{
  await update(f.target,'check',f);
  f.adapters.acquireControllerLease=async()=>({async release(){throw Object.assign(Error('helper exit unconfirmed'),{code:'service_lease_cleanup_unconfirmed'});}});
  f.adapters.rollback=()=>{restores++;};
  await assert.rejects(update(f.target,'apply',f),e=>e.code==='service_lease_cleanup_unconfirmed');
  assert.equal(restores,0);assert(fs.existsSync(path.join(f.target,'update-switching.json')));assert(!f.calls.includes('start'));
 }finally{f.cleanup();}
});
test('rollback rejects out-of-tree or duplicate journals before shutdown',async()=>{
 for(const kind of ['outside','duplicate','relative']){const f=fixture();try{
  await update(f.target,'check',f);await update(f.target,'apply',f);const stateFile=path.join(f.target,'update-state.json'),state=JSON.parse(fs.readFileSync(stateFile));
  state.rollback=kind==='outside'?[path.join(f.directory,'rollback.json')]:kind==='relative'?['backups/x/rollback.json']:[state.rollback[0],state.rollback[0]];fs.writeFileSync(stateFile,JSON.stringify(state));
  const before=fs.readFileSync(path.join(f.target,'installation.json'),'utf8');f.calls.length=0;await assert.rejects(update(f.target,'rollback',f),/update_recovery_journal_invalid/);
  assert(!f.calls.includes('shutdown'));assert.equal(fs.readFileSync(path.join(f.target,'installation.json'),'utf8'),before);
 }finally{f.cleanup();}}
});
test('rollback and recovery refuse an unverified private tree before shutdown',async()=>{
 for(const mode of ['rollback','recover']){const f=fixture();try{
  if(mode==='rollback'){await update(f.target,'check',f);await update(f.target,'apply',f);}
  else{const previous=JSON.parse(fs.readFileSync(path.join(f.target,'installation.json'))),staged=f.adapters.install({bundle:f.fresh.bundle,target:f.target});fs.writeFileSync(path.join(f.target,'update-switching.json'),JSON.stringify({previous_installation:previous,rollback:[path.join(staged.backup,'rollback.json')]}));}
  f.calls.length=0;f.adapters.storage=operation=>{if(operation==='verify-tree')throw Error('unsafe_tree');};
  await assert.rejects(update(f.target,mode,f),/unsafe_tree/);assert(!f.calls.includes('shutdown'));
 }finally{f.cleanup();}}
});
test('interrupted-switch recovery requires the restored build identity before clearing its journal',async()=>{
 const f=fixture();try{
  const previous=JSON.parse(fs.readFileSync(path.join(f.target,'installation.json')));
  const staged=f.adapters.install({bundle:f.fresh.bundle,target:f.target});
  const marker=path.join(f.target,'update-switching.json');fs.writeFileSync(marker,JSON.stringify({previous_installation:previous,rollback:[path.join(staged.backup,'rollback.json')]}));
  const original=f.adapters.cli;f.adapters.cli=(record,args)=>args[0]==='start'?{state:'idle',build_id:'wrong'}:original(record,args);
  await assert.rejects(update(f.target,'recover',f),/update_recovery_health_failed/);assert(fs.existsSync(marker));
 }finally{f.cleanup();}
});
test('updating does not re-enable an explicitly disabled Sidecar',async()=>{
 const f=fixture();try{const config=path.join(f.home,'.gemini/config/config.json');const saved=JSON.parse(fs.readFileSync(config));saved.sidecars['antigravity-computer-use'].enabled=false;fs.writeFileSync(config,JSON.stringify(saved));await update(f.target,'check',f);assert((await update(f.target,'apply',f)).applied);assert.equal(JSON.parse(fs.readFileSync(config)).sidecars['antigravity-computer-use'].enabled,false);}finally{f.cleanup();}
});
test('insufficient staging space refuses before payload transfer or service shutdown',async()=>{
 const f=fixture();try{f.adapters.diskInfo=()=>({bavail:1,bsize:1});await assert.rejects(update(f.target,'check',f),/update_insufficient_space/);assert.equal(f.fetches(),2);assert(!f.calls.includes('shutdown'));assert.equal((await update(f.target,'status',f)).available,false);}finally{f.cleanup();}
});
test('overlapping scheduled workers cannot overwrite state or duplicate the daily check',async()=>{
 const f=fixture();try{
  fs.writeFileSync(path.join(f.target,'update-settings.json'),JSON.stringify({mode:'notify',channel:'stable',reporting:false}));
  let entered,release;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);let first=true;
  const blocked={...f,fetcher:async url=>{if(first){first=false;entered();await gate;}return f.fetcher(url);}};
  const worker=update(f.target,'scheduled',blocked);await started;
  const before=fs.readFileSync(path.join(f.target,'update-state.json'),'utf8');
  await assert.rejects(update(f.target,'scheduled',f),e=>e.code==='EEXIST');
  assert.equal(fs.readFileSync(path.join(f.target,'update-state.json'),'utf8'),before);
  release();await worker;const calls=f.fetches();await update(f.target,'scheduled',f);assert.equal(f.fetches(),calls);
 }finally{f.cleanup();}
});
test('a worker reads the current installation after acquiring ownership, not a prior snapshot',async()=>{
 const f=fixture();try{
  await update(f.target,'check',f);await update(f.target,'apply',f);
  const again=await update(f.target,'check',f);assert.equal(again.available,false);assert.equal((await update(f.target,'status',f)).available,false);
 }finally{f.cleanup();}
});
test('failed payload transfer removes only its own partial stage and permits a clean retry',async()=>{
 const f=fixture();try{
  const keep=path.join(f.target,'updates','keep-evidence');fs.mkdirSync(keep,{recursive:true});fs.writeFileSync(path.join(keep,'keep'),'retain');
  const broken={...f,fetcher:async url=>{const response=await f.fetcher(url);if(response.body)return {ok:true,body:(async function*(){yield Buffer.from('corrupt');throw Error('interrupted transfer');})()};return response;}};
  await assert.rejects(update(f.target,'check',broken));assert.deepEqual(fs.readdirSync(path.join(f.target,'updates')),['keep-evidence']);assert.equal(fs.readFileSync(path.join(keep,'keep'),'utf8'),'retain');
  assert((await update(f.target,'check',f)).available);
 }finally{f.cleanup();}
});
test('a pinned project scope keeps its exact launcher and skill while global updates',async()=>{
 const f=fixture();try{
  const workspace=path.join(f.directory,'project');const project=f.adapters.install({bundle:f.old.bundle,target:f.target,workspace,updatePin:true});
  const launcher=fs.readFileSync(project.launcher,'utf8'),skill=fs.readFileSync(path.join(project.skills[0],'SKILL.md'),'utf8');
  await update(f.target,'check',f);assert((await update(f.target,'apply',f)).applied);
  assert.equal(fs.readFileSync(project.launcher,'utf8'),launcher);assert.equal(fs.readFileSync(path.join(project.skills[0],'SKILL.md'),'utf8'),skill);
  const registry=JSON.parse(fs.readFileSync(path.join(f.target,'deployments.json')));assert(Object.values(registry).find(s=>s.workspace===workspace).update_pin);
  assert.equal(JSON.parse(fs.readFileSync(path.join(registry.global.release,'bundle-manifest.json'))).build_id,f.fresh.build_id);
 }finally{f.cleanup();}
});
test('when all scopes are pinned apply does not shutdown the current service',async()=>{
 const f=fixture();try{f.adapters.prepare=()=>assert.fail('Pinned scopes must not reserve the controller');f.adapters.install({bundle:f.old.bundle,target:f.target,updatePin:true});await update(f.target,'check',f);assert.equal((await update(f.target,'apply',f)).next_action,'all_deployments_pinned');assert(!f.calls.includes('shutdown'));}finally{f.cleanup();}
});
test('corrupted update history is refused without resetting sequence or contacting releases',async()=>{
 const f=fixture();try{fs.writeFileSync(path.join(f.target,'update-state.json'),'{broken');await assert.rejects(update(f.target,'check',f),/update_state_invalid/);assert.equal(f.fetches(),0);assert.equal(fs.readFileSync(path.join(f.target,'update-state.json'),'utf8'),'{broken');assert(!fs.existsSync(path.join(f.target,'update.lock')));}finally{f.cleanup();}
});
test('actual worker termination during launcher and final pointer switches recovers old deployment',async()=>{
 for(const crashPoint of ['launcher','installation']){
  const f=fixture();try{
   const prior=JSON.parse(fs.readFileSync(path.join(f.target,'installation.json'))),launcher=fs.readFileSync(prior.launcher,'utf8');
   const config=path.join(f.home,'.gemini/config/config.json'),settings=JSON.parse(fs.readFileSync(config));settings.unrelated='preserve';fs.writeFileSync(config,JSON.stringify(settings));
   fs.mkdirSync(path.join(f.target,'data'),{recursive:true});fs.writeFileSync(path.join(f.target,'data/emergency.stop'),'stopped');
   const marker=path.join(f.target,'update-switching.json');
   const input={target:f.target,home:f.home,bundle:f.fresh.bundle,prior,marker,crashPoint};
   const script=`import fs from 'node:fs';import path from 'node:path';import {install} from ${JSON.stringify(new URL('../scripts/install.mjs',import.meta.url).href)};
const input=JSON.parse(fs.readFileSync(0,'utf8'));let recorded=false;const realRename=fs.renameSync;
fs.renameSync=function(from,to){const result=realRename(from,to);const target=input.crashPoint==='launcher'?input.prior.launcher:path.join(input.target,'installation.json');if(recorded&&to===target){fs.writeFileSync(path.join(input.target,'crash-observed'),input.crashPoint);process.kill(process.pid,'SIGKILL');}return result;};
install({target:input.target,home:input.home,bundle:input.bundle,prepareStorage(){return {test_fixture:true};},journalCreated(file){fs.writeFileSync(input.marker,JSON.stringify({previous_installation:input.prior,rollback:[file]}));recorded=true;}});throw Error('Expected termination point was missed');`;
   const child=spawnSync(process.execPath,['--input-type=module','-e',script],{input:JSON.stringify(input),encoding:'utf8',windowsHide:true,timeout:15000});
   assert.notEqual(child.status,0);assert.equal(fs.readFileSync(path.join(f.target,'crash-observed'),'utf8'),crashPoint,child.stderr);
   assert(fs.existsSync(marker));assert.equal((await update(f.target,'scheduled',f)).recovered,true);
   assert.equal(fs.readFileSync(prior.launcher,'utf8'),launcher);assert.equal(JSON.parse(fs.readFileSync(path.join(f.target,'installation.json'))).release,prior.release);
   assert.equal(JSON.parse(fs.readFileSync(config)).unrelated,'preserve');assert.equal(fs.readFileSync(path.join(f.target,'data/emergency.stop'),'utf8'),'stopped');assert(!fs.existsSync(marker));
  }finally{f.cleanup();}
 }
});
test('update notices are concise, deduplicated and cannot expose stored private errors',()=>{
 const f=fixture();try{const data=path.join(f.target,'data');fs.mkdirSync(data,{recursive:true});const state=path.join(f.target,'update-state.json');
  fs.writeFileSync(state,JSON.stringify({available:true,envelope:'private signed metadata'}));assert.equal(updateNotice(data).kind,'available');assert.equal(updateNotice(data),undefined);
  fs.writeFileSync(state,JSON.stringify({last_error:'C:/private user data',attempt_at:1}));const warning=updateNotice(data);assert.equal(warning.kind,'action_required');assert(!JSON.stringify(warning).includes('private user'));fs.writeFileSync(state,JSON.stringify({last_error:'C:/private user data',attempt_at:2}));assert.equal(updateNotice(data),undefined);
  fs.writeFileSync(state,JSON.stringify({applied_version:'1.1.0',sequence:2}));assert.equal(updateNotice(data).version,'1.1.0');assert.equal(updateNotice(data),undefined);
  fs.writeFileSync(state,JSON.stringify({last_error:'update_rolled_back',sequence:2}));assert.equal(updateNotice(data).kind,'recovered');
 }finally{f.cleanup();}
});
test('global Sidecar policy owns passive startup after differently configured project upgrades',async()=>{
 const f=fixture();try{
  f.adapters.install({bundle:f.old.bundle,target:f.target,permissionMode:'host-managed'});
  f.adapters.install({bundle:f.old.bundle,target:f.target,workspace:path.join(f.directory,'project'),permissionMode:'standalone'});
  const cli=f.adapters.cli;const starts=[];f.adapters.cli=(record,args)=>{if(args[0]==='start')starts.push({launcher:record.launcher,policy:JSON.parse(fs.readFileSync(path.join(record.release,'desktop-policy.json'))).permission_mode});return cli(record,args);};
  await update(f.target,'check',f);assert((await update(f.target,'apply',f)).applied);
  assert.equal(starts.at(-1).launcher,path.join(f.target,'cu.mjs'));assert.equal(starts.at(-1).policy,'host-managed');
  assert((await update(f.target,'rollback',f)).rolled_back);assert.equal(starts.at(-1).launcher,path.join(f.target,'cu.mjs'));assert.equal(starts.at(-1).policy,'host-managed');
 }finally{f.cleanup();}
});
test('update status omits private staging paths, signing envelopes and untrusted worker fields',async()=>{
 const f=fixture();try{await update(f.target,'check',f);fs.writeFileSync(path.join(f.target,'update-worker-result.json'),JSON.stringify({applied:true,version:'1.1.0',private_path:'C:/private-data',error:{code:'unsafe message C:/private-data'}}));const status=await update(f.target,'status',f),text=JSON.stringify(status);assert.equal(status.staged,true);assert.equal(status.next_action,'apply_when_idle');assert(!text.includes('private-data'));assert(!text.includes(f.directory));assert(!Object.hasOwn(status,'envelope'));assert(text.length<1200);}finally{f.cleanup();}
});
test('notify-only status asks to review the update and drops unknown settings fields',async()=>{
 const f=fixture();try{fs.writeFileSync(path.join(f.target,'update-settings.json'),JSON.stringify({mode:'notify',channel:'stable',reporting:false,private:'secret-setting'}));await update(f.target,'check',f);const result=await update(f.target,'status',f);assert.equal(result.next_action,'update_available');assert(!JSON.stringify(result).includes('secret-setting'));}finally{f.cleanup();}
});
test('legacy divergent project pointers stay pinned when the global installation updates',async()=>{
 const f=fixture();try{
  const workspace=path.join(f.directory,'legacy-project'),project=f.adapters.install({bundle:f.old.bundle,target:f.target,workspace});
  const registryFile=path.join(f.target,'deployments.json'),registry=JSON.parse(fs.readFileSync(registryFile));const key=Object.keys(registry).find(k=>registry[k].workspace===workspace);delete registry[key].update_pin;fs.writeFileSync(registryFile,JSON.stringify(registry));
  const launcher=fs.readFileSync(project.launcher,'utf8');await update(f.target,'check',f);assert((await update(f.target,'apply',f)).applied);assert.equal(fs.readFileSync(project.launcher,'utf8'),launcher);
  const updated=JSON.parse(fs.readFileSync(registryFile));assert.equal(updated[key].release,registry[key].release);
  f.adapters.install({bundle:f.old.bundle,target:f.target,workspace});assert.equal(JSON.parse(fs.readFileSync(registryFile))[key].update_pin,true);
  f.adapters.install({bundle:f.old.bundle,target:f.target,workspace,updatePin:false});assert.equal(JSON.parse(fs.readFileSync(registryFile))[key].update_pin,false);
 }finally{f.cleanup();}
});
