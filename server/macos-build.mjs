// Native adapters only. Tool dispatch, control lifecycle and IPC stay shared.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const syncPause=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
// Source-build coordination only. Prebuilt installations never enter this path.
// Reuse the native kernel lease instead of a removable/stale PID lock file.
export function macCompilerLease(directory,{helper=buildMacStorage(),spawnProcess=spawn,startupMs=5000}={}){
 if(!Number.isSafeInteger(startupMs)||startupMs<1||startupMs>15000)throw Error('Invalid source-build lease startup bound');
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 // Keep transport files outside the dedicated native lease directory. Its
 // first initialization deliberately refuses unrelated existing contents.
 const scratch=fs.mkdtempSync(path.join(path.dirname(directory),'.compiler-reply-'));
 const output=path.join(scratch,'reply.jsonl'),error=path.join(scratch,'stderr.txt');
 const out=fs.openSync(output,'wx',0o600),err=fs.openSync(error,'wx',0o600);
 let child;
 try{child=spawnProcess(helper,['lease',path.resolve(directory)],{stdio:['pipe',out,err],windowsHide:true});}
 finally{fs.closeSync(out);fs.closeSync(err);}
 child.on('error',()=>{});child.stdin?.on('error',()=>{});
 const rootInfo=fs.lstatSync(directory);let released=false;
 const live=()=>{
  if(!Number.isSafeInteger(child.pid)||child.exitCode!==null||child.signalCode!=null)return false;
  try{process.kill(child.pid,0);}catch{return false;}
  if(process.platform==='darwin'){
   const state=spawnSync('/bin/ps',['-o','stat=','-p',String(child.pid)],{encoding:'utf8',timeout:3000});
   if(state.status!==0||!/^\s*[A-Z]/.test(state.stdout||'')||/^\s*Z/.test(state.stdout||''))return false;
  }
  return true;
 };
 const release=()=>{
  if(released)return;released=true;try{child.stdin?.end();}catch{}
  // This is only our disposable cache-lease helper, never a controller or
  // compiler. Confirm kernel ownership ended even while Node is synchronous.
  try{child.kill();}catch{}const deadline=performance.now()+2000;
  while(live()&&performance.now()<deadline)syncPause(10);
  child.unref();
  if(live())throw Object.assign(Error('Build-cache lease cleanup is unconfirmed; inspect before another source build.'),{code:'macos_build_lease_cleanup_unconfirmed'});
  // Remove only the two files created by this request, never the shared lock.
  for(const file of [output,error])try{fs.unlinkSync(file);}catch{}
  try{fs.rmdirSync(scratch);}catch{}
 };
 const fail=code=>{release();try{child.kill();}catch{}throw Object.assign(Error('Native source-build ownership could not be verified; no new host was published.'),{code});};
 const readReply=()=>{
  const bytes=fs.readFileSync(output,'utf8');if(bytes.length>8192)fail('macos_build_lease_invalid');
  if(!bytes.includes('\n'))return null;
  try{return JSON.parse(bytes.split('\n')[0]);}catch{fail('macos_build_lease_invalid');}
 };
 const deadline=performance.now()+startupMs;let reply;
 while(performance.now()<deadline){
  reply=readReply();if(reply)break;
  // A busy/refused helper exits after writing its final reply. In particular,
  // macOS ps can observe that exit after our preceding read saw an empty file.
  // Re-read once after exit before declaring that no acknowledgement arrived.
  if(!live()){reply=readReply();if(reply)break;fail('macos_build_lease_exited');}
  syncPause(10);
 }
 if(!reply)fail('macos_build_lease_timeout');
 if(reply.ok===false&&reply.error?.code==='service_already_running'){release();return {acquired:false,release};}
 if(reply.ok!==true||reply.lease_acquired!==true||reply.private_storage_verified!==true||reply.pid!==child.pid)fail('macos_build_lease_refused');
 return {acquired:true,release,assertHeld(){
  if(released)fail('macos_build_lease_lost');
  const current=fs.lstatSync(directory),lines=fs.readFileSync(output,'utf8').trim().split('\n');
  if(released||!live()||current.isSymbolicLink()||current.dev!==rootInfo.dev||current.ino!==rootInfo.ino||lines.length!==1)fail('macos_build_lease_lost');
 }};
}
export function waitForMacCompilerWinner(check,{timeoutMs=150000}={}){
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>150000)throw Error('Invalid source-build winner bound');
 const deadline=performance.now()+timeoutMs;
 while(performance.now()<deadline){const winner=check();if(winner)return winner;syncPause(25);}
 throw Object.assign(Error('Another source build did not publish a verified host within its bound. Inspect that build before retrying.'),{code:'macos_build_winner_timeout'});
}
export const macHudIconFiles=['sliders-horizontal-fill','pause-fill','play-fill','stop-fill','x-fill'].map(name=>path.join(root,'server/liquidglass-host/icons',name+'.svg'));
export function macSDKFlags(version){
 if(typeof version!=='string'||!/^\d+\.\d+(?:\.\d+)?$/.test(version)||Number(version.split('.')[0])<14)
  throw Object.assign(Error('A supported macOS SDK version could not be established.'),{code:'macos_sdk_version_invalid'});
 return Number(version.split('.')[0])>=26?['-D','AGCU_MACOS26_SDK']:[];
}
export function copyMacHudIcons(app){
 const directory=path.join(app,'Contents/Resources/Phosphor');fs.mkdirSync(directory,{recursive:true});
 for(const file of macHudIconFiles){if(!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink())throw Error('Invalid Phosphor source asset');fs.copyFileSync(file,path.join(directory,path.basename(file)));}
}
// Publish only complete signed bundles. A competing builder must keep the
// first completed bundle rather than overwrite an executable in use.
export function publishMacBundle(stage,destination,verify){
 if(fs.existsSync(destination)){verify(destination);return false;}
 try{fs.renameSync(stage,destination);return true;}
 catch(error){if(fs.existsSync(destination)){verify(destination);return false;}throw error;}
}
export function macToolProbe(result,label){
  if(result.error?.code==='ETIMEDOUT')throw Object.assign(Error(`macOS ${label} lookup timed out. The tools may still be installed; inspect the runner before retrying.`),{code:'macos_toolchain_probe_timeout'});
  if(result.error)throw Object.assign(Error(`macOS ${label} lookup could not run.`),{code:'macos_toolchain_probe_failed'});
  if(result.status!==0||typeof result.stdout!=='string'||!result.stdout.trim())throw Object.assign(Error(`macOS ${label} lookup failed. Check the Xcode Command Line Tools and selected SDK.`),{code:'macos_toolchain_unavailable'});
  return result.stdout.trim();
}
export function checkMacStorageBuild(result){
  if(result.error?.code==='ETIMEDOUT')throw Object.assign(Error('macOS storage compilation timed out after 120 seconds; inspect the runner and compiler before retrying.'),{code:'macos_storage_build_timeout'});
  if(result.error)throw Object.assign(Error(`macOS storage compiler could not run (${result.error.code||'unknown'}).`),{code:'macos_storage_build_spawn_failed'});
  if(result.status!==0)throw Object.assign(Error(`macOS storage compilation failed (exit ${result.status??'unknown'}, signal ${result.signal||'none'}): ${result.stderr||result.stdout||'no compiler output'}`),{code:'macos_storage_build_failed'});
}
export function buildMacStorage({force=false}={}) {
  if(process.platform!=='darwin')throw Object.assign(Error('The macOS storage adapter must be built on macOS.'),{code:'unsupported_platform'});
  const prebuilt=path.join(root,'bin','StorageGuard');
  const sources=['PrivateStorage.swift','StorageMain.swift'].map(name=>path.join(root,'server/native/macos',name));
  if(!force&&fs.existsSync(prebuilt)&&sources.every(file=>!fs.existsSync(file)))return prebuilt;
  const found=spawnSync('/usr/bin/xcrun',['--find','swiftc'],{encoding:'utf8',timeout:30000});
  const compiler=macToolProbe(found,'compiler');const digest=createHash('sha256');
  const sdkResult=spawnSync('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path'],{encoding:'utf8',timeout:30000});
  const sdk=macToolProbe(sdkResult,'SDK'),target=process.arch==='arm64'?'arm64-apple-macos14.0':'x86_64-apple-macos14.0';
  for(const file of sources)digest.update(fs.readFileSync(file));
  digest.update(compiler+'\0'+sdk+'\0'+target);const dir=path.join(root,'.localdata','mac-storage-bin');
  const output=path.join(dir,'StorageGuard-'+digest.digest('hex').slice(0,16));
  if(!force&&fs.existsSync(output))return output;
  fs.mkdirSync(dir,{recursive:true,mode:0o700});const temporary=output+'-'+randomUUID();
  const build=spawnSync(compiler,['-O','-parse-as-library','-sdk',sdk,'-target',target,'-o',temporary,...sources],{encoding:'utf8',timeout:120000});
  checkMacStorageBuild(build);
  fs.chmodSync(temporary,0o755);fs.renameSync(temporary,output);return output;
}
