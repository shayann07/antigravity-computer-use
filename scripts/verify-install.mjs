import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {launcherSource,controllerStartSource,desktopCommand} from './install.mjs';
import {nativePlatform} from '../server/platform.mjs';
import {storageOperation,defaultInstallationRoot} from '../server/storage.mjs';
import {SIDECAR_ID,sidecarDefinition} from './sidecar.mjs';
const pointer=path.join(os.homedir(),'.gemini/config/skills/computer-use/deployment.json');
const target=path.resolve(process.argv[2]||(fs.existsSync(pointer)?JSON.parse(fs.readFileSync(pointer,'utf8')).target:defaultInstallationRoot({home:os.homedir(),localAppData:process.env.LOCALAPPDATA})));
const platform=nativePlatform();
const install=JSON.parse(fs.readFileSync(path.join(target,'installation.json')));
const manifest=JSON.parse(fs.readFileSync(path.join(install.release,'bundle-manifest.json')));
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
if(install.launcher){
 const workspace=install.workspace?path.resolve(install.workspace):null;
 const scope=workspace?createHash('sha256').update(process.platform==='win32'?workspace.toLowerCase():workspace).digest('hex').slice(0,12):null;
 assert.equal(path.resolve(install.launcher),path.join(target,scope?`cu-${scope}.mjs`:'cu.mjs'));
 assert.equal(fs.readFileSync(install.launcher,'utf8'),launcherSource(install.release),'short launcher differs from installed build pin');
 assert.equal(path.resolve(install.launcher_node),path.join(target,(scope?`cu-${scope}-node`:'cu-node')+(process.platform==='win32'?'.exe':'')));
 assert.equal(sha(install.launcher_node),manifest.files[platform.node],'launcher Node differs from bundled Node');
 if(install.controller_start){assert.equal(path.resolve(install.controller_start),path.join(target,(scope?`Start Computer Use-${scope}`:'Start Computer Use')+(process.platform==='win32'?'.cmd':'.command')));assert.equal(fs.readFileSync(install.controller_start,'utf8'),controllerStartSource(scope));}
}
for(const [file,hash] of Object.entries(manifest.files))assert.equal(sha(path.join(install.release,file)),hash,file+' differs from bundle');
const actual=[];function inventory(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name),name=path.relative(install.release,file).replaceAll('\\','/');assert(!entry.isSymbolicLink(),'Installed payload contains a link: '+name);if(entry.isDirectory())inventory(file);else if(!['bundle-manifest.json','desktop-policy.json'].includes(name))actual.push(name);}}inventory(install.release);assert.deepEqual(actual.sort(),Object.keys(manifest.files).sort(),'Installed payload has missing/unsealed files');
storageOperation('verify-tree',target,{helper:path.join(install.release,'bin',platform.storage)});
const policy=JSON.parse(fs.readFileSync(path.join(install.release,'desktop-policy.json'),'utf8'));assert.equal(policy.permission_mode,install.permission_mode);assert.equal(path.resolve(policy.data_dir),path.join(target,'data'));
if(install.sidecar){assert.deepEqual(JSON.parse(fs.readFileSync(install.sidecar.definition)),sidecarDefinition(path.join(install.release,platform.node),path.join(install.release,'scripts/desktop.mjs')));assert.equal(typeof JSON.parse(fs.readFileSync(install.sidecar.config)).sidecars?.[SIDECAR_ID]?.enabled,'boolean');}
for(const file of install.configs){
 const cfg=JSON.parse(fs.readFileSync(file));
 if(install.integration==='direct')assert(!cfg.mcpServers?.['antigravity-computer-use']);
 else {assert.equal(cfg.mcpServers['antigravity-computer-use'].command,path.join(install.release,platform.node));assert.equal(cfg.mcpServers['antigravity-computer-use'].args[0],path.join(install.release,'server/index.mjs'));}
}
for(const dir of install.skills){
 const template=fs.readFileSync(path.join(install.release,'skills/computer-use/SKILL.md'),'utf8');
 const command=desktopCommand(install.launcher_node||path.join(install.release,platform.node),install.launcher||path.join(install.release,'scripts','desktop.mjs'));
 assert.equal(fs.readFileSync(path.join(dir,'SKILL.md'),'utf8'),template.replaceAll('{{DESKTOP_COMMAND}}',command).replaceAll('{{CONTROLLER_START}}',install.controller_start||''));
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'deployment.json'),'utf8')),{target,release:install.release,workspace:install.workspace,permission_mode:install.permission_mode});
}
console.log(JSON.stringify({verified:true,release:install.release,build_id:manifest.build_id,files:Object.keys(manifest.files).length,skill_matches:true},null,2));
