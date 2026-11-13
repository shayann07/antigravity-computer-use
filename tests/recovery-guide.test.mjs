import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {RECOVERY_GUIDE,withRecovery} from '../server/recovery-guide.mjs';
import {encodeReply} from '../scripts/desktop.mjs';
import {TOOLS} from '../server/desktop-tools.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
// Collect every quoted value that can be assigned to next_action, including
// ternary chains, so a new value without a recovery entry fails here.
function nextActions(){
 const found=new Set();
 for(const folder of ['server','scripts'])for(const name of fs.readdirSync(path.join(root,folder))){
  if(!name.endsWith('.mjs')||name==='recovery-guide.mjs')continue;
  const text=fs.readFileSync(path.join(root,folder,name),'utf8');
  for(const match of text.matchAll(/next_action:((?:[^,{}()]|\([^()]*\))*)/g))
   // Skip compared values such as code==='x'; keep only assigned results.
   for(const value of match[1].matchAll(/(?<![=!]==)'([a-z][a-z0-9_]*)'/g))found.add(value[1]);
 }
 return found;
}
const STATE_WORDS=new Set(['stopped','paused','input_cleanup_failed']);

test('every next_action has a recovery entry with actor, command or reason, and safe_when',()=>{
 const actions=[...nextActions()].filter(value=>!STATE_WORDS.has(value));
 assert(actions.length>=30,`scanner found only ${actions.length} values`);
 const missing=actions.filter(value=>!RECOVERY_GUIDE[value]);assert.deepEqual(missing,[]);
 const commands=new Set(['start','serve','shutdown','describe','diagnostics','update',...TOOLS.map(tool=>tool.name.replace(/^computer_/,''))]);
 for(const [name,entry] of Object.entries(RECOVERY_GUIDE)){
  assert(['agent','human','operator'].includes(entry.actor),name);
  assert(typeof entry.safe_when==='string'&&entry.safe_when.length>10,name);
  if(entry.command===null)assert(typeof entry.reason==='string'&&entry.reason.length>5,`${name} needs a reason when it has no command`);
  else assert(commands.has(entry.command),`${name} names unknown command ${entry.command}`);
 }
});

test('replies gain an additive recovery object without changing existing fields',()=>{
 const reply={ok:true,ready:false,next_action:'end_recovered_task',replay_allowed:false};
 const decoded=JSON.parse(encodeReply(reply));
 assert.deepEqual({...decoded,recovery:undefined},{...reply,recovery:undefined});
 assert.equal(decoded.recovery.actor,'agent');assert.equal(decoded.recovery.command,'end');
 assert.deepEqual(withRecovery({ok:true}),{ok:true});
 const own={next_action:'observe_again',recovery:{custom:true}};assert.equal(withRecovery(own),own);
});
