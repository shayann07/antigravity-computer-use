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

test('ordinary pre-input refusals get actionable agent advice, never a replay', async () => {
 const {recoveryAdvice} = await import('../server/recovery.mjs');
 const advice = (code, operation, extra = {}) => recoveryAdvice({error: {code}, ...extra}, operation);
 const cases = [
  ['obscured', 'computer_click', 'observe_and_retarget'],
  ['no_file_dialog', 'computer_file_dialog', 'observe_app_no_picker'],
  ['clipboard_unsafe', 'computer_file_dialog', 'retry_file_dialog_with_keyboard'],
  ['clipboard_unsafe', 'computer_paste', 'enter_without_clipboard'],
  ['clipboard_unsafe', 'computer_run', 'enter_without_clipboard'],
  ['clipboard_unsafe', undefined, 'enter_without_clipboard']
 ];
 for (const [code, operation, expected] of cases) {
  const result = advice(code, operation);
  assert.equal(result.next_action, expected, `${code} via ${operation}`);
  assert.equal(result.replay_allowed, false);
  assert.equal(RECOVERY_GUIDE[expected].actor, 'agent');
 }
 // Once input may have run, the uncertain-effect advice still wins.
 for (const code of ['obscured', 'no_file_dialog', 'clipboard_unsafe']) {
  assert.equal(advice(code, 'computer_file_dialog', {input_completed: true}).next_action, 'inspect_effect_without_replay');
  assert.equal(advice(code, 'computer_file_dialog', {delivery_unknown: true}).next_action, 'inspect_effect_without_replay');
 }
 // Unknown codes still fall back to operator diagnostics.
 assert.equal(advice('something_new', 'computer_click').next_action, 'inspect_diagnostics');
});
