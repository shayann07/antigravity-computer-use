import {testDirectory} from './paths.mjs';
// Native cursor lifecycle/crash tests. No app grants, pointer movement or clicks.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {Guardian} from '../server/guardian.mjs';import {Driver} from '../server/driver.mjs';import {ensureHost} from '../server/build.mjs';
const dir=fs.mkdtempSync(path.join(testDirectory('cursor-recovery'),'run-'));const exe=ensureHost().exe;
const delay=ms=>new Promise(r=>setTimeout(r,ms));const checks=[];const record={passed:false,app_grants:0};
function probe(name,role=32512){const f=path.join(dir,name+'.png');const p=spawnSync(exe,['--cursor-probe',f,String(role)],{windowsHide:true,encoding:'utf8'});assert.equal(p.status,0,p.stdout+p.stderr);return fs.readFileSync(f);}
async function waitFor(predicate){for(let i=0;i<40;i++){if(predicate())return;await delay(100);}assert.fail('Native recovery timeout');}
async function session(name){
 const file=path.join(dir,name+'.state');fs.writeFileSync(file,'idle||0|');fs.writeFileSync(file+'.inputs','');
 const env={AGCU_GUARD_FILE:file,AGCU_PARENT_PID:String(process.pid),CU_OVERLAY:'off',CU_PRESENCE:'off'};
 const g=new Guardian(env),d=new Driver({env});await g.start();await d.start();g.send({op:'attach',pid:d.info.pid});
 return {g,d,file,worker:d.info.pid};
}
async function active(s){const a=await s.g.request({op:'activate',token:'cursor-fixture-only',deadline:(BigInt(Date.now()+30000)*10000n+621355968000000000n).toString()});assert(a.allowed);await delay(300);const v=await s.g.request({op:'visual_status'});assert(v.cursor,'Temporary native arrow must really be applied');assert(v.watchdog_pid);return v;}
async function close(s){const p=s.g.proc;s.g.close();await s.d.abort();if(p)await waitFor(()=>p.exitCode!==null||p.signalCode!==null);}
let current;
try {
 const roles=[32512,32649,32513,32650],baselines=new Map(roles.map(role=>[role,probe('baseline-'+role,role)]));
 const baseline=baselines.get(32512);current=await session('stop');await active(current);
 const levels=[];for(let i=0;i<12;i++){levels.push((await current.g.request({op:'visual_status'})).glow_opacity);await delay(130);}
 assert(levels.every(level=>level===0||level===1),'The glow is steady: absent with no target window, full when shown');checks.push('Glow does not breathe; it is absent until the agent works in a window');
 assert(!probe('active').equals(baseline),'System arrow pixels must differ while active');checks.push('Actual Windows system arrow replaced, with independent watchdog armed');
 for(const role of roles)assert(!probe('active-'+role,role).equals(baselines.get(role)),'Native role '+role+' must have custom artwork');checks.push('Arrow, link, text and background-work cursor roles all have actual native artwork');
 assert(!probe('text-role',32513).equals(probe('arrow-role',32512)),'Text fields must retain a distinct insertion cursor');checks.push('Text cursor retains its distinct insertion affordance');
 current.g.send({op:'stop'});await waitFor(()=>current.g.state==='stopped');await delay(250);
 assert(probe('stopped').equals(baseline));checks.push('Stop restores configured Windows arrow');await close(current);current=null;
 for(const role of roles)assert(probe('restored-'+role,role).equals(baselines.get(role)),'Native role '+role+' must restore');checks.push('All modified cursor roles restore after Stop');
 current=await session('ui-crash');await active(current);const ui=current.g.proc;ui.kill();
 await waitFor(()=>fs.readFileSync(current.file,'utf8').startsWith('stopped|'));await delay(250);
 assert(probe('after-ui-crash').equals(baseline));assert.throws(()=>process.kill(current.worker,0));
 checks.push('Hard-killed control UI: independent watchdog revoked fence, terminated worker and restored arrow');await close(current);current=null;
 current=await session('watchdog-crash');const status=await active(current);process.kill(status.watchdog_pid);
 await waitFor(()=>current.g.state==='stopped');assert(probe('after-watchdog-crash').equals(baseline));assert.throws(()=>process.kill(current.worker,0));
 checks.push('Hard-killed cursor watchdog: native guardian stopped input and restored arrow');await close(current);current=null;record.passed=true;
}catch(e){record.error=e.stack;process.exitCode=1;}
finally {if(current)await close(current).catch(()=>{});record.checks=checks;fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(record,null,2));console.log(JSON.stringify(record,null,2));}
