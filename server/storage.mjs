// Windows ACLs are checked by a small prebuilt .NET helper, not POSIX mode bits.
// It has no desktop/input API and never elevates or changes parent permissions.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';import {spawnSync,execFile} from 'node:child_process';import {promisify} from 'node:util';
import {buildMacStorage} from './macos-build.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function ensureStorageGuard(){
 if(process.platform==='darwin')return buildMacStorage();
 if(process.platform!=='win32')throw Object.assign(Error('Private Windows storage requires Windows.'),{code:'unsupported_platform'});
 const prebuilt=path.join(root,'bin/StorageGuard.exe'),source=path.join(root,'server/native/StorageGuard.cs');
 if(fs.existsSync(prebuilt)&&!fs.existsSync(source))return prebuilt;
 const compiler=path.join(process.env.WINDIR||'C:/Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe');
 const stamp=createHash('sha256').update(fs.readFileSync(source)).update(compiler).digest('hex').slice(0,16);
 const cache=path.join(root,'.localdata/storage-bin'),exe=path.join(cache,'StorageGuard-'+stamp+'.exe');
 if(!fs.existsSync(exe)){
  fs.mkdirSync(cache,{recursive:true});
  const temporary=path.join(cache,'StorageGuard-'+stamp+'-'+process.pid+'-'+randomUUID()+'.exe');
  const result=spawnSync(compiler,['-nologo','-target:exe','-r:System.Web.Extensions.dll','-out:'+temporary,source],{windowsHide:true,encoding:'utf8',timeout:30000});
  if(result.status!==0)throw Object.assign(Error('Storage helper compilation failed: '+(result.stdout||result.stderr||result.error?.message)),{code:'storage_build_failed'});
  try{fs.linkSync(temporary,exe);}catch(error){if(error.code!=='EEXIST')throw error;}
  fs.unlinkSync(temporary);
 }
 return exe;
}
export function storageOperation(mode,directory,{helper=ensureStorageGuard()}={}){
 const result=spawnSync(helper,[mode,path.resolve(directory)],{windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
 let reply;try{reply=JSON.parse(result.stdout);}catch{}
 if(result.status!==0||!reply?.ok)throw Object.assign(Error(reply?.error?.message||result.error?.message||'Private storage verification failed.'),{code:reply?.error?.code||'storage_permissions_failed',path:reply?.error?.path});
 return reply;
}
const execFileAsync=promisify(execFile);
export async function storageOperationAsync(mode,directory,{helper=ensureStorageGuard()}={}){
 let stdout='',failure;try{({stdout}=await execFileAsync(helper,[mode,path.resolve(directory)],{windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:1024*1024}));}catch(error){failure=error;stdout=error.stdout||'';}
 let reply;try{reply=JSON.parse(stdout);}catch{}
 if(failure||!reply?.ok)throw Object.assign(Error(reply?.error?.message||failure?.message||'Private storage verification failed.'),{code:reply?.error?.code||'storage_permissions_failed',path:reply?.error?.path});
 return reply;
}
export function defaultInstallationRoot({helper,home,localAppData,hasD=fs.existsSync('D:\\')}={}){
 if(process.platform==='darwin')return path.join(home,'Library','Application Support','AntigravityComputerUse');
 const result=spawnSync(helper||ensureStorageGuard(),['identity'],{windowsHide:true,encoding:'utf8',timeout:10000});
 let identity;try{identity=JSON.parse(result.stdout);}catch{}
 if(result.status!==0||!identity?.owner_sid)throw Error('Cannot determine the Windows installation owner.');
 const suffix=createHash('sha256').update(identity.owner_sid).digest('hex').slice(0,10);
 return hasD?path.join('D:\\','Apps','AntigravityComputerUse',suffix):path.join(localAppData||home,'AntigravityComputerUse');
}
