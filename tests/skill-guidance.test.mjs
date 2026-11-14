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

test('every command example in the computer-use skill parses with the real CLI', async () => {
  const {parseArguments, parseRunArguments} = await import('../scripts/arguments.mjs');
  const words = line => [...line.matchAll(/'([^']*)'|(\S+)/g)].map(m => m[1] ?? m[2]);
  const examples = [...skill.matchAll(/```powershell\r?\n([\s\S]*?)```/g)]
    .flatMap(block => block[1].split(/\r?\n/))
    .map(line => line.trim())
    .filter(line => line.startsWith('{{DESKTOP_COMMAND}} ') && line !== '{{DESKTOP_COMMAND}} ready')
    .map(line => words(line).slice(1));
  // Pixel rows in the command table, with placeholders filled.
  examples.push(['click', '--hwnd', '1', '--observation-id', 'F', '--x', '10', '--y', '20', '--risk', 'routine', '--reason', 'r']);
  examples.push(['move', '--hwnd', '1', '--observation-id', 'F', '--x', '10', '--y', '20', '--risk', 'routine', '--reason', 'r']);
  assert(examples.length >= 7, 'expected the skill examples to be found');
  assert(examples.some(([command, ...rest]) => command === 'run' && rest.includes('wait')), 'a batch example must end with a wait');
  for (const [command, ...rest] of examples) {
    const schema = describeCommand(command).inputSchema;
    const args = command === 'run' ? parseRunArguments(schema, rest, describeCommand) : parseArguments(schema, rest);
    assert.equal(typeof args, 'object', command);
  }
  assert.doesNotMatch(skill, /describe move drag scroll run/);
});

test('computer-use skill bounds image views, result reporting and abandoned tasks', () => {
  assert.match(skill, /\*\*Tree first\.\*\*/);
  assert.match(skill, /Pixel targets require a fresh viewed image/);
  assert.match(skill, /check the produced artifact once/);
  assert.match(skill, /Do not explore history panels, hover for tooltips or search the disk/);
  assert.match(skill, /still call `end` once before reporting/);
  assert.match(skill, /never behind a guessed control/);
  assert.match(skill, /Do not call\s+`status` before `ready`/);
});

test('computer-use skill documents wait --until-gone and it parses with the real CLI', async () => {
 const {parseArguments} = await import('../scripts/arguments.mjs');
 assert.match(skill, /--until-gone OBSERVED_TEXT/);
 assert.match(skill, /wait_label_not_observed/);
 const args = parseArguments(describeCommand('wait').inputSchema, ['--hwnd', '1', '--until-gone', 'Stop upscaling', '--timeout-ms', '30000', '--reason', 'r']);
 assert.equal(args.until_gone, 'Stop upscaling');
});

test('computer-use skill teaches multi-point drags, chained pixel steps and steps files', () => {
 assert.match(skill, /--points '\[\[X,Y\],\[X,Y\],\.\.\.\]'/);
 assert.match(skill, /Pixel steps \(`click --x --y`, `move`, `drag`\) may follow each other in one `run`/);
 assert.match(skill, /--steps-file FILE/);
 assert.match(skill, /Do not drive the CLI from a script loop/);
 const file = /A steps file for the same idea holds `(\[.*?\])`/.exec(skill);
 assert.ok(file, 'the steps file example is present');
 const steps = JSON.parse(file[1]);
 assert.equal(steps[1].kind, 'drag'); assert.equal(steps[1].points.length, 3);
});
