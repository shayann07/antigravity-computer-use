import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {storageOperation,defaultInstallationRoot} from '../server/storage.mjs';
import {SIDECAR_ID,sidecarDefinition,mergeSidecarConfig} from './sidecar.mjs';
import {nativePlatform} from '../server/platform.mjs';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {writeAtomicJSON,writeAtomicText,flushPreparedTree,flushPreparedFile,readTaskState} from '../server/atomic-json.mjs';
import {deploymentPinned} from '../server/update-core.mjs';
import {preserveStopLatch,readStopLatch,settleOrphanMacStop,serviceStopHint} from '../server/recovery.mjs';
const here=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function renameRetrying(from,to,{rename=fs.renameSync,sleep=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms),attempts=30}={}){
 for(let attempt=1;;attempt++){
  try{rename(from,to);return attempt;}
  catch(error){if(!['EPERM','EBUSY','EACCES'].includes(error.code)||attempt>=attempts)throw error;sleep(100);}
 }
}
export function mergeConfig(file,entry){
 const text=fs.existsSync(file)?fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'').trim():'';
 const current=text?JSON.parse(text):{};
 if(!current||typeof current!=='object'||Array.isArray(current)||current.mcpServers&&(typeof current.mcpServers!=='object'||Array.isArray(current.mcpServers)))throw new Error('Invalid MCP configuration: '+file);
 current.mcpServers??={};if(entry)current.mcpServers['antigravity-computer-use']=entry;else delete current.mcpServers['antigravity-computer-use'];
 return JSON.stringify(current,null,2)+'\n';
}
// Resolve existing links before comparing destinations. New host profiles often
// have one or more directories that the installer will create for the first time.
function canonicalDestination(directory){
 try{return fs.realpathSync.native(directory);}
 catch(error){
  const parent=path.dirname(directory);
  if(error.code!=='ENOENT'||parent===directory)throw error;
  return path.join(canonicalDestination(parent),path.basename(directory));
 }
}
// Inert installer unit fixtures inject this filesystem boundary, like the
// runtime's mock driver. No CLI/environment/model argument can disable it.
export function install({bundle=here,target,home=os.homedir(),workspace=null,legacyProfiles=false,alsoClaudeCode,alsoCodex,skillRoots=[],integration='direct',permissionMode,sidecar,stagedUpdate=false,updateMode,updateChannel,updatePin,reporting,journalCreated,prepareStorage=(folder,helper,purpose='install')=>storageOperation(purpose,folder,{helper})}={}){
 if(!['direct','mcp'].includes(integration)||permissionMode!=null&&!['standalone','host-managed'].includes(permissionMode))throw new Error('Invalid integration/permission mode');
 bundle=path.resolve(bundle);
 const stamp=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8);
 const metadataFile=path.join(bundle,'bundle-manifest.json');
 const metadata=JSON.parse(fs.readFileSync(metadataFile,'utf8'));
 const platform=nativePlatform();
 if(metadata.platform&&metadata.platform!==process.platform||metadata.arch&&metadata.arch!==process.arch)throw Error('This bundle does not match the current operating system/architecture.');
 const version=metadata.version;
 if(!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version))throw new Error('Invalid bundle version');
 if(!metadata.files||typeof metadata.files!=='object'||Array.isArray(metadata.files)||!Object.keys(metadata.files).length)throw new Error('A complete bundle file manifest is required.');
 const inventory=[];
 function enumerate(dir){
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
   const file=path.join(dir,entry.name),name=path.relative(bundle,file).replaceAll('\\','/');
   if(entry.isSymbolicLink())throw new Error('Bundle links are not supported: '+name);
   if(entry.isDirectory())enumerate(file);
   else if(entry.isFile()){if(name!=='bundle-manifest.json')inventory.push(name);}
   else throw new Error('Unsupported bundle entry: '+name);
  }
 }
 enumerate(bundle);
 if(inventory.length!==Object.keys(metadata.files).length||inventory.some(name=>!Object.hasOwn(metadata.files,name)))throw new Error('Bundle inventory differs from the manifest; every payload file must be sealed.');
 // Validate before making backups, writing config or installing executable bytes.
 for(const [name,expected] of Object.entries(metadata.files)){
  if(!name||name.includes('\\')||name.split('/').some(p=>!p||p==='.'||p==='..')||path.isAbsolute(name)||!/^[a-f0-9]{64}$/.test(expected))throw new Error('Invalid bundle manifest entry: '+name);
  const actual=createHash('sha256').update(fs.readFileSync(path.join(bundle,name))).digest('hex');
  if(actual!==expected)throw new Error('Bundle integrity check failed: '+name);
 }
 for(const required of [platform.node,'bin/'+platform.host,'bin/'+platform.storage,'skills/computer-use/SKILL.md'])if(!Object.hasOwn(metadata.files,required))throw new Error('Bundle manifest omits '+required);
 const storageHelper=path.join(bundle,'bin',platform.storage);
 if(!Array.isArray(skillRoots))throw Error('--skill-root requires an absolute skills directory.');
 if((alsoClaudeCode||alsoCodex||skillRoots.length)&&(workspace||integration!=='direct'))throw Error('Additional host skills require a global direct install.');
 if(!target){
  const pointer=path.join(home,'.gemini/config/skills/computer-use/deployment.json');
  if(fs.existsSync(pointer))target=JSON.parse(fs.readFileSync(pointer,'utf8')).target;
 }
 target=path.resolve(target||defaultInstallationRoot({helper:storageHelper,home,localAppData:process.env.LOCALAPPDATA}));
 const updateLockFile=path.join(target,'update.lock');
 if(fs.existsSync(updateLockFile)){
  const owner=JSON.parse(fs.readFileSync(updateLockFile));
  if(!stagedUpdate||owner.pid!==process.pid)throw Error('An update owns this installation. Wait for its result before running the installer.');
 }
 const within=(parent,child)=>{const rel=path.relative(parent,child);return !rel||!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);};
 const updateStage=stagedUpdate&&path.dirname(path.dirname(bundle))===target&&path.basename(path.dirname(bundle))==='updates';
 if(within(bundle,target)||within(target,bundle)&&!updateStage)throw new Error('Bundle and installation folders must not overlap.');
 const priorFile=path.join(target,'installation.json');
 const prior=fs.existsSync(priorFile)?JSON.parse(fs.readFileSync(priorFile,'utf8')):null;
 const resolvedWorkspace=workspace?path.resolve(workspace):null;
 const scope=resolvedWorkspace?createHash('sha256').update(process.platform==='win32'?resolvedWorkspace.toLowerCase():resolvedWorkspace).digest('hex').slice(0,12):null;
 const registryFile=path.join(target,'deployments.json'),registry=fs.existsSync(registryFile)?JSON.parse(fs.readFileSync(registryFile,'utf8')):{};
 if(!registry||typeof registry!=='object'||Array.isArray(registry))throw new Error('Invalid private deployment registry.');
 const previous=registry[scope||'global']||(prior?.workspace===resolvedWorkspace?prior:null);
 alsoClaudeCode=integration==='direct'&&!workspace&&(alsoClaudeCode===true||previous?.also_claude_code===true);
 alsoCodex=integration==='direct'&&!workspace&&(alsoCodex===true||previous?.also_codex===true);
 const retainedRoots=integration==='direct'&&!workspace?(previous?.skill_roots??[]):[];
 if(!Array.isArray(retainedRoots))throw Error('Invalid skill roots in the deployment registry.');
 const customRoots=[];
 for(const root of [...retainedRoots,...skillRoots]){
  if(typeof root!=='string'||!path.isAbsolute(root))throw Error('--skill-root requires an absolute skills directory.');
  const resolved=canonicalDestination(path.resolve(root));
  if(!customRoots.some(other=>path.relative(other,resolved)===''))customRoots.push(resolved);
 }
 const additionalSkills=[];
 if(alsoClaudeCode)additionalSkills.push(path.join(home,'.claude','skills','computer-use'));
 if(alsoCodex)additionalSkills.push(path.join(home,'.agents','skills','antigravity-computer-use'));
 const customSkills=customRoots.map(root=>path.join(root,'antigravity-computer-use'));
 for(const directory of customSkills){
  if(fs.lstatSync(directory,{throwIfNoEntry:false})?.isSymbolicLink())throw Error('The installed skill directory must not be a symbolic link: '+directory);
  if(!additionalSkills.some(other=>path.relative(canonicalDestination(other),directory)===''))additionalSkills.push(directory);
 }
 const profiles=[path.join(home,'.gemini/config/skills/computer-use'),...additionalSkills,...(workspace?[path.join(path.resolve(workspace),'.agents/skills/computer-use')]:[])];
 const previousRoots=new Set();
 for(const dir of profiles){
  const pointer=path.join(dir,'deployment.json');
  if(fs.existsSync(pointer)){const value=JSON.parse(fs.readFileSync(pointer,'utf8'));if(typeof value.target!=='string'||!path.isAbsolute(value.target))throw new Error('Invalid prior deployment pointer.');previousRoots.add(path.resolve(value.target));}
  else if(fs.existsSync(path.join(dir,'SKILL.md'))){
   const text=fs.readFileSync(path.join(dir,'SKILL.md'),'utf8').toLowerCase();
   for(const candidate of ['D:\\Tools\\AntigravityComputerUse',path.join(process.env.LOCALAPPDATA||home,'AntigravityComputerUse')])if(text.includes(candidate.toLowerCase())&&fs.existsSync(path.join(candidate,'installation.json')))previousRoots.add(path.resolve(candidate));
  }
 }
 if(sidecar!=null&&typeof sidecar!=='boolean')throw Error('Sidecar selection must be boolean.');
 const sidecarSelected=sidecar;
 sidecar??=integration==='direct'&&!workspace&&previous?.sidecar===true;
 if(sidecar&&(workspace||integration!=='direct'))throw Error('The local sidecar belongs to the global direct install; project-local installs reuse it.');
 permissionMode??=previous?.integration===integration&&['standalone','host-managed'].includes(previous.permission_mode)?previous.permission_mode:(integration==='mcp'||sidecar)?'host-managed':'standalone';
 const liveFile=path.join(target,'data','desktop-session.json');
 for(const root of new Set([target,...previousRoots])){const sessionFile=path.join(root,'data','desktop-session.json');if(fs.existsSync(sessionFile)){
  const live=JSON.parse(fs.readFileSync(sessionFile,'utf8'));
  if(!Number.isSafeInteger(live.pid)||live.pid<=0)throw new Error('Existing session metadata is invalid. Inspect it before installing.');
  let alive=true;try{process.kill(live.pid,0);}catch(error){if(error.code==='ESRCH')alive=false;}
  if(alive)throw new Error(`A desktop service is still running; no installation files were changed. ${serviceStopHint(root)}`);
 }}
 const release=path.join(target,'releases',version+'-'+stamp);
 // A project-local update must not repoint an already installed global skill.
 const launcher=path.join(target,scope?`cu-${scope}.mjs`:'cu.mjs');
 const launcherNode=path.join(target,(scope?`cu-${scope}-node`:'cu-node')+(process.platform==='win32'?'.exe':''));
 const controllerStart=path.join(target,(scope?`Start Computer Use-${scope}`:'Start Computer Use')+(process.platform==='win32'?'.cmd':'.command'));
 if(!fs.existsSync(path.join(bundle,'bin',platform.host))||!fs.existsSync(path.join(bundle,platform.node)))throw new Error('Run the bundle build first; prebuilt native host and Node are required.');
 const base=workspace?path.join(path.resolve(workspace),'.agents'):path.join(home,'.gemini','config');
 const configs=workspace?[path.join(base,'mcp_config.json')]:[...new Set([path.join(base,'mcp_config.json'),...(legacyProfiles?['antigravity','antigravity-ide','antigravity-cli'].filter(p=>fs.existsSync(path.join(home,'.gemini',p))).map(p=>path.join(home,'.gemini',p,'mcp_config.json')):[])])];
 const entry={command:path.join(release,platform.node),args:[path.join(release,'server','index.mjs')],env:{AGCU_DATA_DIR:path.join(target,'data'),AGCU_PERMISSION_MODE:permissionMode,AGCU_TAKEOVER_MODE:'manual'}};
 const skillDirs=workspace?[path.join(base,'skills','computer-use')]:[path.join(base,'skills','computer-use'),...(legacyProfiles?['antigravity','antigravity-cli','antigravity-ide'].map(p=>path.join(home,'.gemini',p,'skills','computer-use')):[])];
 skillDirs.push(...additionalSkills);
 if(customSkills.length){
  const protectedDirs=[bundle,target,...previousRoots].map(canonicalDestination);
  const destinations=skillDirs.map(canonicalDestination);
  for(const directory of customSkills){
   const otherDirs=destinations.filter(other=>path.relative(other,directory)!=='');
   if([...protectedDirs,...otherDirs].some(other=>within(directory,other)||within(other,directory)))throw Error('Skill directories must not overlap a bundle, installation or another skill: '+directory);
   if(fs.existsSync(path.join(directory,'SKILL.md'))&&!fs.existsSync(path.join(directory,'deployment.json')))throw Error('A different skill already occupies '+directory);
  }
 }
 // Parse every config BEFORE writing anything. Keep exact backup bytes for rollback.
 const updates=configs.filter(file=>integration==='mcp'||fs.existsSync(file)).map(file=>({file,text:mergeConfig(file,integration==='mcp'?entry:null)}));
 const sidecarFiles=sidecar||previous?.sidecar===true?{definition:path.join(home,'.gemini/config/sidecars',SIDECAR_ID,'sidecar.json'),config:path.join(home,'.gemini/config/config.json')}:null;
 const sidecarConfig=sidecarFiles?mergeSidecarConfig(sidecarFiles.config,{enable:!sidecar?false:sidecarSelected===true?true:undefined}):null;
 // Before secrets/backups or executable bytes are written, establish a private
 // anchor and refuse writable/reparse ancestors. Never change those parents.
 prepareStorage(target,storageHelper);
 const updateFile=path.join(target,'update-settings.json');
 const previousUpdates=fs.existsSync(updateFile)?JSON.parse(fs.readFileSync(updateFile)):{};
 const updateSettings={mode:updateMode??previousUpdates.mode??'automatic',channel:updateChannel??previousUpdates.channel??(version.includes('-')?'beta':'stable'),reporting:reporting??previousUpdates.reporting??false};
 if(!['automatic','notify','manual'].includes(updateSettings.mode)||!['stable','beta'].includes(updateSettings.channel)||typeof updateSettings.reporting!=='boolean')throw Error('Invalid update/reporting settings');
 for(const root of previousRoots)if(root!==target)prepareStorage(root,storageHelper,'legacy');
 const preserveControl=()=>{
  const data=path.join(target,'data'),taskFile=path.join(data,'task-state.json');
  for(const root of new Set([target,...previousRoots])){
   const latch=path.join(root,'data','emergency.stop');let stop=readStopLatch(latch);
   // macOS: the same proof ready uses settles an unconfirmed Stop that no open
   // task names, so a newer build can install over it. It leaves a confirmed
   // Stop. Windows, an open task and any failed proof keep refusing.
   if(process.platform==='darwin'&&stop?.unconfirmed&&!stop.invalid&&!readTaskState(path.join(root,'data','task-state.json'))){try{settleOrphanMacStop(latch);}catch{}stop=readStopLatch(latch);}
   if(stop?.unconfirmed||stop?.invalid)throw Error('stop_recovery_required_before_install');
  }
  let dataPrepared=false;
  const ensureData=()=>{if(!dataPrepared){fs.mkdirSync(data,{recursive:true,mode:0o700});prepareStorage(data,storageHelper,'data');dataPrepared=true;}};
  let open=readTaskState(taskFile);
  for(const root of previousRoots)if(root!==target){
   const previousData=path.join(root,'data');
   if(readTaskState(path.join(previousData,'task-state.json')))open=true;
   const priorStop=path.join(previousData,'emergency.stop');let hasStop=false;
   for(const entry of [priorStop,priorStop+'.unconfirmed'])try{fs.lstatSync(entry);hasStop=true;}catch(error){if(error.code!=='ENOENT')throw error;}
   if(hasStop){ensureData();preserveStopLatch(priorStop,path.join(data,'emergency.stop'));}
   const preferences=path.join(previousData,'control-preferences.json'),destination=path.join(data,'control-preferences.json');
   if(!fs.existsSync(destination)&&fs.existsSync(preferences)){const saved=JSON.parse(fs.readFileSync(preferences,'utf8'));if(['manual','smart'].includes(saved.takeover_mode)){ensureData();fs.writeFileSync(destination,JSON.stringify({takeover_mode:saved.takeover_mode},null,2));}}
  }
  if(open)throw Error(`task_open_finish_before_install: a task is still open; no installation files were changed. ${serviceStopHint(target)}`);
 };
 preserveControl();
 const backup=path.join(target,'backups',stamp);fs.mkdirSync(backup,{recursive:true});
 const records=[];
 if(sidecarFiles)for(const [kind,file] of [['sidecar-definition',sidecarFiles.definition],['sidecar-config',sidecarFiles.config]]){const saved=path.join(backup,kind+'.json'),existed=fs.existsSync(file);if(existed)fs.copyFileSync(file,saved);records.push({file,saved,existed,kind});}
 for(const {file} of updates){const saved=path.join(backup,'config-'+records.length+'.json');const exists=fs.existsSync(file);if(exists)fs.copyFileSync(file,saved);records.push({file,saved,existed:exists,kind:'config'});}
 for(const file of skillDirs){const saved=path.join(backup,'skill-'+records.length);const exists=fs.existsSync(file);if(exists)fs.cpSync(file,saved,{recursive:true});records.push({file,saved,existed:exists,kind:'skill'});}
 for(const dir of skillDirs){const file=path.join(dir,'deployment.json'),saved=path.join(backup,'deployment-'+records.length+'.json'),exists=fs.existsSync(file);if(exists)fs.copyFileSync(file,saved);records.push({file,saved,existed:exists,kind:'deployment'});}
 const installationFile=path.join(target,'installation.json'),savedInstallation=path.join(backup,'prior-installation.json');
 const installedBefore=fs.existsSync(installationFile);if(installedBefore)fs.copyFileSync(installationFile,savedInstallation);
 records.push({file:installationFile,saved:savedInstallation,existed:installedBefore,kind:'installation'});
 const savedRegistry=path.join(backup,'prior-deployments.json'),registryExisted=fs.existsSync(registryFile);if(registryExisted)fs.copyFileSync(registryFile,savedRegistry);
 records.push({file:registryFile,saved:savedRegistry,existed:registryExisted,kind:'deployment-registry'});
 for(const [file,label] of [[launcher,'prior-cu.mjs'],[launcherNode,'prior-cu-node.exe'],[controllerStart,'prior-controller-start.cmd']]){
  const saved=path.join(backup,label),existed=fs.existsSync(file);if(existed)fs.copyFileSync(file,saved);
  records.push({file,saved,existed,kind:'launcher'});
 }
 const manifest={release,home,launcher,launcher_node:launcherNode,controller_start:controllerStart,sidecar:sidecarFiles,workspace:resolvedWorkspace,integration,permission_mode:permissionMode,configs:updates.map(update=>update.file),skills:skillDirs,records};
 const rollbackFile=path.join(backup,'rollback.json');
 flushPreparedTree(backup);
 writeAtomicJSON(rollbackFile,manifest,{exclusive:true});
 journalCreated?.(rollbackFile);
 let switching=false;
 try{
 fs.mkdirSync(path.dirname(release),{recursive:true});fs.cpSync(bundle,release,{recursive:true});
 fs.writeFileSync(path.join(release,'desktop-policy.json'),JSON.stringify({permission_mode:permissionMode,data_dir:path.join(target,'data'),idle_policy:sidecar||workspace&&registry.global?.sidecar===true?'release':'shutdown'},null,2));
 // No batch wrapper: CMD would reparse percent signs and shell metacharacters
 // in model-supplied text. A Node entrypoint preserves the actual argv.
 fs.writeFileSync(launcher+'.agcu.tmp',launcherSource(release));
 fs.writeFileSync(controllerStart+'.agcu.tmp',controllerStartSource(scope));
 try{fs.linkSync(path.join(release,platform.node),launcherNode+'.agcu.tmp');}catch{fs.copyFileSync(path.join(release,platform.node),launcherNode+'.agcu.tmp');}
 if(process.platform==='darwin'){fs.chmodSync(launcherNode+'.agcu.tmp',0o700);fs.chmodSync(controllerStart+'.agcu.tmp',0o700);}
 // File copying can carry security attributes. Seal the actual copied tree,
 // not merely the top directory, before changing the host's configuration.
 prepareStorage(target,storageHelper);
 preserveControl(); // Never lose a Stop that appeared while the update was staged.
 if(fs.existsSync(liveFile)){
  const live=JSON.parse(fs.readFileSync(liveFile,'utf8'));let alive=true;
  try{process.kill(live.pid,0);}catch(error){if(error.code==='ESRCH')alive=false;}
  if(alive)throw new Error('A desktop task began during staging. Its installed launcher/configuration were not replaced. Finish and shutdown before updating.');
 }
 switching=true;
 flushPreparedTree(release);
 for(const file of [launcher+'.agcu.tmp',launcherNode+'.agcu.tmp',controllerStart+'.agcu.tmp'])flushPreparedFile(file);
 // A separate CLI call can hold cu-node.exe open for a moment; the
 // controller lease does not fence it, so a locked rename is retried briefly.
 renameRetrying(launcherNode+'.agcu.tmp',launcherNode);
 renameRetrying(launcher+'.agcu.tmp',launcher);
 renameRetrying(controllerStart+'.agcu.tmp',controllerStart);
 for(const {file,text} of updates){fs.mkdirSync(path.dirname(file),{recursive:true});writeAtomicText(file,text);}
 if(sidecarFiles){for(const [file,text] of [[sidecarFiles.definition,JSON.stringify(sidecarDefinition(path.join(release,platform.node),path.join(release,'scripts/desktop.mjs')),null,2)+'\n'],[sidecarFiles.config,sidecarConfig]]){fs.mkdirSync(path.dirname(file),{recursive:true});writeAtomicText(file,text);}}
 for(const file of skillDirs){
  fs.mkdirSync(file,{recursive:true});fs.cpSync(path.join(release,'skills','computer-use'),file,{recursive:true});
  const instructions=path.join(file,'SKILL.md');
  const command=desktopCommand(launcherNode,launcher);
  writeAtomicText(instructions,renderInstalledSkill(fs.readFileSync(instructions,'utf8'),file,command,controllerStart));
  writeAtomicJSON(path.join(file,'deployment.json'),{target,release,workspace:resolvedWorkspace,permission_mode:permissionMode});
 }
 if(updatePin!=null&&typeof updatePin!=='boolean')throw Error('Version pin must be boolean.');
 const priorScope=registry[scope||'global']||previous;
 registry[scope||'global']={release,integration,permission_mode:permissionMode,workspace:resolvedWorkspace,sidecar,also_claude_code:alsoClaudeCode,also_codex:alsoCodex,skill_roots:customRoots,update_pin:updatePin??(priorScope?deploymentPinned(priorScope,registry.global):false)};
 writeAtomicJSON(registryFile,registry);
 writeAtomicJSON(updateFile,updateSettings);
 writeAtomicJSON(path.join(target,'installation.json'),{...manifest,backup});
 return {target,release,launcher,launcher_node:launcherNode,controller_start:controllerStart,sidecar:sidecarFiles,configs:manifest.configs,skills:skillDirs,backup};
 }catch(error){
  if(switching){
   // The updater already holds the target lease. Its async recovery must use
   // that lease directly rather than spawn a second owner and deadlock.
   if(stagedUpdate)throw Object.assign(Error('Staged installation requires fenced recovery.'),{code:'installation_recovery_required',rollback:rollbackFile,cause:error});
   const recovery=spawnSync(process.execPath,[fileURLToPath(new URL('./rollback.mjs',import.meta.url)),rollbackFile],{encoding:'utf8',timeout:30000,windowsHide:true});
   if(recovery.status!==0)throw Object.assign(Error('Installation recovery needs manual review. Use the retained rollback journal.'),{code:'installation_recovery_failed',rollback:rollbackFile,cause:recovery.error});
  }
  throw error;
 }
}
// Fixed, argument-free human entrypoint; no model text or command forwarding.
export function controllerStartSource(scope,platform=process.platform){const stem=scope?`cu-${scope}`:'cu';return platform==='win32'?`@echo off\r\n"%~dp0${stem}-node.exe" "%~dp0${stem}.mjs" start\r\nif errorlevel 1 (\r\n  pause\r\n  exit /b 1\r\n)\r\n"%~dp0${stem}-node.exe" "%~dp0${stem}.mjs" controls\r\nif errorlevel 1 pause\r\n`:`#!/bin/sh\nset -eu\ncd -- "$(dirname -- "$0")"\n"./${stem}-node" "./${stem}.mjs" start\nexec "./${stem}-node" "./${stem}.mjs" controls\n`;}
export function renderInstalledSkill(template,directory,command,controllerStart){
 if(path.basename(directory)==='antigravity-computer-use'){
  template=template.replace(/^name: computer-use$/m,'name: antigravity-computer-use');
 }
 return template.replaceAll('{{SHELL}}',process.platform==='win32'?'powershell':'sh').replaceAll('{{DESKTOP_COMMAND}}',command).replaceAll('{{CONTROLLER_START}}',controllerStart);
}
export function desktopCommand(node,launcher,platform=process.platform){const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";return platform==='win32'?`& '${node.replaceAll("'","''")}' '${launcher.replaceAll("'","''")}'`:`${quote(node)} ${quote(launcher)}`;}
export function launcherSource(release){return `import {main,encodeReply,recordedFailureReply} from ${JSON.stringify(pathToFileURL(path.join(release,'scripts','desktop.mjs')).href)};\nawait main().catch(async error=>{console.log(encodeReply(await recordedFailureReply(error)));process.exitCode=1;});\n`;}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);const take=k=>{const i=args.indexOf(k);return i<0?undefined:args[i+1];};
 try{console.log(JSON.stringify(install({skillRoots:args.flatMap((arg,i)=>arg==='--skill-root'?[args[i+1]]:[]),alsoCodex:args.includes('--also-codex'),alsoClaudeCode:args.includes('--also-claude-code'),bundle:take('--bundle')||here,target:take('--target'),workspace:take('--workspace'),legacyProfiles:args.includes('--legacy-profiles'),integration:take('--integration')||'direct',permissionMode:take('--permission-mode'),sidecar:args.includes('--sidecar')?true:undefined,updatePin:args.includes('--pin-version')?true:args.includes('--unpin-version')?false:undefined,updateMode:take('--updates'),updateChannel:take('--update-channel'),reporting:args.includes('--report-incidents')?true:args.includes('--no-report-incidents')?false:undefined}),null,2));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
