// Runs a long, pre-computed list of steps as consecutive `run` batches of at most
// eight, keeping a progress ledger so an interrupted plan resumes without
// replaying input. Every batch still goes through the service: the 8-step cap,
// Stop, approvals and per-step verification are unchanged. The runner only
// decides where to resume, using the reply shapes `run` produces
// (server/desktop-tools.mjs):
//   ok                                -> the whole batch landed
//   batch.completed (verification or wait phase) -> exactly those steps landed
//   failed_index + input_completed/delivery_unknown -> that step landed or may
//                                        have; never replay it
//   failed_index otherwise            -> refused before input; retry from it
import fs from 'node:fs';
import crypto from 'node:crypto';

export const BATCH = 8;
// Refusals raised before any input whose fix is simply a fresh observation.
const OBSERVE_AND_RETRY = new Set(['stale_observation', 'capture_changed', 'window_moved', 'snapshot_expired', 'observation_expired', 'wait_label_not_observed']);
const MAX_RETRIES = 2;
// Failures where the step's input may have been sent before the failure: the
// worker died, timed out or the connection dropped mid-step. Count the step as
// landed so it is never replayed, and halt so a human or model can look.
const UNCERTAIN = new Set(['host_exited', 'host_timeout', 'op_timeout', 'request_timeout', 'connection_lost', 'session_disconnected', 'input_outcome_unknown', 'host_write_failed']);

export function landedCount(reply, chunkLength) {
  if (reply && typeof reply === 'object') {
    if (reply.batch && Array.isArray(reply.batch.completed)) return Math.min(chunkLength, reply.batch.completed.length);
    if (reply.ok === true) return chunkLength;
    if (Number.isInteger(reply.failed_index)) {
      const landed = reply.delivery_unknown === true || reply.input_completed === true || UNCERTAIN.has(reply.error?.code);
      return Math.min(chunkLength, reply.failed_index + (landed ? 1 : 0));
    }
    // No step index (the CLI's own request timeout, a dropped connection):
    // any of the batch may have landed, so none of it is sent again.
    if (reply.delivery_unknown === true || UNCERTAIN.has(reply.error?.code)) return chunkLength;
  }
  return 0;
}

// Service replies carry the frame under metadata; the CLI's brief view flattens it.
export const frameOf = reply => reply?.observation_id ?? reply?.metadata?.observation_id;

export function planHash(steps) { return crypto.createHash('sha256').update(JSON.stringify(steps)).digest('hex'); }

export function loadPlan(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const steps = Array.isArray(raw) ? raw : raw?.steps;
  if (!Array.isArray(steps) || steps.length === 0 || steps.some(s => !s || typeof s !== 'object' || Array.isArray(s)))
    throw Object.assign(Error('The plan file must hold a non-empty JSON array of run steps (or {"steps":[...]}).'), {code: 'bad_plan'});
  return steps;
}

function readLedger(file, hash, total) {
  if (!fs.existsSync(file)) return {plan_sha256: hash, total, next: 0, batches: 0, renewals: 0};
  const ledger = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (ledger.plan_sha256 !== hash)
    throw Object.assign(Error('The ledger belongs to a different plan. Use a new --ledger file for a changed plan; progress is never transferred between plans.'), {code: 'ledger_mismatch'});
  return ledger;
}
const writeLedger = (file, ledger) => { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(ledger)); fs.renameSync(tmp, file); };

// call(command, args) sends one request to the service and resolves to its reply.
// renew() ends the task and starts a new one, resolving to the `ready` reply.
export async function runPlan({steps, hwnd, observationId, reason, ledgerFile, call, renew, checkpointEvery = 6, maxRenewals = 0}) {
  const hash = planHash(steps);
  const ledger = readLedger(ledgerFile, hash, steps.length);
  let obs = observationId, retries = 0, sinceCheckpoint = 0, last = null, renewed = null;
  const progress = done => ({plan: {total: steps.length, next: ledger.next, done, batches: ledger.batches, renewals: ledger.renewals, ledger: ledgerFile}});
  const observe = async () => { const s = await call('snapshot', {hwnd, reason: 'Observe before resuming the plan'}); if (s.ok && frameOf(s)) obs = frameOf(s); return s; };
  while (ledger.next < steps.length) {
    const chunk = steps.slice(ledger.next, ledger.next + BATCH);
    const reply = await call('run', {hwnd, observation_id: obs, steps: chunk, reason});
    last = reply;
    const landed = landedCount(reply, chunk.length);
    ledger.next += landed; ledger.batches++;
    ledger.last = {at: new Date().toISOString(), sent: chunk.length, landed, ok: reply.ok, code: reply.error?.code || reply.verification_error?.code};
    writeLedger(ledgerFile, ledger);
    if (reply.ok && !reply.verification_error) {
      retries = 0; if (frameOf(reply)) obs = frameOf(reply);
      if (++sinceCheckpoint >= checkpointEvery && ledger.next < steps.length)
        return {ok: true, ...reply, observation_id: obs, ...progress(false), ...renewed, checkpoint: true,
          next_hint: 'Look at the returned frame. If it is right, run the same plan command again with this observation_id to continue; the ledger resumes automatically.'};
      continue;
    }
    const code = reply.error?.code;
    if (code === 'session_limit' && renew && ledger.renewals < maxRenewals) {
      const ready = await renew();
      if (!ready?.ok) return {...ready, ok: false, ...progress(false)};
      ledger.renewals++; writeLedger(ledgerFile, ledger);
      renewed = {task_token: ready.task_token, task_command_prefix: ready.task_command_prefix, renewed_task: true};
      const s = await observe(); if (!s.ok) return {...s, ...progress(false), ...renewed};
      continue;
    }
    // A verification problem after input, or a refusal that only needs a fresh
    // frame: observe again and continue from the first step that did not land.
    if (reply.verification_error || (OBSERVE_AND_RETRY.has(code) && landed === 0)) {
      if (landed === 0 && ++retries > MAX_RETRIES) return {...reply, ok: false, ...progress(false), ...renewed, halted: 'repeated_refusal'};
      if (landed > 0) retries = 0;
      const s = await observe(); if (!s.ok) return {...s, ...progress(false), ...renewed};
      continue;
    }
    return {...reply, ok: false, ...progress(false), ...renewed, halted: code || 'unknown'};
  }
  return {ok: true, ...(last || {}), observation_id: obs, ...progress(true), ...renewed};
}
