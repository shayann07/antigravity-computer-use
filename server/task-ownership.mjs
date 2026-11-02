import {randomBytes,timingSafeEqual} from 'node:crypto';
const readOnly=new Set(['computer_status','computer_apps','computer_stop','computer_pause','computer_controls','computer_prepare_update']);
const denied=(code,message)=>{throw Object.assign(Error(message),{code});};
// A bearer capability coordinates cooperating clients; it is not proof of a
// host conversation identity and cannot isolate hostile same-account processes.
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
  // Recovery is evidence verification only; no new task may adopt an old grant.
  if(name==='computer_end'&&!this.owner&&state?.recovered_task===true)return;
  if(this.owner&&!this.owner.used&&this.now()>this.owner.until)this.owner=null;
  const owner=this.owner;
  if(!owner)denied('task_required','Run ready once and use its task_token with --task on subsequent task commands.');
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||token.length!==64||!timingSafeEqual(Buffer.from(token),Buffer.from(owner.token)))denied('task_owned','This call does not own the current task. Wait for its owner to end it; emergency Stop remains available.');
  owner.used=true;
 }
 ended(){this.owner=null;}
}
