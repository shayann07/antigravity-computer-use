// Sessions under the same data directory serialize input through a native
// fence. Registration and peer descriptions are advisory, not task identity.
// A shared Sidecar currently cannot distinguish host conversations (#7), and
// separate installations are not coordinated (#10). A stale action lease is
// retained until prior input cleanup is verified; it is never stolen by age.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dataDir } from './build.mjs';
import { acquireServiceLease } from './service-lease.mjs';

// Liveness is the pid, not the clock: a session sitting idle for ten
// minutes is still running, still owns its banner row, and must not have its
// slot handed to someone else. A quiet registration is only reported as quiet.
const STALE_MS = 90_000;

// The one case the pid cannot settle: a session died, and the operating system
// handed its pid to an unrelated process, so the record looks alive forever.
// Nothing has heartbeat in half an hour, so the record goes.
const ABANDONED_MS = 30 * 60_000;

// How long to wait for another session's action to finish before giving up.
const WAIT_MS = 10_000;

const POLL_MS = 40;

export class LeaseBusy extends Error {
  constructor(holder) {
    super(holder && holder.label
      ? `Another controller (${holder.label}, pid ${holder.pid}) is still running its own ${holder.op || 'action'}.`
      : 'Another controller is holding the input lease.');
    this.code = 'another_session_busy';
    this.holder = holder;
  }
}

function pidAlive(pid) {
  if (!pid) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means it exists and belongs to someone else, which still counts.
    return !err || err.code !== 'ESRCH';
  }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
}

// One writer per file and the file is tiny, so a plain write is atomic enough
// in practice; a torn read is handled by readJson returning null.
function writeJson(file, obj) {
  try { fs.writeFileSync(file, JSON.stringify(obj)); return true; }
  catch { return false; }
}

export class Sessions {
  constructor({ dir, pid = process.pid, now = () => Date.now(), monotonic = () => performance.now(), sleep, isAlive, sessionId = null, acquireInputLease = acquireServiceLease, onInputLeaseLost = null } = {}) {
    // An optional advisory identifier. It is not a host-authenticated task ID.
    this.sessionId = sessionId || null;
    this.dir = dir || path.join(dataDir(), 'sessions');
    this.lease = path.join(this.dir, 'input.lease');
    this.inputFence = path.join(this.dir, 'input-fence');
    this.acquireInputLease=acquireInputLease;this.onInputLeaseLost=onInputLeaseLost;
    this.pid = pid;
    this.now = now;
    this.monotonic = monotonic;
    this.sleep = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.alive = isAlive || pidAlive;
    this.file = path.join(this.dir, `${this.pid}.json`);
    this.slot = 0;
    this.label = 'session 1';
    this.me = null;
    // Calls inside one session queue in memory rather than fighting over the
    // lease file - a host can issue two tool calls at once, and two of our
    // own actions racing is the same hazard as two sessions racing.
    this._chain = Promise.resolve();
    this._held = 0;
    // Consequential controls the user has pre-approved for the rest of this
    // session, in words they typed: "app\ncontrol" -> record. Memory only and
    // never written anywhere - not into this session's registration file, not
    // into the grants file a resumed conversation restores - so a new process
    // starts with none and a resumed conversation asks again. They end when
    // the session does: close(), a different conversation's id, or a revoke.
    this.preApprovals = new Map();
  }

  register(extra = {}) {
    try { fs.mkdirSync(this.dir, { recursive: true }); } catch { /* reported by the write below */ }
    const peers = this.peers();
    // Lowest free slot, so the banner of a session that exits leaves a gap that
    // the next one to start fills.
    const taken = new Set(peers.map((p) => p.slot));
    let slot = 0;
    while (taken.has(slot)) slot++;
    this.slot = slot;
    this.label = 'session ' + (slot + 1);
    this.me = {
      pid: this.pid,
      slot,
      label: this.label,
      started: this.now(),
      seen: this.now(),
      host: os.hostname(),
      cwd: process.cwd(),
      session_id: this.sessionId || undefined,
      ...extra,
    };
    writeJson(this.file, this.me);

    // Two sessions starting in the same instant can both see the same free slot
    // and both take it, which puts two banners in one place - exactly the thing
    // slots exist to prevent. Settle it without coordinating: the lower pid
    // keeps the slot, the other moves up.
    for (let i = 0; i < 4; i++) {
      const seen = this.peers();
      if (!seen.some((p) => p.slot === this.slot && Number(p.pid) < this.pid)) break;
      const taken = new Set(seen.map((p) => p.slot));
      let s = 0;
      while (taken.has(s)) s++;
      this.slot = s;
      this.label = 'session ' + (s + 1);
      this.me.slot = s;
      this.me.label = this.label;
      writeJson(this.file, this.me);
    }
    return this.me;
  }

  // The Stop hook names the session; a server started without the id learns it.
  setSessionId(id) {
    if (!id || id === this.sessionId) return;
    // A server that learns its id late keeps what it was given before; one
    // told it now belongs to another conversation keeps nothing from this one.
    if (this.sessionId) this.endPreApprovals();
    this.sessionId = String(id);
    if (this.me) { this.me.session_id = this.sessionId; writeJson(this.file, this.me); }
  }

  // A peer that is this same conversation in an earlier process.
  sameConversation(p) {
    return !!(this.sessionId && p && p.session_id && String(p.session_id) === this.sessionId);
  }

  // Called on every tool call. Cheap, and it is what makes a crashed session
  // detectable by everyone else.
  heartbeat(patch = {}) {
    if (!this.me) return;
    Object.assign(this.me, patch, { seen: this.now() });
    writeJson(this.file, this.me);
  }

  // Live sessions other than this one. Dead registrations are pruned as they
  // are found, so the directory cannot grow without bound.
  peers() {
    let names;
    try { names = fs.readdirSync(this.dir); } catch { return []; }
    const out = [];
    for (const name of names) {
      if (!/^\d+\.json$/.test(name)) continue;
      const full = path.join(this.dir, name);
      const rec = readJson(full);
      const pid = rec && Number(rec.pid);
      if (!rec || !pid) { try { fs.unlinkSync(full); } catch {} continue; }
      if (pid === this.pid) continue;
      const quiet = this.now() - Number(rec.seen || 0);
      if (!this.alive(pid) || quiet > ABANDONED_MS) { try { fs.unlinkSync(full); } catch {} continue; }
      rec.idle = quiet > STALE_MS;
      out.push(rec);
    }
    out.sort((a, b) => a.slot - b.slot);
    return out;
  }

  // Who is holding the input lease right now, if anyone.
  holder() {
    const rec = readJson(this.lease);
    if (!rec) return null;
    if (!this.alive(Number(rec.pid))) return null;
    return rec;
  }

  _tryClaim(op, target) {
    try {
      const fd = fs.openSync(this.lease, 'wx');
      try {
        fs.writeFileSync(fd, JSON.stringify({
          pid: this.pid, label: this.label, op, target: target || null, at: this.now(),
        }));
      } finally { fs.closeSync(fd); }
      return true;
    } catch (err) {
      if (!err || err.code !== 'EEXIST') {
        const failure=new Error('Cannot acquire the desktop input lease; no action was sent.');
        failure.code='input_lease_unavailable';throw failure;
      }
      const rec = readJson(this.lease);
      // An unreadable record can be another writer's partially published lease.
      // A live owner is never displaced merely because an action is slow.
      const dead = rec && Number.isSafeInteger(rec.pid) && rec.pid>0 && rec.pid<=4294967295 && !this.alive(rec.pid);
      if(dead){const failure=new Error('A prior input owner exited without releasing its lease. Complete verified task recovery before retrying.');failure.code='input_lease_stale';throw failure;}
      return false;
    }
  }

  _release() {
    const rec = readJson(this.lease);
    // Only ever drop our own. If another session stole it because we were slow,
    // deleting it here would hand a third session a lease that is in use.
    if (!rec || !Number.isSafeInteger(rec.pid) || rec.pid !== this.pid) return;
    try { fs.unlinkSync(this.lease); } catch {}
  }

  async clearVerifiedStale(pid){
    if(!Number.isSafeInteger(pid)||pid<=0||pid>4294967295)throw Error('Invalid prior input owner.');
    let before;try{before=fs.readFileSync(this.lease,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
    // Establish absence BEFORE spawning the recovery fence helper. Windows can
    // recycle that old PID for this new helper; its live handle then proves a
    // different process, not resurrection of the old owner. No caller flag can
    // supply that identity. Every other live PID remains a refusal.
    if(this.alive(pid))throw Error('Prior input owner is not confirmed gone.');
    fs.mkdirSync(this.inputFence,{recursive:true});const fence=await this.acquireInputLease(this.inputFence);
    try{
      fence.assertHeld();let raw;try{raw=fs.readFileSync(this.lease,'utf8');}catch(error){if(error.code==='ENOENT')return {cleared:false};throw error;}
      let record;try{record=JSON.parse(raw);}catch{throw Error('Prior input lease metadata is invalid.');}
      if(raw!==before||!Number.isSafeInteger(record?.pid)||record.pid!==pid||this.alive(pid)&&fence.pid!==pid)throw Error('Prior input owner is not confirmed gone.');
      fs.unlinkSync(this.lease);fence.assertHeld();return {cleared:true};
    }finally{await fence.release();}
  }

  // Run fn while holding this installation's input fence. Reads never call this;
  // anything that can move the pointer, change the foreground window or send a
  // keystroke does.
  async withInput(op, target, fn, { waitMs = WAIT_MS } = {}) {
    const run = async () => {
      // Re-entrant within a session: the in-memory chain already serialises us.
      if (this._held > 0) { this._held++; try { return await fn(); } finally { this._held--; } }

      const deadline = this.monotonic() + waitMs;
      let waited = 0;
      // New runtimes fence read/claim/release with the native kernel lease.
      // The metadata file remains for compatibility and diagnostics.
      try{fs.mkdirSync(this.inputFence,{recursive:true});}catch{const error=new Error('Cannot prepare the input fence; no action was sent.');error.code='input_lease_unavailable';throw error;}
      let fence;
      while(!fence){
        try{fence=await this.acquireInputLease(this.inputFence);}
        catch(error){if(error.code!=='service_already_running'){const failure=new Error('Cannot acquire the native input fence; no action was sent.');failure.code='input_lease_unavailable';failure.cause=error;throw failure;}if(this.monotonic()>=deadline)throw new LeaseBusy(readJson(this.lease));await this.sleep(POLL_MS);waited+=POLL_MS;}
      }
      fence.once?.('lost',()=>{try{this.onInputLeaseLost?.();}catch{}});
      let dispatched=false;
      try{
      fence.assertHeld();
      while (!this._tryClaim(op, target)) {
        if (this.monotonic() >= deadline) throw new LeaseBusy(readJson(this.lease));
        await this.sleep(POLL_MS);
        waited += POLL_MS;
      }
      this._held = 1;
      try {
        fence.assertHeld();dispatched=true;
        const r = await fn();
        fence.assertHeld();
        if (waited > 0 && r && typeof r === 'object') r.waited_for_session_ms = waited;
        return r;
      } finally {
        this._held = 0;
        this._release();
      }
      }catch(error){if(dispatched&&fence.lost){const unknown=new Error('Input fence was lost during an operation. Inspect its effect without replay.');unknown.code='input_outcome_unknown';throw unknown;}throw error;}
      finally{try{await fence.release();}catch{try{this.onInputLeaseLost?.();}catch{}const unknown=new Error('Input fence release is unconfirmed. Inspect the effect without replay.');unknown.code=dispatched?'input_outcome_unknown':'input_lease_unavailable';throw unknown;}}
    };

    // Chain, so two concurrent calls from this session queue instead of both
    // polling the file and starving each other.
    const next = this._chain.then(run, run);
    this._chain = next.then(() => {}, () => {});
    return next;
  }

  // A peer that touched the same window we are about to touch is the one case
  // where both agents behaving correctly still produces nonsense.
  conflicts(hwnd, withinMs = 15_000) {
    if (!hwnd) return [];
    return this.peers().filter((p) =>
      p.last_hwnd && Number(p.last_hwnd) === Number(hwnd) &&
      this.now() - Number(p.last_at || 0) < withinMs);
  }

  // One line for the model, only when there is something new to say: the
  // first time a peer is seen, when the set of peers changes, and whenever
  // one has just acted in the same window. Repeating "another session
  // exists" on every action taught nothing and cost fifty tokens a time.
  note(hwnd, { always = false } = {}) {
    const peers = this.peers();
    if (!peers.length) { this._noteSig = ''; return ''; }
    const clash = this.conflicts(hwnd);
    const sig = peers.map((p) => p.pid).sort().join(',');
    // A window listing is "who is here", so it always says; an action says
    // it only the first time.
    if (!always && sig === this._noteSig && !clash.length) return '';
    this._noteSig = sig;
    const describePeer = (p) => {
      const what = p.last_op
        ? `${p.last_op}${p.last_title ? ` in "${p.last_title}"` : ''} ${Math.round((this.now() - Number(p.last_at || 0)) / 1000)}s ago`
        : 'no actions yet';
      return `${p.label} (pid ${p.pid}${p.idle ? ', idle' : ''}): ${what}`;
    };
    // After a resume the conversation's previous server can still be alive.
    // This is an advisory identifier, not authenticated host ownership.
    const mine = peers.filter((p) => this.sameConversation(p));
    const others = peers.filter((p) => !this.sameConversation(p));
    let s = '';
    if (others.length) {
      const whoElse = others.map(describePeer).join('; ');
      s += `[${others.length} other controller registration${others.length > 1 ? 's' : ''}: ${whoElse}. ` +
           `Input is serialised only within this data directory. Host conversations sharing one Sidecar are not identified here.]\n`;
    }
    if (mine.length) {
      s += `[a controller with the same advisory session ID is still running (pid ${mine.map((p) => p.pid).join(', ')}); input is serialised within this data directory.]\n`;
    }
    if (clash.length) {
      s += `[WARNING: ${clash.map((p) => p.label).join(', ')} acted in THIS SAME WINDOW moments ago. ` +
           `Two agents editing one window will corrupt each other's work - say so and check with the user before continuing.]\n`;
    }
    return s;
  }

  describe() {
    const peers = this.peers();
    const h = this.holder();
    const lines = [`this session: ${this.label} (pid ${this.pid})`];
    if (!peers.length) lines.push('other controller registrations in this data directory: none');
    else {
      lines.push(`other controller registrations in this data directory: ${peers.length}`);
      for (const p of peers) {
        const last = p.last_op
          ? `${p.last_op}${p.last_title ? ` in "${p.last_title}"` : ''}, ${Math.round((this.now() - Number(p.last_at || 0)) / 1000)}s ago`
          : 'nothing yet';
        lines.push(`  ${p.label} (pid ${p.pid})${p.idle ? ' idle' : ''} - last action: ${last}`);
      }
      lines.push('  input is serialised within this data directory; shared Sidecar conversations are not identified');
    }
    if (h && Number(h.pid) !== this.pid) lines.push(`input lease: held by ${h.label} for ${h.op}`);
    if (this.leaseless) lines.push('input lease: UNAVAILABLE - input actions are refused.');
    return lines.join('\n');
  }

  // Pre-approval for one consequential control in one app (both already
  // normalised by Policy.preApproval), until the session ends.
  preApprove(app, control, rec = {}) {
    const entry = { ...rec, app: String(app), control: String(control), at: this.now(), session_id: this.sessionId };
    this.preApprovals.set(`${entry.app}\n${entry.control}`, entry);
    return entry;
  }

  preApproved(app, control) {
    return this.preApprovals.get(`${app}\n${control}`) || null;
  }

  listPreApprovals() {
    return [...this.preApprovals.values()];
  }

  // Ends every pre-approval, or only one app's. Returns how many ended.
  endPreApprovals(app = null) {
    let n = 0;
    for (const [k, v] of this.preApprovals) {
      if (app == null || v.app === app) { this.preApprovals.delete(k); n++; }
    }
    return n;
  }

  close() {
    this.endPreApprovals();
    this._release();
    try { fs.unlinkSync(this.file); } catch {}
  }
}
