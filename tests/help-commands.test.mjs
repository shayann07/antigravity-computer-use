import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {describeCommand} from '../scripts/desktop.mjs';

const script = fileURLToPath(new URL('../scripts/desktop.mjs', import.meta.url));

// The installed CLI's bare help line once listed only serve/start/shutdown plus
// the tool registry, so agents reading it concluded there was no plan command.
test('bare help lists every command that describe lists', () => {
  const help = spawnSync(process.execPath, [script], {encoding: 'utf8', windowsHide: true});
  assert.equal(help.status, 0, help.stderr);
  const listed = help.stdout.split('\n')[1].split(' | ').map(item => item.split(' ')[0]);
  const described = spawnSync(process.execPath, [script, 'describe'], {encoding: 'utf8', windowsHide: true});
  const commands = JSON.parse(described.stdout.trim().split('\n').pop()).commands.map(entry => entry.command);
  for (const command of ['plan', 'report_draft', 'report_submit', 'report_never']) assert.ok(commands.includes(command), command);
  for (const command of commands) assert.ok(listed.includes(command), 'help line is missing ' + command);
  assert.equal(describeCommand('plan').command, 'plan');
});
