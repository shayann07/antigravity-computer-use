import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {EventEmitter} from 'node:events';
import {ensureHost} from './build.mjs';
import path from 'node:path';

export class Guardian extends EventEmitter {
  constructor(env,{spawnProcess=spawn,host=ensureHost,bootTimeout=10000,shutdownGrace=3000,killTimeout=3000}={}) { super(); this.env=env; this.spawnProcess=spawnProcess;this.host=host;this.bootTimeout=bootTimeout;this.shutdownGrace=shutdownGrace;this.killTimeout=killTimeout; this.pending=new Map(); this.seq=0; this.state='idle'; }
  async start() {
    if(this.starting)return this.starting;
    if(this.closing||this.cleanupFailed||this.pipeFailed||this.proc&&!this.initialized)throw Object.assign(Error('Previous local controls have not exited. Inspect diagnostics before starting another.'),{code:'guardian_cleanup_unconfirmed'});
    if(this.proc&&this.initialized) return;
    this.starting=this.boot();
    try{await this.starting;}finally{this.starting=null;}
  }
  async boot() {
    this.expectedIdleExit=false;
    this.everStarted=true;
    const {exe}=this.host();
    const proc=this.spawnProcess(exe,['--guardian'],{windowsHide:true,env:{...process.env,...this.env,AGCU_GUARDIAN:'1'},stdio:['pipe','pipe','pipe']});this.proc=proc;this.initialized=false;
    this.stderr='';proc.stderr.on('data',d=>{if(this.proc===proc)this.stderr=(this.stderr+d).slice(-2048);});
    proc.stdin.on('error',()=>{
      if(this.proc!==proc||this.closing||this.expectedIdleExit||this.pipeFailed)return;
      this.pipeFailed=true;this.state='stopped';
      // A successful write only queues bytes; an asynchronous pipe error can
      // still mean Stop or another request was never delivered to the guardian.
      // Invalidate control immediately instead of waiting for request timeouts.
      try{this.emit('state','stopped','guardian_unresponsive');}catch{}
      for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Object.assign(Error('Local controls pipe failed; delivery and Stop are unconfirmed. Inspect status and do not replay.'),{code:'guardian_write_failed'}));}this.pending.clear();
      if(!this.initialized){clearTimeout(this.bootTimer);this.bootReject(failure('guardian_start_failed','Local controls pipe failed during startup. Inspect diagnostics before retrying.'));try{proc.kill();}catch{}}
    });
    const failure=(code,message)=>Object.assign(Error(message),{code});
    const boot=new Promise((resolve,reject)=>{
      this.ready=resolve;this.bootReject=reject;
      this.bootTimer=setTimeout(()=>{reject(failure('guardian_start_timeout','Local controls did not become ready. Use diagnostics; do not repeat startup.'));proc.kill();},this.bootTimeout);
    });
    createInterface({input:proc.stdout}).on('line',line=>{
      if(this.proc!==proc||this.pipeFailed)return;
      let m;try{m=JSON.parse(line);}catch{return;}
      if(m.ev==='ready'){clearTimeout(this.bootTimer);this.initialized=true;this.pid=m.pid;this.ready();}
      if(m.ev==='error'){clearTimeout(this.bootTimer);this.bootReject(failure(m.code==='desktop_context_unavailable'?m.code:'guardian_start_failed',m.message));proc.kill();}
      if(m.ev==='state'){this.state=m.state;this.customCursor=m.custom_cursor;this.emit('state',m.state,m.reason);}
      if(m.ev==='human_resume'||m.ev==='host_resume')this.emit('resume',m.state,m.ev);
      if(m.ev==='human_end'&&m.state==='stopped')this.emit('human_end');
      if(m.ev==='settings'){this.takeoverMode=m.takeover_mode;this.emit('settings',m);}
      const p=this.pending.get(m.id);if(p){this.pending.delete(m.id);clearTimeout(p.timer);p.resolve(m);}
    });
    proc.on('close',(code,signal)=>{
      if(this.proc!==proc)return;
      clearTimeout(this.bootTimer);this.lastExit={code,signal};this.bootReject(failure('guardian_exited','Local controls exited before readiness. Run diagnostics; restarting cannot clear Stop.'));this.initialized=false;
      this.proc=null;this.cleanupFailed=false;this.pipeFailed=false;this.state=this.expectedIdleExit?'idle':'stopped';this.emit('state',this.state,this.expectedIdleExit?'normal_shutdown':'guardian_exited');
      for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Permission UI closed'));}this.pending.clear();
    });
    proc.on('error',e=>{if(this.proc!==proc)return;clearTimeout(this.bootTimer);this.bootReject(failure('guardian_spawn_failed',e.message));});
    await boot;
  }
  send(m){if(!this.pipeFailed&&this.proc&&!this.proc.killed&&!this.proc.stdin.destroyed){this.proc.stdin.write(JSON.stringify(m)+'\n');return true;}return false;}
  async request(m,{timeoutMs,existingProcess}={}){
    if(existingProcess){
      if(this.proc!==existingProcess||!this.initialized||this.pipeFailed||this.closing)throw Object.assign(Error('The original native controls are not available; Stop remains unconfirmed.'),{code:'guardian_stop_unconfirmed'});
    }else await this.start();
    const id=++this.seq;
    return new Promise((resolve,reject)=>{
      const defaultTimeout=m.op==='prompt'?95000:10000;
      const timeout=Number.isFinite(timeoutMs)&&timeoutMs>0?Math.min(defaultTimeout,Math.max(100,Math.floor(timeoutMs))):defaultTimeout;
      const requestStop=()=>{
        try{this.send({op:'stop'});}catch{}
        // Do not leave the JS controller active when a broken pipe or missing
        // acknowledgement makes native Stop delivery uncertain. The Runtime
        // invalidates frames and aborts its driver on this stopped event.
        this.state='stopped';try{this.emit('state','stopped','guardian_unresponsive');}catch{}
      };
      const timer=setTimeout(()=>{this.pending.delete(id);requestStop();reject(Object.assign(new Error('Local controls did not answer; Stop was attempted but is unconfirmed. Inspect status and do not replay.'),{code:'guardian_request_timeout'}));},timeout);
      this.pending.set(id,{resolve,reject,timer});
      try{if(this.send({...m,id})===false)throw Error('guardian pipe unavailable');}
      catch{clearTimeout(timer);this.pending.delete(id);requestStop();reject(Object.assign(new Error('Delivery to local controls is unconfirmed; Stop was attempted but is unconfirmed. Inspect status and do not replay.'),{code:'guardian_write_failed'}));}
    });
  }
  async prompt(m){return this.request({op:'prompt',...m});}
  get requiresStopAcknowledgement(){
    if(!this.proc&&!this.starting&&!this.cleanupFailed&&!this.pipeFailed&&this.expectedIdleExit&&this.lastExit?.code===0&&this.lastExit.signal==null)return false;
    return !!(this.everStarted||this.proc||this.starting||this.cleanupFailed||this.pipeFailed);
  }
  async stopAcknowledged(nonce,{timeoutMs=5000}={}){
    if(typeof nonce!=='string'||nonce.length!==32||!/^[a-f0-9]{32}$/.test(nonce))throw Error('Invalid internal Stop nonce');
    const proc=this.proc;
    if(!proc||!this.initialized||this.pipeFailed||this.cleanupFailed||this.closing)throw Object.assign(Error('No original native controls can acknowledge Stop. No replacement was started.'),{code:'guardian_stop_unconfirmed'});
    const reply=await this.request({op:'stop',stop_nonce:nonce},{timeoutMs,existingProcess:proc});
    if(this.proc!==proc||this.pipeFailed||!this.initialized||reply.stop_nonce!==nonce||reply.state!=='stopped'||reply.guardian_pid!==proc.pid||reply.guard_file!==path.basename(this.env.AGCU_GUARD_FILE||'')||reply.workers_stopped!==true||reply.input_cleanup_confirmed!==true)
      throw Object.assign(Error('Native Stop acknowledgement did not match this request, process and cleanup context.'),{code:'guardian_stop_unconfirmed'});
    return reply;
  }
  async endAcknowledged(nonce,{timeoutMs=5000}={}){
    if(typeof nonce!=='string'||nonce.length!==32||!/^[a-f0-9]{32}$/.test(nonce))throw Error('Invalid internal End nonce');
    const proc=this.proc;
    const unconfirmed=()=>Object.assign(Error('Native End cleanup was not confirmed by the original controls process.'),{code:'guardian_end_unconfirmed'});
    if(!proc||!this.initialized||this.pipeFailed||this.cleanupFailed||this.closing)throw unconfirmed();
    const reply=await this.request({op:'end',end_nonce:nonce},{timeoutMs,existingProcess:proc});
    if(this.proc!==proc||this.pipeFailed||!this.initialized||reply.end_nonce!==nonce||!['idle','paused','stopped'].includes(reply.state)||reply.guardian_pid!==proc.pid||reply.guard_file!==path.basename(this.env.AGCU_GUARD_FILE||'')||reply.workers_stopped!==true||reply.input_cleanup_confirmed!==true||reply.controls_visible!==false)throw unconfirmed();
    return reply;
  }
  async close({normal=false}={}){
    if(this.closing)return this.closing;
    const proc=this.proc;if(!proc)return;
    this.expectedIdleExit=normal;
    this.closing=new Promise((resolve,reject)=>{
      let grace,deadline;
      const done=()=>{clearTimeout(grace);clearTimeout(deadline);resolve();};
      proc.once('close',done);
      grace=setTimeout(()=>{
        deadline=setTimeout(()=>{proc.removeListener('close',done);this.cleanupFailed=true;reject(Object.assign(Error('Local controls did not confirm exit. Keep the controller for recovery.'),{code:'guardian_cleanup_unconfirmed'}));},this.killTimeout);
        try{proc.kill();}catch{}
      },this.shutdownGrace);
      try{this.send({op:'shutdown'});proc.stdin.end();}catch{}
    });
    try{await this.closing;}finally{this.closing=null;}
  }
}
