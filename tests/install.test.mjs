import {testDirectory} from './paths.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {mergeConfig,install as productionInstall} from '../scripts/install.mjs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {nativePlatform} from '../server/platform.mjs';
import {storageOperation} from '../server/storage.mjs';
import {rollbackGuarded} from '../scripts/rollback.mjs';
const platform=nativePlatform();
const root=testDirectory('test-install');fs.mkdirSync(root,{recursive:true});
// Fixture profiles must never discover or alter the developer's real install.
const install=options=>productionInstall({home:path.join(options.target,'inert-home'),...options,prepareStorage(){return {private_storage:true,test_fixture:true};}});
function seal(bundle,version='9.1.2-test'){
 const storage=path.join(bundle,'bin',platform.storage);
 if(!fs.existsSync(storage)){fs.mkdirSync(path.dirname(storage),{recursive:true});fs.writeFileSync(storage,'inert ACL fixture; never executed');}
 const files={};const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name),name=path.relative(bundle,file).replaceAll('\\','/');if(entry.isDirectory())walk(file);else if(name!=='bundle-manifest.json')files[name]=createHash('sha256').update(fs.readFileSync(file)).digest('hex');}};walk(bundle);
 fs.writeFileSync(path.join(bundle,'bundle-manifest.json'),JSON.stringify({version,files,platform:process.platform,arch:process.arch}));
}
function writeFixture(bundle,content='fixture'){
 fs.mkdirSync(path.join(bundle,'bin'),{recursive:true});
 fs.writeFileSync(path.join(bundle,platform.node),content);
 const host=path.join(bundle,'bin',platform.host);
 fs.mkdirSync(path.dirname(host),{recursive:true});
 fs.writeFileSync(host,content);
}
function prepareFixtureData(dir){fs.mkdirSync(dir,{recursive:true});if(process.platform==='darwin')storageOperation('data',dir);}
test('direct installation removes only its legacy MCP entry and pins the script runtime',()=>{
 const dir=fs.mkdtempSync(path.join(root,'direct-')),bundle=path.join(dir,'bundle'),target=path.join(dir,'installed'),workspace=path.join(dir,'project');
 fs.mkdirSync(path.join(bundle,'skills/computer-use'),{recursive:true});
 writeFixture(bundle);
 fs.writeFileSync(path.join(bundle,'skills/computer-use/SKILL.md'),'Use {{DESKTOP_COMMAND}} start');
 seal(bundle);
 const cfg=path.join(workspace,'.agents/mcp_config.json');fs.mkdirSync(path.dirname(cfg),{recursive:true});fs.writeFileSync(cfg,JSON.stringify({custom:8,mcpServers:{'antigravity-computer-use':{command:'old'},keep:{command:'keep'}}}));
 const result=install({bundle,target,workspace,permissionMode:'host-managed'});const current=JSON.parse(fs.readFileSync(cfg));
 assert.equal(current.custom,8);assert.equal(current.mcpServers.keep.command,'keep');assert(!current.mcpServers['antigravity-computer-use']);
 assert.equal(JSON.parse(fs.readFileSync(path.join(result.release,'desktop-policy.json'))).permission_mode,'host-managed');
 assert(fs.readFileSync(path.join(result.skills[0],'SKILL.md'),'utf8').includes(result.launcher));
 assert(fs.readFileSync(result.launcher,'utf8').includes(pathToFileURL(path.join(result.release,'scripts','desktop.mjs')).href));
 const rollback=spawnSync(process.execPath,['scripts/rollback.mjs',path.join(result.backup,'rollback.json')],{windowsHide:true,encoding:'utf8'});assert.equal(rollback.status,0,rollback.stderr);
 assert.equal(JSON.parse(fs.readFileSync(cfg)).mcpServers['antigravity-computer-use'].command,'old');
 assert(!fs.existsSync(result.launcher));
 assert(!fs.existsSync(result.controller_start),'Rollback removes the newly introduced human starter');
});
test('configuration merge preserves unrelated servers/settings',()=>{
 const f=path.join(root,'merge.json');fs.writeFileSync(f,JSON.stringify({custom:7,mcpServers:{keep:{command:'keep'}}}));
 const c=JSON.parse(mergeConfig(f,{command:'native'}));assert.equal(c.custom,7);assert.equal(c.mcpServers.keep.command,'keep');assert.equal(c.mcpServers['antigravity-computer-use'].command,'native');
});
test('configuration merge handles empty 0-byte configuration files without crashing',()=>{
 const f=path.join(root,'empty.json');fs.writeFileSync(f,'');
 const c=JSON.parse(mergeConfig(f,{command:'native'}));assert.equal(c.mcpServers['antigravity-computer-use'].command,'native');
});

test('opt-in global sidecar pins the direct controller and rollback preserves later unrelated configuration',()=>{
 const dir=fs.mkdtempSync(path.join(root,'sidecar-')),bundle=path.join(dir,'bundle'),target=path.join(dir,'installed'),home=path.join(dir,'home');
 fs.mkdirSync(path.join(bundle,'skills/computer-use'),{recursive:true});
 writeFixture(bundle);fs.writeFileSync(path.join(bundle,'skills/computer-use/SKILL.md'),'{{CONTROLLER_START}}');seal(bundle);
 const config=path.join(home,'.gemini/config/config.json');fs.mkdirSync(path.dirname(config),{recursive:true});fs.writeFileSync(config,JSON.stringify({permissions:{preset:'unchanged'},sidecars:{other:{enabled:true}}}));
 const first=install({bundle,target,home,sidecar:true});const definition=JSON.parse(fs.readFileSync(first.sidecar.definition));assert.equal(definition.command,path.join(first.release,platform.node));assert.deepEqual(definition.args,[path.join(first.release,'scripts/desktop.mjs'),'serve']);assert(!definition.env);assert.equal(JSON.parse(fs.readFileSync(path.join(first.release,'desktop-policy.json'))).idle_policy,'release');
 const project=install({bundle,target,home,workspace:path.join(dir,'project')});assert.equal(project.sidecar,null);assert.equal(JSON.parse(fs.readFileSync(path.join(project.release,'desktop-policy.json'))).idle_policy,'release');assert.deepEqual(JSON.parse(fs.readFileSync(first.sidecar.definition)),definition);
 const c=JSON.parse(fs.readFileSync(config));assert.equal(c.sidecars['antigravity-computer-use'].enabled,true);c.sidecars['antigravity-computer-use'].enabled=false;fs.writeFileSync(config,JSON.stringify(c));
 const update=install({bundle,target,home});assert.equal(JSON.parse(fs.readFileSync(config)).sidecars['antigravity-computer-use'].enabled,false);assert.equal(JSON.parse(fs.readFileSync(update.sidecar.definition)).command,path.join(update.release,platform.node));assert.notEqual(JSON.parse(fs.readFileSync(update.sidecar.definition)).command,definition.command);
 const later=JSON.parse(fs.readFileSync(config));later.sidecars.later={enabled:true};later.unrelated_after=true;fs.writeFileSync(config,JSON.stringify(later));
 const rolled=spawnSync(process.execPath,['scripts/rollback.mjs',path.join(first.backup,'rollback.json')],{windowsHide:true,encoding:'utf8'});assert.equal(rolled.status,0,rolled.stderr);
 const restored=JSON.parse(fs.readFileSync(config));assert(!restored.sidecars['antigravity-computer-use']);assert(restored.sidecars.other.enabled);assert(restored.sidecars.later.enabled);assert(restored.unrelated_after);assert.equal(restored.permissions.preset,'unchanged');assert(!fs.existsSync(first.sidecar.definition));
});
test('invalid configuration is untouched',()=>{const f=path.join(root,'invalid.json');fs.writeFileSync(f,'{broken');assert.throws(()=>mergeConfig(f,{}));assert.equal(fs.readFileSync(f,'utf8'),'{broken');});
test('project-local installation and update rollback preserve later unrelated changes',()=>{
 const dir=fs.mkdtempSync(path.join(root,'workspace-')),bundle=path.join(dir,'bundle'),target=path.join(dir,'installed'),workspace=path.join(dir,'project');
 fs.mkdirSync(path.join(bundle,'skills','computer-use'),{recursive:true});writeFixture(bundle);fs.writeFileSync(path.join(bundle,'skills/computer-use/SKILL.md'),'v1');
 seal(bundle);
 const first=install({bundle,target,workspace,integration:'mcp'});const cfg=first.configs[0];assert.equal(cfg,path.join(workspace,'.agents/mcp_config.json'));assert.equal(first.skills[0],path.join(workspace,'.agents/skills/computer-use'));
 const oldLauncher=fs.readFileSync(first.launcher,'utf8');
 fs.writeFileSync(path.join(bundle,'skills/computer-use/SKILL.md'),'v2');seal(bundle);const second=install({bundle,target,workspace,integration:'mcp'});assert.notEqual(first.release,second.release);
 const state=JSON.parse(fs.readFileSync(cfg));state.mcpServers.unrelated={command:'keep'};fs.writeFileSync(cfg,JSON.stringify(state));
 const rollback=spawnSync(process.execPath,['scripts/rollback.mjs',path.join(second.backup,'rollback.json')],{windowsHide:true,encoding:'utf8'});assert.equal(rollback.status,0,rollback.stderr);
 const restored=JSON.parse(fs.readFileSync(cfg));assert.equal(restored.mcpServers.unrelated.command,'keep');assert.equal(restored.mcpServers['antigravity-computer-use'].command,path.join(first.release,platform.node));assert.equal(fs.readFileSync(path.join(first.skills[0],'SKILL.md'),'utf8'),'v1');
 assert.equal(fs.readFileSync(first.launcher,'utf8'),oldLauncher);
});
test('installer copies prebuilt runtime, backs up exact config and registers global skill',()=>{
 const dir=fs.mkdtempSync(path.join(root,'case-'));const bundle=path.join(dir,'bundle'),home=path.join(dir,'home'),target=path.join(dir,'installed');
 fs.mkdirSync(path.join(bundle,'skills','computer-use'),{recursive:true});
 writeFixture(bundle);fs.writeFileSync(path.join(bundle,'skills','computer-use','SKILL.md'),'fixture skill');
 seal(bundle);
 const cfg=path.join(home,'.gemini','config','mcp_config.json');fs.mkdirSync(path.dirname(cfg),{recursive:true});const original='{"mcpServers":{"keep":{"command":"keep"}},"custom":8}';fs.writeFileSync(cfg,original);
 const result=install({bundle,home,target,integration:'mcp'});const manifest=JSON.parse(fs.readFileSync(path.join(result.backup,'rollback.json')));
 assert(path.basename(result.release).startsWith('9.1.2-test-'));
 assert.equal(result.configs.length,1);assert.equal(result.skills.length,1);
 assert.equal(JSON.parse(fs.readFileSync(cfg)).mcpServers['antigravity-computer-use'].env.AGCU_PERMISSION_MODE,'host-managed');
 assert.equal(fs.readFileSync(manifest.records[0].saved,'utf8'),original);assert.equal(JSON.parse(fs.readFileSync(cfg)).custom,8);assert(fs.existsSync(path.join(result.skills[0],'SKILL.md')));assert(fs.existsSync(path.join(result.release,platform.node)));
 const modified=JSON.parse(fs.readFileSync(cfg));modified.added_after_install=true;modified.mcpServers.later={command:'preserve-me'};fs.writeFileSync(cfg,JSON.stringify(modified));
 const rolled=spawnSync(process.execPath,['scripts/rollback.mjs',path.join(result.backup,'rollback.json')],{windowsHide:true,encoding:'utf8'});assert.equal(rolled.status,0,rolled.stderr);
 const restored=JSON.parse(fs.readFileSync(cfg));assert.equal(restored.mcpServers.keep.command,'keep');assert.equal(restored.mcpServers.later.command,'preserve-me');assert(restored.added_after_install);assert(!restored.mcpServers['antigravity-computer-use']);
});

test('corrupt portable executable is refused before configuration or installation writes',()=>{
 const dir=fs.mkdtempSync(path.join(root,'corrupt-')),bundle=path.join(dir,'bundle'),target=path.join(dir,'installed'),home=path.join(dir,'home');
 fs.mkdirSync(path.join(bundle,'skills/computer-use'),{recursive:true});
 writeFixture(bundle,'original');fs.writeFileSync(path.join(bundle,'skills/computer-use/SKILL.md'),'skill');seal(bundle);
 const cfg=path.join(home,'.gemini/config/mcp_config.json');fs.mkdirSync(path.dirname(cfg),{recursive:true});const original='{"custom":true}';fs.writeFileSync(cfg,original);
 fs.writeFileSync(path.join(bundle,platform.node),'changed');
 assert.throws(()=>install({bundle,target,home}),/integrity check failed/);assert.equal(fs.readFileSync(cfg,'utf8'),original);assert(!fs.existsSync(target));
});

test('project-local launcher update does not redirect the global skill runtime',()=>{
 const dir=fs.mkdtempSync(path.join(root,'scopes-')),bundle=path.join(dir,'bundle'),target=path.join(dir,'installed'),home=path.join(dir,'home'),workspace=path.join(dir,'project');
 fs.mkdirSync(path.join(bundle,'skills/computer-use'),{recursive:true});
 writeFixture(bundle);fs.writeFileSync(path.join(bundle,'skills/computer-use/SKILL.md'),'Use {{DESKTOP_COMMAND}}');seal(bundle);
 const global=install({bundle,target,home});const globalLauncher=fs.readFileSync(global.launcher,'utf8'),globalSkill=fs.readFileSync(path.join(global.skills[0],'SKILL.md'),'utf8');
 fs.writeFileSync(path.join(bundle,platform.node),'different project runtime');seal(bundle,'9.1.3-test');
 const project=install({bundle,target,home,workspace});assert.notEqual(project.launcher,global.launcher);
 assert.equal(fs.readFileSync(global.launcher,'utf8'),globalLauncher);assert.equal(fs.readFileSync(path.join(global.skills[0],'SKILL.md'),'utf8'),globalSkill);
 assert(fs.readFileSync(project.launcher,'utf8').includes(pathToFileURL(path.join(project.release,'scripts','desktop.mjs')).href));
});

test('short launcher forwards literal argv without a command shell or character expansion',()=>{
 const dir=fs.mkdtempSync(path.join(root,'argv-')),bundle=path.join(dir,'bundle'),target=path.join(dir,"installed space & 100% ' اردو");
 fs.mkdirSync(path.join(bundle,'skills/computer-use'),{recursive:true});fs.mkdirSync(path.join(bundle,'scripts'),{recursive:true});
 fs.mkdirSync(path.join(bundle,'bin'),{recursive:true});fs.copyFileSync(process.execPath,path.join(bundle,platform.node));
 const host=path.join(bundle,'bin',platform.host);fs.mkdirSync(path.dirname(host),{recursive:true});fs.writeFileSync(host,'fixture');
 fs.writeFileSync(path.join(bundle,'skills/computer-use/SKILL.md'),'{{DESKTOP_COMMAND}}');
 // This module is only an argv oracle: it has no desktop/native dependencies.
 fs.writeFileSync(path.join(bundle,'scripts/desktop.mjs'),'export const encodeReply=JSON.stringify;export const recordedFailureReply=async e=>({ok:false,error:{message:e.message}});export async function main(){if(process.argv[2]==="fail")throw Error("fixture failure");console.log(JSON.stringify(process.argv.slice(2)));}');seal(bundle);
 const result=install({bundle,target,home:path.join(dir,'home')});
 const words=['paste','--text','اردو 😀 %PATH% & x|y > z ^ !', '--reason','literal "quotes" and \\slashes'];
 const run=spawnSync(result.launcher_node,[result.launcher,...words],{windowsHide:true,encoding:'utf8'});assert.equal(run.status,0,run.stderr);assert.deepEqual(JSON.parse(run.stdout),words);
 const failed=spawnSync(result.launcher_node,[result.launcher,'fail'],{windowsHide:true,encoding:'utf8'});assert.equal(failed.status,1,failed.stderr);assert.deepEqual(JSON.parse(failed.stdout),{ok:false,error:{message:'fixture failure'}});
 // This one fixture contains full Node executable copies. Keep it on failure
 // for diagnosis, but do not accumulate hundreds of MiB on every green run.
 fs.rmSync(dir,{recursive:true,force:true});
});

test('a live desktop service blocks update before backups, executable or configuration writes',()=>{
 const dir=fs.mkdtempSync(path.join(root,'live-')),bundle=path.join(dir,'bundle'),target=path.join(dir,'installed'),home=path.join(dir,'home');
 fs.mkdirSync(path.join(bundle,'skills/computer-use'),{recursive:true});
 writeFixture(bundle);fs.writeFileSync(path.join(bundle,'skills/computer-use/SKILL.md'),'fixture');seal(bundle);
 fs.mkdirSync(path.join(target,'data'),{recursive:true});const session=JSON.stringify({pid:process.pid,secret:'must not be printed or consumed'});fs.writeFileSync(path.join(target,'data/desktop-session.json'),session);
 assert.throws(()=>install({bundle,target,home}),/still running.*(shutdown|Quit Antigravity)/);assert(!fs.existsSync(path.join(target,'backups')));assert(!fs.existsSync(path.join(target,'releases')));assert(!fs.existsSync(home));assert.equal(fs.readFileSync(path.join(target,'data/desktop-session.json'),'utf8'),session);
});

test('unsealed extra code is refused before any installation write',()=>{
 const dir=fs.mkdtempSync(path.join(root,'extra-')),bundle=path.join(dir,'bundle'),target=path.join(dir,'installed');
 fs.mkdirSync(path.join(bundle,'skills/computer-use'),{recursive:true});
 writeFixture(bundle);fs.writeFileSync(path.join(bundle,'skills/computer-use/SKILL.md'),'fixture');seal(bundle);
 fs.mkdirSync(path.join(bundle,'server'));fs.writeFileSync(path.join(bundle,'server/unsealed.mjs'),'throw Error("unsealed executable code");');
 assert.throws(()=>install({bundle,target,home:path.join(dir,'home')}),/inventory differs/);assert(!fs.existsSync(target));
});

test('opt-in Claude Code skill follows global updates and rolls back with its launcher',async()=>{
 const dir=fs.mkdtempSync(path.join(root,'claude-skill-')),bundle=path.join(dir,'bundle'),target=path.join(dir,'installed'),home=path.join(dir,'home');
 try{
  fs.mkdirSync(path.join(bundle,'skills/computer-use'),{recursive:true});writeFixture(bundle);
  fs.writeFileSync(path.join(bundle,'skills/computer-use/SKILL.md'),'{{SHELL}} {{DESKTOP_COMMAND}}');seal(bundle);
  const first=install({bundle,target,home,alsoClaudeCode:true}),skill=path.join(home,'.claude/skills/computer-use/SKILL.md');
  assert.deepEqual(first.configs,[]);assert(!fs.existsSync(path.join(home,'.gemini/config/mcp_config.json')));
  const original=fs.readFileSync(skill,'utf8');assert(original.startsWith(process.platform==='win32'?'powershell ':'sh '));assert(original.includes(first.launcher));
  fs.writeFileSync(path.join(bundle,'skills/computer-use/SKILL.md'),'updated {{DESKTOP_COMMAND}}');seal(bundle,'9.2.0-test');
  const next=install({bundle,target,home});assert(fs.readFileSync(skill,'utf8').startsWith('updated '));
  await rollbackGuarded(path.join(next.backup,'rollback.json'));assert.equal(fs.readFileSync(skill,'utf8'),original);
  await rollbackGuarded(path.join(first.backup,'rollback.json'));assert(!fs.existsSync(skill));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('direct updates retain the previously chosen permission policy',()=>{
 const dir=fs.mkdtempSync(path.join(root,'policy-')),bundle=path.join(dir,'bundle'),target=path.join(dir,'installed'),home=path.join(dir,'home');
 fs.mkdirSync(path.join(bundle,'skills/computer-use'),{recursive:true});writeFixture(bundle);fs.writeFileSync(path.join(bundle,'skills/computer-use/SKILL.md'),'Use {{DESKTOP_COMMAND}}');seal(bundle);
 install({bundle,target,home,permissionMode:'host-managed'});const updated=install({bundle,target,home});
 assert.equal(JSON.parse(fs.readFileSync(path.join(updated.release,'desktop-policy.json'))).permission_mode,'host-managed');
});

test('failed post-copy storage verification leaves the prior launcher, pointer and host config in place',()=>{
 const dir=fs.mkdtempSync(path.join(root,'staged-')),bundle=path.join(dir,'bundle'),target=path.join(dir,'installed'),home=path.join(dir,'home');
 fs.mkdirSync(path.join(bundle,'skills/computer-use'),{recursive:true});writeFixture(bundle,'v1');fs.writeFileSync(path.join(bundle,'skills/computer-use/SKILL.md'),'Use {{DESKTOP_COMMAND}}');seal(bundle);
 const config=path.join(home,'.gemini/config/mcp_config.json');fs.mkdirSync(path.dirname(config),{recursive:true});fs.writeFileSync(config,JSON.stringify({mcpServers:{keep:{}}}));
 const first=install({bundle,target,home});const before={launcher:fs.readFileSync(first.launcher,'utf8'),node:fs.readFileSync(first.launcher_node,'utf8'),pointer:fs.readFileSync(path.join(target,'installation.json'),'utf8'),config:fs.readFileSync(first.configs[0],'utf8'),skill:fs.readFileSync(path.join(first.skills[0],'SKILL.md'),'utf8')};
 fs.writeFileSync(path.join(bundle,platform.node),'v2');seal(bundle,'9.2.0-test');let phases=0;
 assert.throws(()=>productionInstall({bundle,target,home,prepareStorage(){if(++phases===2)throw Error('Injected copied-tree ACL refusal');}}),/ACL refusal/);
 assert.equal(phases,2);assert.equal(fs.readFileSync(first.launcher,'utf8'),before.launcher);assert.equal(fs.readFileSync(first.launcher_node,'utf8'),before.node);assert.equal(fs.readFileSync(path.join(target,'installation.json'),'utf8'),before.pointer);assert.equal(fs.readFileSync(first.configs[0],'utf8'),before.config);assert.equal(fs.readFileSync(path.join(first.skills[0],'SKILL.md'),'utf8'),before.skill);
});

test('partial install uses fenced recovery or leaves its journal for the updater',async()=>{
 for(const stagedUpdate of [false,true]){
  const dir=fs.mkdtempSync(path.join(root,'install-recovery-')),bundle=path.join(dir,'bundle'),target=path.join(dir,'installed'),home=path.join(dir,'home');let rename=fs.renameSync;
  try{
   fs.mkdirSync(path.join(bundle,'skills/computer-use'),{recursive:true});writeFixture(bundle,'old');fs.writeFileSync(path.join(bundle,'skills/computer-use/SKILL.md'),'Use {{DESKTOP_COMMAND}}');seal(bundle);
   const first=install({bundle,target,home});const before=fs.readFileSync(first.launcher_node);writeFixture(bundle,'new');seal(bundle);let injected=false,error;
   fs.renameSync=(from,to)=>{if(!injected&&to===first.launcher){injected=true;throw Error('injected launcher switch failure');}return rename(from,to);};
   try{install({bundle,target,home,stagedUpdate});assert.fail('switch should fail');}catch(e){error=e;}finally{fs.renameSync=rename;}
   assert(injected);
   if(stagedUpdate){assert.equal(error.code,'installation_recovery_required');assert(fs.existsSync(error.rollback));await rollbackGuarded(error.rollback);}
   else assert.match(error.message,/injected launcher switch failure/);
   assert.deepEqual(fs.readFileSync(first.launcher_node),before);assert.equal(JSON.parse(fs.readFileSync(path.join(target,'installation.json'))).release,first.release);
  }finally{fs.renameSync=rename;fs.rmSync(dir,{recursive:true,force:true});}
 }
});
test('bundle and target overlap is refused before security or configuration changes',()=>{
 const dir=fs.mkdtempSync(path.join(root,'overlap-')),bundle=path.join(dir,'bundle'),home=path.join(dir,'home');
 fs.mkdirSync(path.join(bundle,'skills/computer-use'),{recursive:true});writeFixture(bundle);fs.writeFileSync(path.join(bundle,'skills/computer-use/SKILL.md'),'fixture');seal(bundle);
 let touched=false;assert.throws(()=>productionInstall({bundle,target:bundle,home,prepareStorage(){touched=true;}}),/overlap/);assert.equal(touched,false);assert(!fs.existsSync(home));
});

test('cross-folder migration refuses a live controller and preserves Stop/preferences without old capabilities',()=>{
 const dir=fs.mkdtempSync(path.join(root,'migrate-')),bundle=path.join(dir,'bundle'),firstTarget=path.join(dir,'old'),nextTarget=path.join(dir,'new'),home=path.join(dir,'home');
 fs.mkdirSync(path.join(bundle,'skills/computer-use'),{recursive:true});writeFixture(bundle);fs.writeFileSync(path.join(bundle,'skills/computer-use/SKILL.md'),'Use {{DESKTOP_COMMAND}}');seal(bundle);
 const first=install({bundle,target:firstTarget,home,permissionMode:'host-managed'});const data=path.join(firstTarget,'data');prepareFixtureData(data);
 fs.writeFileSync(path.join(data,'emergency.stop'),'stopped');fs.writeFileSync(path.join(data,'control-preferences.json'),JSON.stringify({takeover_mode:'smart'}));fs.writeFileSync(path.join(data,'task-state.json'),JSON.stringify({schema:1,open:true}));fs.writeFileSync(path.join(data,'desktop-session.json'),JSON.stringify({pid:process.pid,secret:'never copied'}));
 const original=fs.readFileSync(path.join(first.skills[0],'SKILL.md'),'utf8');assert.throws(()=>install({bundle,target:nextTarget,home,permissionMode:'host-managed'}),/still running/);assert(!fs.existsSync(nextTarget));assert.equal(fs.readFileSync(path.join(first.skills[0],'SKILL.md'),'utf8'),original);
 prepareFixtureData(path.join(nextTarget,'data'));
 fs.writeFileSync(path.join(data,'desktop-session.json'),JSON.stringify({pid:2147483647,secret:'never copied'}));
 assert.throws(()=>install({bundle,target:nextTarget,home,permissionMode:'host-managed'}),/task_open_finish_before_install/);assert.equal(fs.readFileSync(path.join(first.skills[0],'SKILL.md'),'utf8'),original);
 fs.writeFileSync(path.join(data,'task-state.json'),JSON.stringify({schema:1,open:false}));
 const next=install({bundle,target:nextTarget,home,permissionMode:'host-managed'});
 assert(fs.existsSync(path.join(nextTarget,'data/emergency.stop')));assert.equal(JSON.parse(fs.readFileSync(path.join(nextTarget,'data/control-preferences.json'))).takeover_mode,'smart');assert(!fs.existsSync(path.join(nextTarget,'data/desktop-session.json')));
 const pointer=path.join(next.skills[0],'deployment.json'),current=fs.readFileSync(pointer,'utf8'),rollbackFile=path.join(next.backup,'rollback.json');
 fs.writeFileSync(path.join(data,'task-state.json'),JSON.stringify({schema:1,open:true}));
 let rejected=spawnSync(process.execPath,['scripts/rollback.mjs',rollbackFile],{windowsHide:true,encoding:'utf8'});assert.equal(rejected.status,1);assert.match(rejected.stderr,/task_open_finish_before_rollback/);assert.equal(fs.readFileSync(pointer,'utf8'),current);
 fs.writeFileSync(path.join(data,'task-state.json'),JSON.stringify({schema:1,open:false}));fs.writeFileSync(path.join(data,'desktop-session.json'),JSON.stringify({pid:process.pid}));
 rejected=spawnSync(process.execPath,['scripts/rollback.mjs',rollbackFile],{windowsHide:true,encoding:'utf8'});assert.equal(rejected.status,1);assert.match(rejected.stderr,/still running/);assert.equal(fs.readFileSync(pointer,'utf8'),current);
 fs.writeFileSync(path.join(data,'desktop-session.json'),JSON.stringify({pid:2147483647}));
 const rollback=spawnSync(process.execPath,['scripts/rollback.mjs',path.join(next.backup,'rollback.json')],{windowsHide:true,encoding:'utf8'});assert.equal(rollback.status,0,rollback.stderr);assert.equal(JSON.parse(fs.readFileSync(path.join(first.skills[0],'deployment.json'))).target,firstTarget);
});
test('cross-folder migration refuses corrupt task state without replacing the deployment',()=>{
 const dir=fs.mkdtempSync(path.join(root,'migrate-task-invalid-')),bundle=path.join(dir,'bundle'),old=path.join(dir,'old'),next=path.join(dir,'new'),home=path.join(dir,'home');
 try{
  fs.mkdirSync(path.join(bundle,'skills/computer-use'),{recursive:true});writeFixture(bundle);fs.writeFileSync(path.join(bundle,'skills/computer-use/SKILL.md'),'Use {{DESKTOP_COMMAND}}');seal(bundle);
  const first=install({bundle,target:old,home});const data=path.join(old,'data');fs.mkdirSync(data);fs.writeFileSync(path.join(data,'task-state.json'),'{broken');
  const pointer=path.join(first.skills[0],'deployment.json'),before=fs.readFileSync(pointer,'utf8');
  assert.throws(()=>install({bundle,target:next,home}),/task_state_invalid/);assert.equal(fs.readFileSync(pointer,'utf8'),before);assert.equal(fs.readFileSync(path.join(data,'task-state.json'),'utf8'),'{broken');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('global and project updates retain their own policies instead of the last installed scope',()=>{
 const dir=fs.mkdtempSync(path.join(root,'scope-policy-')),bundle=path.join(dir,'bundle'),target=path.join(dir,'installed'),home=path.join(dir,'home'),workspace=path.join(dir,'project');
 fs.mkdirSync(path.join(bundle,'skills/computer-use'),{recursive:true});writeFixture(bundle);fs.writeFileSync(path.join(bundle,'skills/computer-use/SKILL.md'),'Use {{DESKTOP_COMMAND}}');seal(bundle);
 install({bundle,target,home,permissionMode:'host-managed'});install({bundle,target,home,workspace,permissionMode:'standalone'});
 const global=install({bundle,target,home});assert.equal(JSON.parse(fs.readFileSync(path.join(global.release,'desktop-policy.json'))).permission_mode,'host-managed');
 const project=install({bundle,target,home,workspace});assert.equal(JSON.parse(fs.readFileSync(path.join(project.release,'desktop-policy.json'))).permission_mode,'standalone');
});

test('rollback refuses a live service before restoring configuration or launchers',()=>{
 const dir=fs.mkdtempSync(path.join(root,'rollback-live-')),bundle=path.join(dir,'bundle'),target=path.join(dir,'installed'),home=path.join(dir,'home');
 fs.mkdirSync(path.join(bundle,'skills/computer-use'),{recursive:true});writeFixture(bundle);fs.writeFileSync(path.join(bundle,'skills/computer-use/SKILL.md'),'Use {{DESKTOP_COMMAND}}');seal(bundle);
 const installed=install({bundle,target,home});prepareFixtureData(path.join(target,'data'));fs.writeFileSync(path.join(target,'data/desktop-session.json'),JSON.stringify({pid:process.pid}));
 const before=fs.readFileSync(path.join(installed.skills[0],'SKILL.md'),'utf8');const rolled=spawnSync(process.execPath,['scripts/rollback.mjs',path.join(installed.backup,'rollback.json')],{windowsHide:true,encoding:'utf8'});
 assert.equal(rolled.status,1);assert.match(rolled.stderr,/still running/);assert.equal(fs.readFileSync(path.join(installed.skills[0],'SKILL.md'),'utf8'),before);assert(fs.existsSync(installed.launcher));
});
test('rollback refuses a recovered open or malformed task before changing deployment',()=>{
 const dir=fs.mkdtempSync(path.join(root,'rollback-task-')),bundle=path.join(dir,'bundle'),target=path.join(dir,'installed'),home=path.join(dir,'home');
 try{
  fs.mkdirSync(path.join(bundle,'skills/computer-use'),{recursive:true});writeFixture(bundle);fs.writeFileSync(path.join(bundle,'skills/computer-use/SKILL.md'),'Use {{DESKTOP_COMMAND}}');seal(bundle);
  const installed=install({bundle,target,home});const marker=path.join(target,'data','task-state.json');prepareFixtureData(path.dirname(marker));
  const before=fs.readFileSync(path.join(installed.skills[0],'SKILL.md'),'utf8');
  for(const state of [JSON.stringify({schema:1,open:true}),'{broken']){
   fs.writeFileSync(marker,state);const result=spawnSync(process.execPath,['scripts/rollback.mjs',path.join(installed.backup,'rollback.json')],{windowsHide:true,encoding:'utf8'});
   assert.equal(result.status,1);assert.match(result.stderr,/task_open_finish_before_rollback|task_state_invalid/);assert.equal(fs.readFileSync(path.join(installed.skills[0],'SKILL.md'),'utf8'),before);assert.equal(fs.readFileSync(marker,'utf8'),state);
  }
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('install and rollback refusals name the commands that free the folder',async()=>{
 const {serviceStopHint}=await import('../server/recovery.mjs');
 const dir=fs.mkdtempSync(path.join(testDirectory('install-stop-hint'),'x-'));
 try{
  assert.equal(serviceStopHint(dir),'Quit Antigravity, then try again.');
  const node=path.join(dir,'cu-node'+(process.platform==='win32'?'.exe':''));
  fs.writeFileSync(node,'');fs.writeFileSync(path.join(dir,'cu.mjs'),'');
  const hint=serviceStopHint(dir);
  assert(hint.includes(`"${node}" "${path.join(dir,'cu.mjs')}" end`));
  assert(hint.includes(' shutdown (or quit Antigravity)'));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
