import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describeCommand} from '../scripts/desktop.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skill = fs.readFileSync(path.join(root, 'skills', 'computer-use', 'SKILL.md'), 'utf8');

test('computer-use skill documents a supported ready entrypoint and bounded human handoff', () => {
  const entrypoint = /```powershell\s+\{\{DESKTOP_COMMAND\}\} (\w+)\s+```/.exec(skill);
  assert(entrypoint, 'the first terminal example needs the installed command');
  assert.equal(describeCommand(entrypoint[1]).command, 'ready', 'the documented entrypoint must resolve in the actual CLI');
  const fast = skill.indexOf('## Mandatory weak-model fast path');
  const ready = skill.indexOf('{{DESKTOP_COMMAND}} ready');
  assert(fast >= 0, 'weak-model fast path is missing');
  assert(ready >= 0 && ready < fast, 'ready command must precede the fast-path guidance');
  assert.match(skill.slice(fast, fast + 900), /Run exactly one\s+`ready` call/);
  assert.match(skill.slice(fast, fast + 900), /runtime's authority/);
  assert.match(skill, /at\s+most one bounded input attempt/);
  assert.match(skill, /stop issuing controller calls and wait for the human/);
  assert.match(skill, /Do not poll,\s*repeat `run`, retry a drag/);
});
