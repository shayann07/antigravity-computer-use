import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {ensureHost,SOURCES} from '../server/build.mjs';
import {createHash} from 'node:crypto';
import {ensureStorageGuard} from '../server/storage.mjs';
import {nativePlatform} from '../server/platform.mjs';
const platform=nativePlatform();
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
const nodeLicense=JSON.parse(fs.readFileSync(path.join(root,'licenses','Node-provenance.json'),'utf8'));
if(nodeLicense.version!==process.version)throw new Error('Packaging requires '+nodeLicense.version+' or an updated exact Node license/provenance record.');
const outputIndex=process.argv.indexOf('--output');
if(outputIndex>=0&&!process.argv[outputIndex+1])throw new Error('--output requires a new folder path.');
const out=outputIndex>=0?path.resolve(process.argv[outputIndex+1]):path.join(root,'dist',`AntigravityComputerUse-${process.platform==='darwin'?'macos':'windows'}-${process.arch}`);
if(outputIndex>=0&&fs.existsSync(out)&&fs.readdirSync(out).length)throw new Error('Explicit output must be a fresh empty folder; existing files are preserved.');
// Source-addressed caching already rebuilds changed native sources. Forcing a
// rebuild here discards the qualified binary (legacy csc outputs vary by build).
const host=ensureHost();fs.mkdirSync(path.join(out,'bin'),{recursive:true});
if(process.platform==='darwin')fs.cpSync(path.resolve(host.exe,'../../..'),path.join(out,'bin','AxonHost.app'),{recursive:true});
else fs.copyFileSync(host.exe,path.join(out,'bin',platform.host));
fs.copyFileSync(ensureStorageGuard(),path.join(out,'bin',platform.storage));
fs.copyFileSync(process.execPath,path.join(out,platform.node));
const modules=['index.mjs','desktop-service.mjs','task-ownership.mjs','task-coordinator.mjs','service-lease.mjs','desktop-tools.mjs','receipts.mjs','incidents.mjs','update-core.mjs','storage.mjs','deployment.mjs','mcp.mjs','runtime.mjs','guardian.mjs','driver.mjs','build.mjs','sessions.mjs','policy.mjs','render.mjs','upstream-utils.mjs','version.mjs','platform.mjs','macos-build.mjs','control-contract.json'];
fs.mkdirSync(path.join(out,'server'),{recursive:true});for(const f of modules)fs.copyFileSync(path.join(root,'server',f),path.join(out,'server',f));
fs.copyFileSync(path.join(root,'server/auto-update.mjs'),path.join(out,'server/auto-update.mjs'));
fs.copyFileSync(path.join(root,'server/recovery.mjs'),path.join(out,'server/recovery.mjs'));
fs.copyFileSync(path.join(root,'server/recovery-guide.mjs'),path.join(out,'server/recovery-guide.mjs'));
fs.copyFileSync(path.join(root,'server/update-notice.mjs'),path.join(out,'server/update-notice.mjs'));
fs.copyFileSync(path.join(root,'server/atomic-json.mjs'),path.join(out,'server/atomic-json.mjs'));
if(fs.existsSync(path.join(root,'release-public-key.pem')))fs.copyFileSync(path.join(root,'release-public-key.pem'),path.join(out,'release-public-key.pem'));
for(const folder of ['skills','scripts','licenses'])fs.cpSync(path.join(root,folder),path.join(out,folder),{recursive:true});
for(const f of ['README.md','HANDOFF.md','CONTRIBUTING.md','SECURITY.md','LICENSE','THIRD_PARTY_NOTICES.md','UPSTREAM.json','VALIDATION.md','PROJECT-STATUS.md','IMPLEMENTATION_PROGRESS.md'])if(fs.existsSync(path.join(root,f)))fs.copyFileSync(path.join(root,f),path.join(out,f));
fs.cpSync(path.join(root,'docs'),path.join(out,'docs'),{recursive:true});
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const nativeSource=createHash('sha256');for(const file of SOURCES)nativeSource.update(path.basename(file)+'\0').update(fs.readFileSync(file));
fs.writeFileSync(path.join(out,'bundle-manifest.json'),JSON.stringify({version,platform:process.platform,arch:process.arch,node:process.version,node_sha256:sha(path.join(out,platform.node)),host_sha256:sha(path.join(out,'bin',platform.host)),storage_guard_sha256:sha(path.join(out,'bin',platform.storage)),storage_source_sha256:sha(path.join(root,process.platform==='darwin'?'server/native/macos/PrivateStorage.swift':'server/native/StorageGuard.cs')),native_source_sha256:nativeSource.digest('hex'),license_node_revision:'v24.20.0',built_at:new Date().toISOString(),default_direct_permission_mode:'standalone',permission_modes:['standalone','host-managed'],qualification:process.platform==='darwin'?'experimental-native-adapter-interactive-qualification-pending':'windows-beta'},null,2));
if(process.platform==='win32')fs.writeFileSync(path.join(out,'install.cmd'),'@echo off\r\n"%~dp0node.exe" "%~dp0scripts\\install.mjs" %*\r\n');
else {
 for(const [name,body]of [
  ['install.command','#!/bin/sh\nset -eu\ncd -- "$(dirname -- "$0")"\nexec ./node ./scripts/install.mjs --integration direct --sidecar "$@"\n'],
  ['Setup.Mac.Permissions.command','#!/bin/sh\nset -eu\ncd -- "$(dirname -- "$0")"\nexec /usr/bin/open ./bin/AxonHost.app --args --setup\n']
 ]){fs.writeFileSync(path.join(out,name),body,{mode:0o755});}
 fs.chmodSync(path.join(out,platform.node),0o755);fs.chmodSync(path.join(out,'bin',platform.storage),0o755);
}
// A release pipeline may provide the self-contained, package-backed LiquidGlass
// companion. Source builds omit it and retain the explicit compatibility path.
const liquidGlassHelper=process.env.AGCU_LIQUIDGLASS_HELPER_BUILD;
if(process.platform==='win32'&&liquidGlassHelper&&fs.existsSync(liquidGlassHelper)){
  const destination=path.join(out,'liquidglass');fs.mkdirSync(destination,{recursive:true});
  for(const name of ['LiquidGlass.Host.exe','libSkiaSharp.dll']){
    const source=path.join(liquidGlassHelper,name);if(!fs.existsSync(source))throw new Error('LiquidGlass helper is missing '+name);
    fs.copyFileSync(source,path.join(destination,name));
  }
}
console.log(out);
const files={};
function inventory(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())inventory(p);else if(path.relative(out,p)!=='bundle-manifest.json')files[path.relative(out,p).replaceAll('\\','/')]=sha(p);}}
inventory(out);
const manifestPath=path.join(out,'bundle-manifest.json');const manifest=JSON.parse(fs.readFileSync(manifestPath));
manifest.files=files;manifest.build_id=createHash('sha256').update(JSON.stringify(files)).digest('hex');
fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
