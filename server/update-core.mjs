// Signed metadata is mandatory. No unsigned GitHub release or branch is executable policy.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {verify,createHash} from 'node:crypto';
export const sha256=data=>createHash('sha256').update(data).digest('hex');
export function verifyRelease(bytes,signature,publicKey,{platform=process.platform,arch=process.arch,osRelease=os.release(),channel='stable',now=Date.now()}={}){
 if(!publicKey||!verify(null,bytes,publicKey,Buffer.from(signature,'base64')))throw Error('release_signature_invalid');
 const m=JSON.parse(bytes);
 if(!/^[a-f0-9]{64}$/.test(m.build_id||''))throw Error('release_build_invalid');
 if(m.schema!==1||m.platform!==platform||m.arch!==arch)throw Error('release_platform_mismatch');
 if(!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(m.version)||channel==='stable'&&m.version.includes('-'))throw Error('release_channel_mismatch');
 if(!Number.isSafeInteger(m.sequence)||m.sequence<1||!Number.isFinite(Date.parse(m.expires))||Date.parse(m.expires)<=now)throw Error('release_metadata_expired');
 const parts=v=>typeof v==='string'&&/^\d+\.\d+\.\d+$/.test(v)?v.split('.').map(Number):[];
 const a=parts(osRelease),b=parts(m.min_os);if(b.length!==3||b.some(n=>!Number.isSafeInteger(n)||n<0))throw Error('release_os_invalid');
 if(a.length!==3||a.some(n=>!Number.isSafeInteger(n)||n<0))throw Error('current_os_unknown');
 for(let i=0;i<3;i++){if(a[i]>b[i])break;if(a[i]<b[i])throw Error('release_os_incompatible');}
 if(!m.files||!Object.keys(m.files).length||Object.keys(m.files).length>500)throw Error('release_inventory_invalid');
 let total=0;for(const [name,f]of Object.entries(m.files)){
  if(!name||name.includes('\\')||name.includes(':')||name.split('/').some(p=>!p||p==='.'||p==='..')||name.startsWith('/')||!/^[a-f0-9]{64}$/.test(f.sha256)||!Number.isSafeInteger(f.size)||f.size<0||f.size>150*1024*1024)throw Error('release_inventory_invalid');
  const url=new URL(f.url);if(url.protocol!=='https:'||url.hostname!=='github.com'||!url.pathname.startsWith('/shayann07/antigravity-computer-use/releases/download/'))throw Error('release_origin_invalid');total+=f.size;
 }if(total>400*1024*1024)throw Error('release_size_limit');return m;
}
export function updateSettings(target,version='0.0.0'){
 const file=path.join(target,'update-settings.json');if(!fs.existsSync(file))return {mode:'automatic',channel:version.includes('-')?'beta':'stable',reporting:false};
 const v=JSON.parse(fs.readFileSync(file));if(!['automatic','notify','manual'].includes(v.mode)||!['stable','beta'].includes(v.channel)||typeof v.reporting!=='boolean')throw Error('invalid_update_settings');return {mode:v.mode,channel:v.channel,reporting:v.reporting};
}
export function deploymentPinned(scope,global){
 if(typeof scope?.update_pin==='boolean')return scope.update_pin;
 // Older project pointers were immutable pins before an update preference
 // existed. Do not silently enrol a divergent legacy scope in global updates.
 return !!scope?.workspace&&!!global&&scope.release!==global.release;
}
// A correctly signed inventory can still describe an accidentally incomplete
// release. Refuse it before reserving or shutting down the current controller.
export function verifyUpdateBundle(directory,m,{node,host,storage}={}){
 const bundle=JSON.parse(fs.readFileSync(path.join(directory,'bundle-manifest.json')));
 if(bundle.build_id!==m.build_id||bundle.version!==m.version||bundle.platform!==m.platform||bundle.arch!==m.arch)throw Error('update_bundle_identity_mismatch');
 const required=[node,'bin/'+host,'bin/'+storage,'skills/computer-use/SKILL.md',
  ...'index desktop-service service-lease desktop-tools receipts incidents update-core storage deployment mcp runtime guardian driver build sessions policy render upstream-utils version platform macos-build auto-update recovery update-notice atomic-json'.split(' ').map(name=>'server/'+name+'.mjs'),
  'server/control-contract.json','scripts/desktop.mjs','scripts/arguments.mjs','scripts/diagnostics.mjs','scripts/install.mjs','scripts/update.mjs','scripts/rollback.mjs','scripts/sidecar.mjs','release-public-key.pem',
  ...(m.platform==='win32'?['install.cmd']:['install.command','Setup.Mac.Permissions.command'])];
 // Windows releases from beta.4 onward promise the package-backed HUD. An
 // otherwise signed but incomplete bundle must not silently drop that helper.
 if(m.platform==='win32'&&(m.version==='0.3.0-beta.4'||newerVersion(m.version,'0.3.0-beta.4')))
  required.push('liquidglass/LiquidGlass.Host.exe','liquidglass/libSkiaSharp.dll');
 if(!bundle.files||typeof bundle.files!=='object'||Array.isArray(bundle.files)||required.some(name=>!Object.hasOwn(bundle.files,name)))throw Error('update_bundle_incomplete');
 const names=Object.keys(bundle.files),signed=Object.keys(m.files).filter(name=>name!=='bundle-manifest.json');
 if(names.length!==signed.length||names.some(name=>!Object.hasOwn(m.files,name)||bundle.files[name]!==m.files[name].sha256))throw Error('update_bundle_inventory_mismatch');
 if(sha256(JSON.stringify(bundle.files))!==bundle.build_id)throw Error('update_bundle_identity_mismatch');
}
export function acquireUpdateLock(target){const file=path.join(target,'update.lock');const fd=fs.openSync(file,'wx',0o600);fs.writeFileSync(fd,JSON.stringify({pid:process.pid,at:new Date().toISOString()}));return ()=>{fs.closeSync(fd);fs.unlinkSync(file);};}
export function verifyStaged(directory,m){
 const actual=[];const walk=folder=>{for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.isSymbolicLink())throw Error('release_payload_link');if(entry.isDirectory())walk(file);else if(entry.isFile())actual.push(path.relative(directory,file).replaceAll('\\','/'));else throw Error('release_payload_invalid');}};
 if(!fs.lstatSync(directory).isDirectory()||fs.lstatSync(directory).isSymbolicLink())throw Error('release_payload_link');walk(directory);
 if(actual.length!==Object.keys(m.files).length||actual.some(name=>!Object.hasOwn(m.files,name)))throw Error('release_payload_inventory');
 for(const [name,f]of Object.entries(m.files)){const file=path.join(directory,name);const s=fs.lstatSync(file);if(s.size!==f.size||sha256(fs.readFileSync(file))!==f.sha256)throw Error('release_payload_mismatch');}
}
export function newerVersion(candidate,current){
 const parse=v=>{const match=/^(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?$/.exec(v);if(!match)throw Error('release_version_invalid');return match.slice(1);};
 const a=parse(candidate),b=parse(current);for(let i=0;i<3;i++){if(Number(a[i])!==Number(b[i]))return Number(a[i])>Number(b[i]);}
 if(!a[3])return !!b[3];if(!b[3])return false;
 const x=a[3].split('.'),y=b[3].split('.');for(let i=0;i<Math.max(x.length,y.length);i++){if(x[i]===y[i])continue;if(x[i]===undefined)return false;if(y[i]===undefined)return true;const numeric=v=>/^\d+$/.test(v);if(numeric(x[i])&&numeric(y[i]))return Number(x[i])>Number(y[i]);if(numeric(x[i])!==numeric(y[i]))return !numeric(x[i]);return x[i]>y[i];}return false;
}
export async function downloadFile(url,destination,{size,hash,fetcher=fetch,io=fs}={}){
 const reply=await fetcher(url,{signal:AbortSignal.timeout(30000)});if(!reply.ok||!reply.body)throw Error('update_download_failed');
 const fd=io.openSync(destination+'.part','wx',0o600);let length=0;const digest=createHash('sha256');
 try{for await(const chunk of reply.body){length+=chunk.length;if(length>size)throw Error('update_download_size');digest.update(chunk);let offset=0;while(offset<chunk.length){const written=io.writeSync(fd,chunk,offset,chunk.length-offset);if(!Number.isInteger(written)||written<=0||written>chunk.length-offset)throw Error('update_download_write_failed');offset+=written;}}if(length!==size||digest.digest('hex')!==hash)throw Error('update_download_hash');io.closeSync(fd);io.renameSync(destination+'.part',destination);}
 catch(e){try{io.closeSync(fd);}catch{}try{io.unlinkSync(destination+'.part');}catch{}throw e;}
}
export async function readBoundedJSON(reply,maxBytes=262144){
 if(!reply.ok)throw Error('update_metadata_unavailable');
 const declared=reply.headers?.get('content-length');if(declared&&Number(declared)>maxBytes)throw Error('update_metadata_size');
 // Streaming prevents an oversized metadata body from being buffered first.
 if(reply.body){const chunks=[];let length=0;for await(const chunk of reply.body){length+=chunk.length;if(length>maxBytes)throw Error('update_metadata_size');chunks.push(Buffer.from(chunk));}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
 // Inert test transports may expose only text/json; real fetch always has body.
 if(typeof reply.text!=='function'&&typeof reply.json==='function'){
  const value=await reply.json();if(Buffer.byteLength(JSON.stringify(value))>maxBytes)throw Error('update_metadata_size');return value;
 }
 const text=await reply.text();if(Buffer.byteLength(text)>maxBytes)throw Error('update_metadata_size');return JSON.parse(text);
}
