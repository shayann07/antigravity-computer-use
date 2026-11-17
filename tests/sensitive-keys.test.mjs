import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
// The key rule asks before Ctrl/Cmd plus exactly S, V or X, with or without
// other modifiers, and never because "shift" starts with an s.
const contract=JSON.parse(fs.readFileSync(new URL('../server/control-contract.json',import.meta.url),'utf8'));
const rule=new RegExp(contract.sensitive_key_pattern,'i');
const guardian=fs.readFileSync(new URL('../server/native/Guardian.cs',import.meta.url),'utf8');
test('sensitive keys: Ctrl/Cmd+S/V/X ask, other Ctrl+Shift chords do not',()=>{
 for(const keys of ['ctrl+s','ctrl+v','ctrl+x','CTRL+S','cmd+v','command+x','ctrl+shift+s','ctrl+shift+v','shift+ctrl+v','cmd+shift+s','ctrl+alt+v','enter','alt+f4','win+r','ctrl+s ctrl+v'])
  assert.ok(rule.test(keys),keys+' must ask');
 for(const keys of ['ctrl+shift+n','ctrl+shift+t','cmd+shift+4','ctrl+space','ctrl+a','ctrl+z','ctrl+shift+esc','ctrl+f5','shift+tab','ctrl+shift+arrowleft'])
  assert.ok(!rule.test(keys),keys+' must not ask');
});
test('sensitive keys: the native fallback is the shared rule',()=>{
 const fallback=guardian.match(/Pattern\("sensitive_key_pattern","([^"]+)"/)[1].replace(/\\\\/g,'\\');
 assert.equal(fallback,contract.sensitive_key_pattern);
});
