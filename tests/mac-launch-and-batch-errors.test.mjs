import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveMacApp,macAppDirs} from '../server/platform.mjs';
import {call} from '../server/desktop-tools.mjs';

const dirs = set => ({home: '/Users/u', isDir: p => set.has(p), realpath: p => p});

test('a bare Mac app name resolves in the standard folders, first match wins (#122)', () => {
 const found = new Set(['/System/Applications/TextEdit.app', '/Users/u/Applications/TextEdit.app']);
 assert.equal(resolveMacApp('TextEdit', dirs(found)), '/System/Applications/TextEdit.app');
 assert.equal(resolveMacApp('TextEdit.app', dirs(found)), '/System/Applications/TextEdit.app');
 assert.equal(resolveMacApp('Terminal', dirs(new Set(['/System/Applications/Utilities/Terminal.app']))), '/System/Applications/Utilities/Terminal.app');
 assert.equal(resolveMacApp('Mine', dirs(new Set(['/Users/u/Applications/Mine.app']))), '/Users/u/Applications/Mine.app');
 assert.deepEqual(macAppDirs('/Users/u'), ['/Applications', '/System/Applications', '/System/Applications/Utilities', '/Applications/Utilities', '/Users/u/Applications']);
});
test('paths, hidden names and unknown apps are not resolved by name', () => {
 const all = {home: '/Users/u', isDir: () => true, realpath: p => p};
 assert.equal(resolveMacApp('/Applications/TextEdit.app', all), null);
 assert.equal(resolveMacApp('../TextEdit', all), null);
 assert.equal(resolveMacApp('.hidden', all), null);
 assert.equal(resolveMacApp('', all), null);
 assert.equal(resolveMacApp('Nope', dirs(new Set())), null);
});

const runtime = {action: async () => { throw new Error('no input may be sent'); }, snapshot: async () => { throw new Error('no input may be sent'); }};
const run = steps => call(runtime, 'computer_run', {hwnd: 1, observation_id: 'f', reason: 'test', steps});

test('an invalid computer_run step reports which step, why, and that no input was sent (#122)', async () => {
 await assert.rejects(run([{kind: 'click', name: 'A'}, {kind: 'fly'}]), e => e.code === 'invalid_steps' && /^Step 2 \(fly\): Unsupported batch step fly\. No input was sent\.$/.test(e.message));
 await assert.rejects(run([{kind: 'click', name: 'A', hwnd: 2}]), e => e.code === 'invalid_steps' && /^Step 1 \(click\): .*No input was sent\.$/.test(e.message));
 await assert.rejects(run([{kind: 'click', name: 'A'}, {kind: 'wait_change'}, {kind: 'click', x: 2, y: 3}]), e => e.code === 'invalid_steps' && /^Step 3 \(click\): A pixel action cannot use an unseen batch observation/.test(e.message) && /No input was sent\.$/.test(e.message) && !/No input was sent\..*No input was sent/.test(e.message));
});
