import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {landedCount, runPlan, planHash, loadPlan} from '../server/plan-runner.mjs';
import {testRoot} from './paths.mjs';

const dir = () => { const d = path.join(testRoot, 'plan-runner', String(Date.now()) + Math.random().toString(16).slice(2)); fs.mkdirSync(d, {recursive: true}); return d; };
const steps = n => Array.from({length: n}, (_, i) => ({kind: 'click', x: i, y: i, risk: 'routine'}));

// Reply shapes copied from the run batch in server/desktop-tools.mjs.
test('landed steps follow every run reply shape', () => {
  assert.equal(landedCount({ok: true, observation_id: 'f'}, 8), 8);
  // verification error after step 3's input: completed includes it
  assert.equal(landedCount({ok: true, verification_error: {code: 'capture_changed'}, batch: {completed: [{}, {}, {}, {}], failed_index: 3, phase: 'verification'}}, 8), 4);
  // wait step unmet: completed excludes the wait, which sent no input
  assert.equal(landedCount({ok: false, verification_error: {code: 'wait_change_timeout'}, batch: {completed: [{}, {}], failed_index: 2, phase: 'wait'}}, 8), 2);
  // refused before input at step 5
  assert.equal(landedCount({ok: false, error: {code: 'stale_observation'}, completed: [], failed_index: 5}, 8), 5);
  // step 5 failed after its input ran, or its delivery is unknown: never replay it
  assert.equal(landedCount({ok: false, input_completed: true, error: {code: 'x'}, failed_index: 5}, 8), 6);
  assert.equal(landedCount({ok: false, delivery_unknown: true, error: {code: 'input_outcome_unknown'}, failed_index: 5}, 8), 6);
  // the worker died or timed out mid-step: the step may have sent input
  assert.equal(landedCount({ok: false, error: {code: 'host_exited'}, completed: [{}, {}, {}, {}, {}, {}], failed_index: 6}, 8), 7);
  assert.equal(landedCount({ok: false, error: {code: 'op_timeout'}, failed_index: 2}, 8), 3);
  // whole-batch refusal before anything ran
  assert.equal(landedCount({ok: false, error: {code: 'control_inactive'}}, 8), 0);
});

function fakeService(script) {
  const calls = [];
  const call = async (name, args) => { calls.push({name, args}); const next = script.shift(); return typeof next === 'function' ? next(name, args) : next; };
  return {calls, call};
}

test('a plan runs in batches of eight and records its progress', async () => {
  const d = dir(); const ledger = path.join(d, 'ledger.json');
  const {calls, call} = fakeService([{ok: true, observation_id: 'a'}, {ok: true, observation_id: 'b'}, {ok: true, observation_id: 'c'}]);
  const r = await runPlan({steps: steps(20), hwnd: 1, observationId: 'f0', reason: 't', ledgerFile: ledger, call, checkpointEvery: 10});
  assert.equal(r.ok, true); assert.equal(r.plan.done, true); assert.equal(r.plan.next, 20);
  assert.deepEqual(calls.map(c => c.args.steps.length), [8, 8, 4]);
  assert.deepEqual(calls.map(c => c.args.observation_id), ['f0', 'a', 'b']);
});

test('a spoiled frame after input resumes after the landed step, never replaying it', async () => {
  const d = dir(); const ledger = path.join(d, 'ledger.json');
  const {calls, call} = fakeService([
    {ok: true, verification_error: {code: 'capture_changed'}, batch: {completed: [{}, {}, {}], failed_index: 2, phase: 'verification'}},
    {ok: true, observation_id: 's1'},
    {ok: true, observation_id: 'z'}, {ok: true, observation_id: 'z2'}]);
  const r = await runPlan({steps: steps(12), hwnd: 1, observationId: 'f0', reason: 't', ledgerFile: ledger, call, checkpointEvery: 10});
  assert.equal(r.plan.done, true);
  const runs = calls.filter(c => c.name === 'run');
  assert.equal(runs[1].args.steps[0].x, 3, 'resumes at the first step that did not land');
  assert.equal(runs[1].args.observation_id, 's1');
});

test('a refusal before input retries from the same step after observing, at most twice', async () => {
  const d = dir(); const ledger = path.join(d, 'ledger.json');
  const refused = {ok: false, error: {code: 'stale_observation'}, completed: [], failed_index: 0};
  const {calls, call} = fakeService([refused, {ok: true, observation_id: 's'}, refused, {ok: true, observation_id: 's'}, refused, {ok: true, observation_id: 's'}]);
  const r = await runPlan({steps: steps(4), hwnd: 1, observationId: 'f0', reason: 't', ledgerFile: ledger, call});
  assert.equal(r.ok, false); assert.equal(r.halted, 'repeated_refusal'); assert.equal(r.plan.next, 0);
  assert.equal(calls.filter(c => c.name === 'run').length, 3);
});

test('any other refusal halts with progress and leaves the rest unsent', async () => {
  const d = dir(); const ledger = path.join(d, 'ledger.json');
  const {calls, call} = fakeService([{ok: true, observation_id: 'a'}, {ok: false, error: {code: 'control_inactive'}}]);
  const r = await runPlan({steps: steps(20), hwnd: 1, observationId: 'f0', reason: 't', ledgerFile: ledger, call});
  assert.equal(r.ok, false); assert.equal(r.halted, 'control_inactive'); assert.equal(r.plan.next, 8);
  assert.equal(calls.length, 2);
});

test('the action budget is renewed only as many times as allowed', async () => {
  const d = dir();
  const limit = {ok: false, error: {code: 'session_limit'}, completed: [], failed_index: 0};
  let renewals = 0; const renew = async () => { renewals++; return {ok: true, task_token: 'a'.repeat(64)}; };
  const none = fakeService([limit]);
  const r0 = await runPlan({steps: steps(4), hwnd: 1, observationId: 'f', reason: 't', ledgerFile: path.join(d, 'l0.json'), call: none.call, renew});
  assert.equal(r0.halted, 'session_limit'); assert.equal(renewals, 0);
  const one = fakeService([limit, {ok: true, observation_id: 's'}, {ok: true, observation_id: 'x'}]);
  const r1 = await runPlan({steps: steps(4), hwnd: 1, observationId: 'f', reason: 't', ledgerFile: path.join(d, 'l1.json'), call: one.call, renew, maxRenewals: 1});
  assert.equal(r1.ok, true); assert.equal(r1.plan.renewals, 1); assert.equal(r1.task_token, 'a'.repeat(64)); assert.equal(r1.renewed_task, true);
});

test('a checkpoint returns a frame mid-plan and the next call resumes from the ledger', async () => {
  const d = dir(); const ledger = path.join(d, 'ledger.json');
  const first = fakeService([{ok: true, observation_id: 'a', image: {path: 'p'}}, {ok: true, observation_id: 'b'}]);
  const r = await runPlan({steps: steps(20), hwnd: 1, observationId: 'f', reason: 't', ledgerFile: ledger, call: first.call, checkpointEvery: 1});
  assert.equal(r.checkpoint, true); assert.equal(r.plan.next, 8); assert.equal(r.observation_id, 'a');
  const second = fakeService([{ok: true, observation_id: 'c'}, {ok: true, observation_id: 'd'}]);
  const r2 = await runPlan({steps: steps(20), hwnd: 1, observationId: 'a', reason: 't', ledgerFile: ledger, call: second.call, checkpointEvery: 10});
  assert.equal(r2.plan.done, true); assert.equal(second.calls[0].args.steps[0].x, 8);
});

test('a ledger from a different plan is refused', async () => {
  const d = dir(); const ledger = path.join(d, 'ledger.json');
  fs.writeFileSync(ledger, JSON.stringify({plan_sha256: planHash(steps(3)), next: 2}));
  await assert.rejects(runPlan({steps: steps(4), hwnd: 1, observationId: 'f', reason: 't', ledgerFile: ledger, call: async () => ({ok: true})}), e => e.code === 'ledger_mismatch');
});

test('plan files must hold a non-empty step array', () => {
  const d = dir();
  fs.writeFileSync(path.join(d, 'a.json'), JSON.stringify({steps: steps(2)}));
  assert.equal(loadPlan(path.join(d, 'a.json')).length, 2);
  fs.writeFileSync(path.join(d, 'b.json'), '[]');
  assert.throws(() => loadPlan(path.join(d, 'b.json')), e => e.code === 'bad_plan');
});

test('frames are read from raw service replies, where they sit under metadata', async () => {
  const d = dir(); const ledger = path.join(d, 'ledger.json');
  const {calls, call} = fakeService([{ok: true, metadata: {observation_id: 'm1'}}, {ok: false, error: {code: 'stale_observation'}, completed: [], failed_index: 0},
    {ok: true, metadata: {observation_id: 'm2'}}, {ok: true, metadata: {observation_id: 'm3'}}]);
  const r = await runPlan({steps: steps(12), hwnd: 1, observationId: 'f0', reason: 't', ledgerFile: ledger, call, checkpointEvery: 10});
  assert.equal(r.plan.done, true);
  assert.deepEqual(calls.map(c => c.args.observation_id), ['f0', 'm1', undefined, 'm2']);
  assert.equal(r.observation_id, 'm3');
});

test('a request timeout with no step index never replays the batch', () => {
  assert.equal(landedCount({ok: false, error: {code: 'request_timeout', message: 'Desktop request timed out.'}}, 8), 8);
  assert.equal(landedCount({ok: false, delivery_unknown: true, error: {code: 'connection_lost'}}, 5), 5);
  assert.equal(landedCount({ok: false, error: {code: 'permission_denied'}}, 8), 0);
});

test('a covered target or a frame without a screenshot is observed again, with an image, and retried', async () => {
  for (const code of ['obscured', 'no_image']) {
    const d = dir(); const ledger = path.join(d, 'ledger.json');
    const {calls, call} = fakeService([{ok: false, error: {code}, completed: [{}, {}], failed_index: 2},
      {ok: true, metadata: {observation_id: 'm1'}}, {ok: true, metadata: {observation_id: 'm2'}}]);
    const r = await runPlan({steps: steps(8), hwnd: 1, observationId: 'f0', reason: 't', ledgerFile: ledger, call, checkpointEvery: 10});
    assert.equal(r.plan.done, true, code);
    const snap = calls.find(c => c.name === 'snapshot');
    assert.equal(snap.args.with_image, true, code);
    assert.equal(calls.at(-1).args.steps.length, 6, code);   // resumes at the step that was refused
  }
});
