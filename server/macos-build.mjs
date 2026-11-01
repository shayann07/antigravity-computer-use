// Native adapters only. Tool dispatch, control lifecycle and IPC stay shared.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
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
