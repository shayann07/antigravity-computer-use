import test from 'node:test';import assert from 'node:assert/strict';
import {RECOVERY_GUIDE,withRecovery} from '../server/recovery-guide.mjs';import {recoveryAdvice} from '../server/recovery.mjs';
import {encodeReply,failureReply} from '../scripts/desktop.mjs';

test('CLI bad_arguments tells the agent to fix the flag and retry, with replay allowed', () => {
 const reply = JSON.parse(encodeReply(failureReply(Object.assign(new Error('Use update status|check|apply|rollback'), {code: 'bad_arguments'}))));
 assert.equal(reply.next_action, 'fix_arguments_and_retry');assert.equal(reply.replay_allowed, true);
 assert.equal(reply.recovery.actor, 'agent');assert.equal(reply.recovery.command, 'describe');assert.match(reply.recovery.safe_when, /nothing was sent/i);
});

test('flag, policy, update, busy and unlock refusals name who acts and the command', () => {
 const cases = [
  ['bad_selector', 'fix_arguments_and_retry', 'agent', true], ['text_limit', 'fix_arguments_and_retry', 'agent', true], ['no_steps', 'fix_arguments_and_retry', 'agent', true],
  ['protected_app', 'choose_permitted_target', 'agent', false], ['app_blocked', 'choose_permitted_target', 'agent', false], ['key_blocked', 'choose_permitted_target', 'agent', false],
  ['needs_confirmation', 'await_user_decision', 'human', false], ['model_approval_forbidden', 'await_user_decision', 'human', false],
  ['human_resume_required', 'awaiting_human_resume', 'human', false], ['desktop_locked', 'await_human_unlock', 'human', false],
  ['update_in_progress', 'wait_for_update', 'agent', false], ['operation_pending', 'wait_for_pending_operation', 'agent', false],
  ['session_unavailable', 'human_restart_controller', 'human', false], ['launch_failed', 'fix_app_path', 'agent', false],
  ['launch_timeout', 'discover_apps_then_observe', 'agent', false], ['index_out_of_range', 'observe_again', 'agent', false],
  ['task_owned', 'wait_for_controller_then_observe', 'agent', false], ['control_inactive', 'inspect_status_then_human_controls', 'agent', false]
 ];
 for (const [code, action, actor, replay] of cases) {
  const result = recoveryAdvice({error: {code}}, 'computer_click');
  assert.equal(result.next_action, action, code);assert.equal(result.replay_allowed, replay, code);assert.equal(RECOVERY_GUIDE[action].actor, actor, code);
 }
 // Input that may have run is never offered a replay, whatever the code.
 assert.equal(recoveryAdvice({error: {code: 'bad_selector'}, input_completed: true}, 'computer_click').replay_allowed, false);
 assert.equal(recoveryAdvice({error: {code: 'bad_selector'}, delivery_unknown: true}, 'computer_click').next_action, 'inspect_effect_without_replay');
});

test('a blocked reply with no next_action still carries a recovery object and keeps its fields', () => {
 for (const blocked of [{ok: false, error: {code: 'x', message: 'm'}}, {ok: true, ready: false}, {ok: true, error: {code: 'y'}}]) {
  const out = withRecovery(blocked);assert.equal(out.recovery.actor, 'operator');assert.equal(out.recovery.command, 'diagnostics');assert.equal(out.next_action, undefined);
  assert.deepEqual({...out, recovery: undefined}, {...blocked, recovery: undefined});
 }
 assert.deepEqual(withRecovery({ok: true, ready: true}), {ok: true, ready: true});
});

test('every operator entry has a command or a stated reason, and every entry says when it is safe', () => {
 for (const [name, entry] of Object.entries(RECOVERY_GUIDE)) {
  if (entry.actor === 'operator' && entry.command === null) assert(entry.reason.length > 5, name);
  assert(entry.safe_when.length > 10, name);
 }
});

test('a fixable refusal after earlier batch steps landed is not replayable', async () => {
 const {recoveryAdvice} = await import('../server/recovery.mjs');
 const partial = recoveryAdvice({ok:false, completed:[{ok:true}], failed_index:1, error:{code:'bad_point'}}, 'computer_run');
 assert.equal(partial.replay_allowed, false); assert.equal(partial.next_action, 'fix_arguments_and_resume_after_completed');
 const clean = recoveryAdvice({ok:false, completed:[], failed_index:0, error:{code:'bad_point'}}, 'computer_run');
 assert.equal(clean.replay_allowed, true);
});
