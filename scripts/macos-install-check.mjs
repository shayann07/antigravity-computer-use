// Exercise the actual shared installer in a fake project-local home. No real
// Antigravity settings, desktop input, TCC prompts or live installation changes.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {install} from './install.mjs';
import {qualifySignedUpdate} from './qualify-signed-update.mjs';
if(process.platform!=='darwin')throw Error('Run this qualification on macOS.');
const root=fileURLToPath(new URL('../',import.meta.url));
const base=path.join(root,'.localdata/tests/mac-install');fs.mkdirSync(base,{recursive:true,mode:0o700});
const directory=fs.mkdtempSync(path.join(base,'run-'));
const home=path.join(directory,'home');fs.mkdirSync(home,{recursive:true,mode:0o700});
const target=path.join(directory,'installed');const bundle=process.argv[2]?path.resolve(process.argv[2]):path.join(root,'.localdata/macos-bundle');
const config=path.join(home,'.gemini/config/config.json');fs.mkdirSync(path.dirname(config),{recursive:true});
fs.writeFileSync(config,JSON.stringify({permissions:{preset:'preserve'},sidecars:{unrelated:{enabled:true}}}));
// Explicit update calls below own qualification; prevent scheduled production
// network checks from racing the isolated signing fixture.
const first=install({bundle,target,home,sidecar:true,alsoClaudeCode:true,updateMode:'manual'});
const claudeSkill=path.join(home,'.claude/skills/computer-use');
function checkClaudeSkill(deployment){
 assert(deployment.skills.includes(claudeSkill));
 const text=fs.readFileSync(path.join(claudeSkill,'SKILL.md'),'utf8');
 assert(text.includes('```sh\n')&&text.includes(deployment.launcher));
 assert.equal(JSON.parse(fs.readFileSync(path.join(claudeSkill,'deployment.json'))).release,deployment.release);
}
checkClaudeSkill(first);
const node=first.launcher_node;
function command(args){const p=spawnSync(node,args,{encoding:'utf8',timeout:20000});assert.equal(p.status,0,p.stderr||p.stdout);return p.stdout;}
function desktop(name){return JSON.parse(command([first.launcher,name]));}
try {
 command([path.join(first.release,'scripts/verify-install.mjs'),target]);
 const started=desktop('start');assert.equal(started.state,'idle');assert.equal(started.runtime,'native-macos');
 assert.deepEqual(started.approved_apps,[]);assert.equal(started.custom_cursor,null);
 const reinstall=spawnSync(node,[path.join(first.release,'scripts/install.mjs'),'--bundle',bundle,'--target',target],{env:{...process.env,HOME:home},encoding:'utf8',timeout:20000});
 assert.equal(reinstall.status,1);assert.match(reinstall.stderr,/desktop service is still running/);assert.doesNotMatch(reinstall.stderr,/\n\s+at /);
 assert.equal(desktop('end').state,'idle');assert.equal(desktop('stop').task_ended,true);
 desktop('shutdown');
 const stopped=desktop('start');assert.equal(stopped.state,'stopped');assert.equal(stopped.custom_cursor,null);
 assert.equal(desktop('end').state,'stopped');desktop('shutdown');
 const next=install({bundle,target,home,sidecar:true});assert.notEqual(next.release,first.release);checkClaudeSkill(next);
 assert(fs.existsSync(path.join(target,'data/emergency.stop')));
 const changed=JSON.parse(fs.readFileSync(config));changed.sidecars.later={enabled:true};changed.unrelated_after=true;fs.writeFileSync(config,JSON.stringify(changed));
 command([path.join(next.release,'scripts/rollback.mjs'),path.join(next.backup,'rollback.json')]);
 assert.equal(JSON.parse(fs.readFileSync(path.join(target,'installation.json'))).release,first.release);
 checkClaudeSkill(first);
 const preserved=JSON.parse(fs.readFileSync(config));assert(preserved.sidecars.later.enabled);assert(preserved.sidecars.unrelated.enabled);assert(preserved.unrelated_after);assert.equal(preserved.permissions.preset,'preserve');
 command([path.join(first.release,'scripts/verify-install.mjs'),target]);
 const signedUpdate=await qualifySignedUpdate({target,bundle,directory});
 command([path.join(first.release,'scripts/verify-install.mjs'),target]);
 console.log(JSON.stringify(signedUpdate));
 console.log(JSON.stringify({ok:true,checks:['sealed prebuilt installation','Claude Code skill install, update and rollback','passive native-macos listener','End cleanup','Stop persisted across restart','no guardian during passive Stop','update','rollback','unrelated host settings preserved'],interactive_desktop_qualified:false}));
} finally {try{desktop('shutdown');}catch{} }
