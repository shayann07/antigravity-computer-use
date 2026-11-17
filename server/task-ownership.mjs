import {randomBytes,timingSafeEqual} from 'node:crypto';
const readOnly=new Set(['computer_status','computer_apps','computer_stop','computer_controls','computer_prepare_update']);
const denied=(code,message)=>{throw Object.assign(Error(message),{code});};
// A bearer capability coordinates cooperating clients; it is not proof of a
// host conversation identity and cannot isolate hostile same-account processes.
// Model think time between actions has been measured above 12 minutes, so the
// takeover threshold sits well past the 10-minute orphaned hint.
export const ORPHAN_TAKEOVER_MS=30*60*1000;
export class TaskOwnership {
 constructor({now=()=>performance.now()}={}){this.now=now;this.owner=null;}
 claim(state){
  if(state?.recovered_task===true)denied('recovered_cleanup_unverified','A previous task survived restart. Inspect prior cleanup; do not acquire or replay its input.');
  if(this.owner&&!this.owner.used&&this.now()>this.owner.until)this.owner=null;
  if(this.owner||state?.task_open!==false||!['idle','stopped'].includes(state?.state))denied('task_owned','Another task or recovery record owns this controller. Do not end it or acquire its token.');
  const token=randomBytes(32).toString('hex');this.owner={token,used:false,until:this.now()+30000};return token;
 }
 authorize(name,token,state){
  if(readOnly.has(name))return;
  if(name==='computer_shutdown'&&state?.task_open===false&&!this.owner?.used)return;
  // Idempotent passive cleanup is safe when there is no task reservation,
  // open task, active control or grant to revoke. Never apply this to an owner.
  if(name==='computer_end'&&!this.owner&&state?.task_open===false&&['idle','stopped'].includes(state?.state)&&!state?.approved_apps?.length)return;
  // Recovery is evidence verification only; no new task may adopt an old grant.
  if(name==='computer_end'&&!this.owner&&state?.recovered_task===true)return;
  if(this.owner&&!this.owner.used&&this.now()>this.owner.until)this.owner=null;
  const owner=this.owner;
  if(!owner)denied('task_required','Run ready once and use its task_token with --task on subsequent task commands.');
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||token.length!==64||!timingSafeEqual(Buffer.from(token),Buffer.from(owner.token)))denied('task_owned','This call does not own the current task. Wait for its owner to end it; emergency Stop remains available.');
  owner.used=true;
 }
 // Who holds the task relative to this caller: self (token matches), other (a
 // different holder exists), unknown (open but unowned, e.g. recovered) or none.
 // A coordination aid only; the token is never echoed and this is not authentication.
 relation(token,state){
  if(this.owner&&!this.owner.used&&this.now()>this.owner.until)this.owner=null;
  if(!this.owner)return state?.task_open===true?'unknown':'none';
  return typeof token==='string'&&/^[a-f0-9]{64}$/.test(token)&&timingSafeEqual(Buffer.from(token),Buffer.from(this.owner.token))?'self':'other';
 }
 // A used capability is released only when its task is over in practice: a
 // human Stop ended it, or nothing has happened for ORPHAN_TAKEOVER_MS with no
 // grant and no input held. Age alone never transfers an active task (#7);
 // without this, a caller that vanished without End blocked everyone (#114).
 releasable(state,idleMs=ORPHAN_TAKEOVER_MS){
  if(!this.owner?.used||state?.recovered_task===true)return false;
  if(state?.state==='stopped')return true;
  return state?.task_liveness==='orphaned'&&Number(state?.last_activity_ms_ago)>idleMs
   &&!(state?.approved_apps?.length)&&state?.held_resources?.input_held!==true&&!(state?.held_resources?.grants>0);
 }
 ended(){this.owner=null;}
}
