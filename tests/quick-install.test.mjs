import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {testDirectory} from './paths.mjs';import {quickInstall,verifyPayload} from '../scripts/quick-install.mjs';import {launcherSource} from '../scripts/install.mjs';import {mergeSidecarConfig,sidecarDefinition} from '../scripts/sidecar.mjs';
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function fixture(){
 const dir=fs.mkdtempSync(path.join(testDirectory('quick-install'),'case-')),bundle=path.join(dir,'bundle'),root=path.join(dir,'installed'),home=path.join(dir,'home');
 const payload={'node.exe':'inert node','bin/StorageGuard.exe':'inert guard','scripts/install.mjs':'inert installer','skills/computer-use/SKILL.md':'Run {{DESKTOP_COMMAND}}. Starter {{CONTROLLER_START}}.'};
 for(const [name,body]of Object.entries(payload)){const file=path.join(bundle,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,body);}
 const manifest={version:'9.0.0-test',build_id:'fixture-build',files:Object.fromEntries(Object.keys(payload).map(name=>[name,sha(path.join(bundle,name))]))};fs.writeFileSync(path.join(bundle,'bundle-manifest.json'),JSON.stringify(manifest));
 let installations=0,verified=0;
 const dependencies={launcherSource,mergeSidecarConfig,sidecarDefinition,storageOperation(){verified++;},install(options){installations++;return {target:options.target||root,options};}};
 function installed(){const release=path.join(root,'releases','one');fs.mkdirSync(path.dirname(release),{recursive:true});fs.cpSync(bundle,release,{recursive:true});
  fs.mkdirSync(path.join(root,'data'));fs.writeFileSync(path.join(root,'data/emergency.stop'),'owner-stop');
  fs.writeFileSync(path.join(release,'desktop-policy.json'),JSON.stringify({permission_mode:'host-managed',data_dir:path.join(root,'data'),idle_policy:'release'}));
  fs.writeFileSync(path.join(root,'deployments.json'),JSON.stringify({global:{release,sidecar:true,integration:'direct'}}));
  fs.writeFileSync(path.join(root,'cu.mjs'),launcherSource(release));fs.copyFileSync(path.join(bundle,'node.exe'),path.join(root,'cu-node.exe'));
  const skill=path.join(home,'.gemini/config/skills/computer-use');fs.mkdirSync(skill,{recursive:true});fs.writeFileSync(path.join(skill,'deployment.json'),JSON.stringify({target:root,release,permission_mode:'host-managed',workspace:null}));
  const node=path.join(root,'cu-node.exe'),launcher=path.join(root,'cu.mjs'),command=`& '${node.replaceAll("'","''")}' '${launcher.replaceAll("'","''")}'`;
  fs.writeFileSync(path.join(skill,'SKILL.md'),payload['skills/computer-use/SKILL.md'].replaceAll('{{DESKTOP_COMMAND}}',command).replaceAll('{{CONTROLLER_START}}',path.join(root,'Start Computer Use.cmd')));
  const config=path.join(home,'.gemini/config/config.json');fs.writeFileSync(config,JSON.stringify({model:'keep',permissions:{preset:'unchanged'},sidecars:{other:{enabled:true},'antigravity-computer-use':{enabled:false,projectId:'keep'}}}));return {release,config};
 }
 return {dir,bundle,root,home,manifest,dependencies,installed,counts:()=>({installations,verified})};
}
test('quick fresh integration delegates to the existing installer with direct global Sidecar enabled',async()=>{
 const f=fixture();try{const r=await quickInstall({bundle:f.bundle,home:f.home,dependencies:f.dependencies});assert.equal(r.already_installed,false);assert.equal(r.options.integration,'direct');assert.equal(r.options.sidecar,true);assert.equal(r.options.permissionMode,undefined);assert.equal(f.counts().installations,1);}finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('same-build integration re-enables the Sidecar without shutting down or reinstalling a live runtime',async()=>{
 const f=fixture();try{const {config}=f.installed();fs.writeFileSync(path.join(f.root,'data/desktop-session.json'),JSON.stringify({pid:process.pid}));const r=await quickInstall({bundle:f.bundle,home:f.home,dependencies:f.dependencies});assert.equal(r.already_installed,true);assert.equal(f.counts().installations,0);assert.equal(f.counts().verified,1);const c=JSON.parse(fs.readFileSync(config));assert.equal(c.sidecars['antigravity-computer-use'].enabled,true);assert.equal(c.sidecars['antigravity-computer-use'].projectId,'keep');assert.deepEqual(c.permissions,{preset:'unchanged'});assert.equal(c.model,'keep');assert.equal(c.sidecars.other.enabled,true);assert.equal(fs.readFileSync(path.join(f.root,'data/emergency.stop'),'utf8'),'owner-stop');assert(fs.existsSync(path.join(f.root,'data/desktop-session.json')));assert(r.backup);assert.equal(JSON.parse(fs.readFileSync(path.join(r.backup,'sidecar-backup.json'))).records.length,2);const again=await quickInstall({bundle:f.bundle,home:f.home,dependencies:f.dependencies});assert.equal(again.backup,undefined);}finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('quick integration refuses corrupt existing bytes even if the existing manifest is edited to match',async()=>{
 const f=fixture();try{const {release}=f.installed();fs.writeFileSync(path.join(release,'node.exe'),'changed');const altered=structuredClone(f.manifest);altered.files['node.exe']=sha(path.join(release,'node.exe'));fs.writeFileSync(path.join(release,'bundle-manifest.json'),JSON.stringify(altered));await assert.rejects(quickInstall({bundle:f.bundle,home:f.home,dependencies:f.dependencies}),/integrity check failed/);assert.equal(f.counts().installations,0);}finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('portable payload inventory rejects extra files, links and path traversal before importing code',async()=>{
 const f=fixture();try{fs.writeFileSync(path.join(f.bundle,'extra.mjs'),'unsealed');await assert.rejects(quickInstall({bundle:f.bundle,home:f.home,dependencies:f.dependencies}),/inventory/);assert.equal(f.counts().installations,0);fs.unlinkSync(path.join(f.bundle,'extra.mjs'));const invalid=structuredClone(f.manifest);invalid.files['../escape']='0'.repeat(64);assert.throws(()=>verifyPayload(f.bundle,invalid));}finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('a changed installation permission policy uses the normal installer rather than mutating a live policy',async()=>{
 const f=fixture();try{const {release}=f.installed();const original=fs.readFileSync(path.join(release,'desktop-policy.json'),'utf8');const r=await quickInstall({bundle:f.bundle,home:f.home,permissionMode:'standalone',dependencies:f.dependencies});assert.equal(r.already_installed,false);assert.equal(r.options.permissionMode,'standalone');assert.equal(fs.readFileSync(path.join(release,'desktop-policy.json'),'utf8'),original);}finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
for(const blocked of ['definition','enable flag'])test(`a failed same-build repair never leaves the Sidecar enabled without its definition: ${blocked} write fails (#139)`,async()=>{
 const f=fixture();try{const {config}=f.installed();const before=fs.readFileSync(config,'utf8');
  const definition=path.join(path.dirname(config),'sidecars/antigravity-computer-use/sidecar.json');
  fs.mkdirSync((blocked==='definition'?definition:config)+'.agcu.tmp',{recursive:true});
  await assert.rejects(quickInstall({bundle:f.bundle,home:f.home,dependencies:f.dependencies}));
  assert.equal(fs.readFileSync(config,'utf8'),before,'the enable flag is unchanged');
  assert.equal(fs.existsSync(definition),false,'no definition is left behind');
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
