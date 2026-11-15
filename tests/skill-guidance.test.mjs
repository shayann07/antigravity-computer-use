import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describeCommand} from '../scripts/desktop.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skill = fs.readFileSync(path.join(root, 'skills', 'computer-use', 'SKILL.md'), 'utf8');
const referenceDir = path.join(root, 'skills', 'computer-use', 'references');
const references = Object.fromEntries(fs.readdirSync(referenceDir).filter(name => name.endsWith('.md'))
  .map(name => [name, fs.readFileSync(path.join(referenceDir, name), 'utf8')]));
const allText = skill + '\n' + Object.values(references).join('\n');

test('the core skill stays short and every reference it names exists', () => {
  assert(Buffer.byteLength(skill) < 10 * 1024, 'SKILL.md core must stay under about 10 KB');
  const long = skill.split(/\r?\n/).filter(line => line.length > 400);
  assert.equal(long.length, 0, 'no SKILL.md line may exceed 400 characters');
  for (const link of skill.matchAll(/\]\(references\/([\w-]+\.md)\)/g)) assert.ok(references[link[1]], link[1]);
  for (const [name, text] of Object.entries(references)) {
    if (name === 'recovery.md') continue;
    assert.equal(text.split(/\r?\n/).filter(line => line.length > 400).length, 0, name);
  }
  for (const text of Object.values(references)) assert.doesNotMatch(text, /\{\{/, 'references are copied without templating');
});

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
  assert.ok(skill.includes('references/handoff.md'), 'the core points at the handoff reference');
  assert.match(references['handoff.md'], /at\s+most one bounded input attempt/);
  assert.match(references['handoff.md'], /Do not poll,\s*repeat `run`, retry a drag/);
});

test('every command example in the computer-use skill parses with the real CLI', async () => {
  const {parseArguments, parseRunArguments} = await import('../scripts/arguments.mjs');
  const words = line => [...line.matchAll(/'([^']*)'|(\S+)/g)].map(m => m[1] ?? m[2]);
  const examples = [skill, ...Object.values(references)]
    .flatMap(text => [...text.matchAll(/```powershell\r?\n([\s\S]*?)```/g)])
    .flatMap(block => block[1].split(/\r?\n/))
    .map(line => line.trim().replace(/^(\{\{DESKTOP_COMMAND\}\}|DESKTOP_COMMAND) /, 'CMD '))
    .filter(line => line.startsWith('CMD ') && line !== 'CMD ready' && !/--hwnd H /.test(line))
    .map(line => words(line).slice(1));
  // Pixel rows in the command table, with placeholders filled.
  examples.push(['click', '--hwnd', '1', '--observation-id', 'F', '--x', '10', '--y', '20', '--risk', 'routine', '--reason', 'r']);
  examples.push(['move', '--hwnd', '1', '--observation-id', 'F', '--x', '10', '--y', '20', '--risk', 'routine', '--reason', 'r']);
  examples.push(['key', '--hwnd', '1', '--observation-id', 'F', '--keys', 'F5', '--risk', 'routine', '--reason', 'r']);
  examples.push(['run', '--hwnd', '1', '--observation-id', 'F', '--reason', 'r', '--step', 'key', '--keys', 'F5', '--risk', 'routine', '--step', 'click', '--x', '10', '--y', '20', '--risk', 'routine']);
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
  assert.match(references['finishing-and-reports.md'], /check the produced artifact once/);
  assert.match(references['finishing-and-reports.md'], /Do not explore history panels, hover for tooltips or search the disk/);
  assert.match(references['finishing-and-reports.md'], /still call `end` once before reporting/);
  assert.match(references['dialogs-and-text.md'], /never behind a guessed control/);
  assert.match(skill, /Do not call\s+`status` before `ready`/);
});

test('computer-use skill documents wait --until-gone and it parses with the real CLI', async () => {
 const {parseArguments} = await import('../scripts/arguments.mjs');
 assert.match(skill, /--until-gone OBSERVED_TEXT/);
 assert.match(references['observe-and-act.md'], /wait_label_not_observed/);
 const args = parseArguments(describeCommand('wait').inputSchema, ['--hwnd', '1', '--until-gone', 'Stop upscaling', '--timeout-ms', '30000', '--reason', 'r']);
 assert.equal(args.until_gone, 'Stop upscaling');
});

test('computer-use skill teaches multi-point drags, chained pixel steps and steps files', () => {
 assert.match(skill, /--points '\[\[X,Y\],\[X,Y\],\.\.\.\]'/);
 assert.match(references["observe-and-act.md"], /Pixel steps \(`click --x --y`, `move`, `drag`\) may follow each other in one `run`/);
 assert.match(references["observe-and-act.md"], /--steps-file FILE/);
 assert.match(skill, /compute the steps with a script, then run them with `plan`/);
 assert.ok(skill.includes('references/complex-tasks.md'));
 const reference = fs.readFileSync(new URL('../skills/computer-use/references/complex-tasks.md', import.meta.url), 'utf8');
 assert.match(reference, /plan --hwnd H --observation-id F --plan-file/);
 assert.doesNotMatch(reference, /\{\{/, 'references are copied without templating');
 const file = /A steps file for the same idea holds `(\[.*?\])`/.exec(references['observe-and-act.md']);
 assert.ok(file, 'the steps file example is present');
 const steps = JSON.parse(file[1]);
 assert.equal(steps[1].kind, 'drag'); assert.equal(steps[1].points.length, 3);
});

test('lifecycle commands accept and ignore --reason so an end is never lost to a habit flag', async () => {
 const {parseArguments} = await import('../scripts/arguments.mjs');
 for (const command of ['end', 'status', 'ready', 'shutdown']) {
  assert.deepEqual(parseArguments(describeCommand(command).inputSchema, ['--reason', 'done painting']), {}, command);
  assert.deepEqual(parseArguments(describeCommand(command).inputSchema, ['--reason=done']), {}, command);
 }
 assert.throws(() => parseArguments(describeCommand('end').inputSchema, ['--bogus', 'x']), /Unknown flag/);
});
