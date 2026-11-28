// One-command installation orchestration. Uses the sealed release's existing
// installer and storage guard; never starts a desktop task or clears Stop.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';

const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
export function verifyPayload(folder,manifest,{installed=false}={}){
 if(!manifest||typeof manifest.build_id!=='string'||!manifest.files||typeof manifest.files!=='object'||Array.isArray(manifest.files))throw Error('Invalid release manifest.');
 const expected=Object.keys(manifest.files).sort();if(!expected.length)throw Error('Empty release payload.');
 const actual=[];
 function visit(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const file=path.join(dir,entry.name),name=path.relative(folder,file).replaceAll('\\','/');
  if(entry.isSymbolicLink())throw Error('Release links are not supported: '+name);
  if(entry.isDirectory())visit(file);else if(entry.isFile()&&!['bundle-manifest.json',...(installed?['desktop-policy.json']:[])].includes(name))actual.push(name);
 }}
 visit(folder);
 if(JSON.stringify(actual.sort())!==JSON.stringify(expected))throw Error('Release inventory does not match its sealed manifest.');
 for(const [name,digest]of Object.entries(manifest.files)){
  if(path.isAbsolute(name)||name.includes('\\')||name.split('/').some(p=>!p||p==='.'||p==='..')||!/^[a-f0-9]{64}$/.test(digest)||sha(path.join(folder,name))!==digest)throw Error('Release integrity check failed: '+name);
 }
 return expected.length;
}

export async function quickInstall({bundle,home=os.homedir(),target,permissionMode,dependencies}={}){
 if(permissionMode!=null&&!['standalone','host-managed'].includes(permissionMode))throw Error('Invalid installation permission mode.');
 bundle=path.resolve(bundle);const manifest=read(path.join(bundle,'bundle-manifest.json'));verifyPayload(bundle,manifest);
 const dep=dependencies||{
  ...await import(pathToFileURL(path.join(bundle,'scripts/install.mjs')).href),
  ...await import(pathToFileURL(path.join(bundle,'scripts/sidecar.mjs')).href),
  ...await import(pathToFileURL(path.join(bundle,'server/storage.mjs')).href)
 };
 const profile=path.join(home,'.gemini/config'),skill=path.join(profile,'skills/computer-use'),pointer=path.join(skill,'deployment.json');
 const current=fs.existsSync(pointer)?read(pointer):null;
 if(current&&(!target||path.resolve(target)===path.resolve(current.target))&&(!permissionMode||permissionMode===current.permission_mode)){
  const release=path.resolve(current.release),root=path.resolve(current.target),saved=read(path.join(release,'bundle-manifest.json'));
  if(saved.build_id===manifest.build_id){
   const relative=path.relative(root,release);if(!relative.startsWith('releases'+path.sep)||relative.split(path.sep).includes('..'))throw Error('Installed release is outside its private release folder.');
   if(!['standalone','host-managed'].includes(current.permission_mode))throw Error('Invalid installed permission mode.');
   // Use the downloaded, verified helper rather than trusting an existing EXE.
   dep.storageOperation('verify-tree',root,{helper:path.join(bundle,'bin/StorageGuard.exe')});
   const count=verifyPayload(release,manifest,{installed:true});
   const policy=read(path.join(release,'desktop-policy.json')),registry=read(path.join(root,'deployments.json'));
   if(policy.permission_mode!==current.permission_mode||path.resolve(policy.data_dir)!==path.join(root,'data'))throw Error('Installed deployment policy differs from its skill pin.');
   // A manual/legacy install needs the normal installer to create a new immutable
   // release policy. Do not modify its live policy in place.
   if(policy.idle_policy==='release'&&registry.global?.sidecar===true&&registry.global.release===current.release&&registry.global.integration==='direct'){
    const launcher=path.join(root,'cu.mjs'),node=path.join(root,'cu-node.exe');
    if(fs.readFileSync(launcher,'utf8')!==dep.launcherSource(release)||sha(node)!==manifest.files['node.exe'])throw Error('Installed launcher differs from its release pin.');
    const command=`& '${node.replaceAll("'","''")}' '${launcher.replaceAll("'","''")}'`;
    const template=fs.readFileSync(path.join(release,'skills/computer-use/SKILL.md'),'utf8').replaceAll('{{SHELL}}','powershell').replaceAll('{{DESKTOP_COMMAND}}',command).replaceAll('{{CONTROLLER_START}}',path.join(root,'Start Computer Use.cmd'));
    if(fs.readFileSync(path.join(skill,'SKILL.md'),'utf8')!==template)throw Error('Installed skill differs from its release.');
    const config=path.join(profile,'config.json'),definition=path.join(profile,'sidecars/antigravity-computer-use/sidecar.json');
    const updates=[[definition,JSON.stringify(dep.sidecarDefinition(path.join(release,'node.exe'),path.join(release,'scripts/desktop.mjs')),null,2)+'\n'],[config,dep.mergeSidecarConfig(config,{enable:true})]].filter(([file,text])=>!fs.existsSync(file)||!isDeepStrictEqual(read(file),JSON.parse(text)));
    let backup;
    if(updates.length){
     backup=path.join(root,'backups','quick-enable-'+new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(backup,{recursive:true});
     const records=updates.map(([file],i)=>{const existed=fs.existsSync(file),saved=path.join(backup,i+'.json');if(existed)fs.copyFileSync(file,saved);return {file,existed,saved};});
     fs.writeFileSync(path.join(backup,'sidecar-backup.json'),JSON.stringify({records},null,2));
     // The definition is published before the enable flag, and a failed write
     // puts back what this repair already changed, so the Sidecar is never
     // left enabled without its definition (#139).
     const published=[];
     try{
      for(const [file,text]of updates){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.agcu.tmp',text);fs.renameSync(file+'.agcu.tmp',file);published.push(file);}
     }catch(error){
      for(const file of published.reverse()){const record=records.find(r=>r.file===file);try{if(record.existed)fs.copyFileSync(record.saved,file);else fs.unlinkSync(file);}catch{}}
      for(const [file]of updates)try{fs.unlinkSync(file+'.agcu.tmp');}catch{}
      throw error;
     }
    }
    return {ok:true,already_installed:true,version:manifest.version,build_id:manifest.build_id,files:count,sidecar_enabled:true,...(backup?{backup}:{}),target:root};
   }
  }
 }
 const installed=dep.install({bundle,home,target,permissionMode,integration:'direct',sidecar:true});
 return {ok:true,already_installed:false,version:manifest.version,build_id:manifest.build_id,sidecar_enabled:true,...installed};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),take=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
 try{console.log(JSON.stringify(await quickInstall({bundle:take('--bundle'),target:take('--target'),permissionMode:take('--permission-mode')})));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
