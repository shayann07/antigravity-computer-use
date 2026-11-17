// Owns the long-lived host process and the line-delimited JSON protocol that
// runs over its stdio. One host per Computer Use session keeps AutomationElement
// references alive between calls, which is what makes a tree lookup cost
// milliseconds instead of re-walking from the desktop root every action.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { ensureHost } from './build.mjs';
import {verifyNativeContract} from './platform.mjs';

// A lost response after submitting any of these operations cannot establish
// whether the target changed, even if the operation uses accessibility APIs.
const EFFECTFUL = new Set(['move','click','type','set_value','key','scroll','drag','focus','fit_window','resize_window','close_window','paste','paste_files','clipboard','open','file_dialog','launch']);
const unknownOutcome = () => new HostError('input_outcome_unknown',
  'The native worker did not confirm the operation; its effect is unknown.',
  'Inspect the target before continuing. Do not repeat the operation automatically.');

export class HostError extends Error {
  constructor(code, message, hint) {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

export class Driver {
  constructor({ timeoutMs = 30000, onLog = () => {}, env = null, onEvent = null } = {}) {
    this.timeoutMs = timeoutMs;
    this.onEvent = onEvent;
    this.onLog = onLog;
    // Extra environment for the host - which overlay slot this session owns, and
    // what to call it on screen when more than one Claude is running.
    this.env = env;
    this.proc = null;
    this.seq = 0;
    this.epoch = 0;
    this.pending = new Map();
    this.ready = null;
    this.info = null;
    this.stderr = [];
    this.starting = null;
    this.inputMayBeHeld = false;
    this.retiring = null;
    this.exitTimeoutMs = 1000;
    this.aborting = null;
  }

  async start() {
    if (this.aborting) await this.aborting;
    if (this.inputMayBeHeld) throw new HostError('input_cleanup_failed','Automation-held input cleanup is unconfirmed. Complete cleanup before starting another native operation.','Do not repeat the interrupted action.');
    if (this.starting) return this.starting;
    if (this.proc && !this.proc.killed && this.info) return this.info;
    // Defer launch until the shared promise is assigned, even for sync failures.
    const attempt = Promise.resolve().then(() => this._launch());
    this.starting = attempt;
    try { return await attempt; }
    finally { if (this.starting === attempt) this.starting = null; }
  }

  workerFailed(proc,err){
    if(this.proc!==proc)return;
    this.proc=null;this.info=null;this.ready=null;
    // An 'error' event does not prove the process exited. Preserve its handle
    // and require confirmed termination before another worker may start.
    const mayBeLive=Number.isSafeInteger(proc.pid)&&proc.pid>0&&proc.exitCode==null&&proc.signalCode==null;
    if(this.inputMayBeHeld||mayBeLive){this.retiring=proc;this.inputMayBeHeld=true;this.abort().catch(()=>{});}
    this._failAll(err);
  }

  _launch() {
    this.epoch++;
    return new Promise((resolve, reject) => {
      let exe;
      try { exe = ensureHost({ log: this.onLog }).exe; }
      catch (err) { reject(new HostError(err.code || 'build_failed', err.message, err.hint)); return; }
      const proc = spawn(exe, [], {
        stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
        env: this.env ? { ...process.env, ...this.env } : process.env,
      });
      this.proc = proc;
      let settled = false;
      let bootTimer;
      const fail = (err) => {
        clearTimeout(bootTimer);
        this.workerFailed(proc,err);
        if (!settled) { settled = true; reject(err); }
      };
      createInterface({ input: proc.stdout }).on('line', line => { if (this.proc === proc) this._onLine(line); });
      proc.stdin.on('error', err => this.onLog('host stdin: ' + err.message));
      proc.stderr.on('data', d => {
        this.stderr.push(d.toString());
        if (this.stderr.length > 50) this.stderr.shift();
        this.onLog('host stderr: ' + d.toString().trim());
      });
      proc.on('error', err => fail(new HostError('host_spawn_failed', err.message,
        'Try a forced rebuild: node server/build.mjs --force')));
      proc.on('exit', (code, signal) => fail(new HostError('host_exited',
        'Host process exited (code=' + code + ' signal=' + signal + ').',
        'The next call will start a fresh host.')));
      // 45 s, not 20: on 2026-09-28, with the CPU near 85%, a host that is
      // normally ready in under a second took more than 20 s about one start
      // in five, and every one of those failed its first call.
      bootTimer = setTimeout(() => {
        fail(new HostError('host_timeout', 'Host did not report ready within 45s.',
          this.stderr.join('').slice(-500) || 'Try a forced rebuild: node server/build.mjs --force'));
        try { proc.kill(); } catch {}
      }, 45000);
      this.ready = info => {
        if (settled || this.proc !== proc) return;
        try {verifyNativeContract(info);}catch(error){fail(new HostError(error.code,error.message,null));try{proc.kill();}catch{}return;}
        if(info.desktop_context?.interactive===false){
          fail(new HostError('desktop_context_unavailable','The native controller is not attached to the visible input desktop. No app action was executed.','Start the installed local controller from your normal Windows desktop, then reconnect through the skill. A host-isolated terminal cannot supply interactive desktop control. Do not switch desktops, use WMI or relax host security as recovery. Locked/secure desktops require the human.'));
          try{proc.kill();}catch{}return;
        }
        settled = true; clearTimeout(bootTimer);
        this.info = info; this.ready = null;
        resolve(info);
      };
    });
  }

  _onLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      // Stray host output (a PowerShell warning, a progress line) is logged
      // rather than dropped, so a protocol break is diagnosable.
      this.onLog('unparseable host line: ' + trimmed.slice(0, 300));
      return;
    }
    if (msg.event === 'ready') {
      if (this.ready) this.ready(msg);
      return;
    }
    // Anything else the host volunteers - an appshot hotkey, say - goes to
    // the server's event handler and never touches the request queue.
    if (msg.event) {
      try { if (this.onEvent) this.onEvent(msg); }
      catch (e) { this.onLog('event handler: ' + (e && e.message ? e.message : e)); }
      return;
    }
    const entry = this.pending.get(msg.id);
    if (!entry) {
      this.onLog('response for unknown id: ' + msg.id);
      return;
    }
    this.pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.ok) {
      if (entry.input) this.inputMayBeHeld = false;
      entry.resolve({ result: msg.result, ms: msg.ms });
    } else {
      const e = msg.error || {};
      const error=new HostError(e.code || 'host_error', e.message || 'Unknown host error', e.hint);
      // Cleanup failure and uncertain action delivery can both be true. Keep
      // the cleanup error so the controller remains stopped, and carry the
      // delivery uncertainty separately to prevent an automatic replay.
      if(entry.effectful&&error.code==='input_cleanup_failed')error.delivery_unknown=true;
      if(entry.input) this.abort().then(()=>entry.reject(error),cleanupError=>{
        if(entry.effectful)cleanupError.delivery_unknown=true;
        entry.reject(cleanupError);
      });
      else entry.reject(error);
    }
  }

  _failAll(err) {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(entry.effectful ? unknownOutcome() : err);
    }
    this.pending.clear();
  }

  async call(op, args = {}, { timeoutMs } = {}) {
    await this.start();
    if(args.__worker_epoch!=null&&args.__worker_epoch!==this.epoch)throw new HostError('stale_observation','The native worker restarted before execution. Observe again; no input was sent.',null);
    const id = ++this.seq;
    const payload = JSON.stringify({ id, op, args }) + '\n';
    const limit = timeoutMs || this.timeoutMs;
    const effectful = EFFECTFUL.has(op);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.abort().catch(() => {});
        reject(effectful ? unknownOutcome() : new HostError('op_timeout', `Operation '${op}' exceeded ${limit}ms.`,
          'The target app may be busy or showing a modal dialog.'));
      }, limit);

      // file_dialog can type a path/chord. A failure or hard worker exit during
      // it needs the same independent held-input recovery as ordinary typing.
      const input = ['move','click','type','set_value','key','scroll','drag','paste','paste_files','focus','fit_window','resize_window','file_dialog'].includes(op);
      if (input) this.inputMayBeHeld = true;
      this.pending.set(id, { resolve, reject, timer, input, effectful });

      try {
        this.proc.stdin.write(payload);
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        // The write can throw after a partial delivery. Even operations that do
        // not hold keyboard/mouse input (such as launch or close) must retire
        // the worker before another operation can start.
        if (effectful) this.abort().catch(() => {});
        reject(effectful ? unknownOutcome() : new HostError('host_write_failed', err.message));
      }
    });
  }

  async abort() {
    if(this.aborting)return this.aborting;
    const attempt=Promise.resolve().then(()=>this._abort());this.aborting=attempt;
    try{return await attempt;}finally{if(this.aborting===attempt)this.aborting=null;}
  }
  async _abort() {
    this.epoch++;
    const p=this.retiring||this.proc;
    const recover=this.inputMayBeHeld;
    this.proc=null; this.info=null; this.ready=null;
    this._failAll(new HostError('control_cancelled','Native worker was cancelled; observe again.',null));
    if(p){
      this.retiring=p;
      const exited=await new Promise(resolve=>{
        if(p.exitCode!=null||p.signalCode!=null){resolve(true);return;}
        let done=false;const finish=value=>{if(done)return;done=true;clearTimeout(timer);p.removeListener('exit',onExit);p.removeListener('error',onError);resolve(value);};
        const onExit=()=>finish(true),onError=()=>finish(false);p.once('exit',onExit);p.once('error',onError);
        const timer=setTimeout(()=>finish(p.exitCode!=null||p.signalCode!=null),this.exitTimeoutMs??1000);
        try{p.stdin?.destroy();}catch{}try{p.kill();}catch{}
        if(p.exitCode!=null||p.signalCode!=null)finish(true);
      });
      if(!exited){
        // Still attempt independent release, but never accept its success as
        // proof that a possibly live worker cannot send more input.
        this.inputMayBeHeld=true;try{this.onEvent?.({event:'input_cleanup_failed'});}catch{}
        try{await this.releaseHeldInputs();}catch{}
        throw new HostError('input_cleanup_failed','Native worker exit is unconfirmed. Control must remain stopped.','Do not repeat the interrupted action.');
      }
      this.retiring=null;
    }
    if (!recover) return;
    let released=false;
    try{released=await this.releaseHeldInputs();}catch(error){this.onLog('input recovery: '+error.message);}
    if(!released){
      try{this.onEvent?.({event:'input_cleanup_failed'});}catch{}
      throw new HostError('input_cleanup_failed','Automation-held input cleanup could not be confirmed. Control must remain stopped.','Use the local controls only after cleanup succeeds; do not repeat the interrupted action.');
    }
    this.inputMayBeHeld=false;
  }
  async releaseHeldInputs(){
    const {exe}=ensureHost();
    return new Promise(resolve=>{let settled=false;const finish=ok=>{if(settled)return;settled=true;clearTimeout(t);resolve(ok);};const helper=spawn(exe,['--release-inputs'],{windowsHide:true,stdio:'ignore',env:{...process.env,...this.env}});const t=setTimeout(()=>{helper.kill();finish(false);},4000);helper.on('exit',code=>finish(code===0));helper.on('error',()=>finish(false));});
  }
  async stop() {
    if (!this.proc) return;
    this.epoch++;
    const p = this.proc;
    try {
      // Ask the host to leave on its own before forcing it.
      await Promise.race([
        this.call('shutdown', {}, { timeoutMs: 1500 }).catch(() => {}),
        new Promise((r) => setTimeout(r, 1500)),
      ]);
    } catch {}
    // Computer Use never terminates a process it did not spawn. This is its own host.
    try { if (!p.killed) p.kill(); } catch {}
    this.proc = null;
    this.info = null;
  }
}
