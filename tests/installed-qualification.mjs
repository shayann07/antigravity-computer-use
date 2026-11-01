// Developer qualification helpers. No desktop actions occur on import.
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {projectRoot,testRoot,testPath} from './paths.mjs';
import {readTaskRecord} from '../server/atomic-json.mjs';
const refuse=(code,message)=>{throw Object.assign(Error(message),{code});};

export function stopConfig(value){
 const keys=new Set(['installation','expected_build_id','hwnd','from','to','evidence','close_owned_window']);
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.has(key)))refuse('qualification_config_invalid','Use the documented qualification fields only.');
 if(typeof value.installation!=='string'||!path.isAbsolute(value.installation)||!/^[a-f0-9]{64}$/.test(value.expected_build_id||'')||!Number.isSafeInteger(value.hwnd)||value.hwnd<1)refuse('qualification_config_invalid','An absolute installation record, published build ID and current HWND are required.');
 for(const point of [value.from,value.to])if(!Array.isArray(point)||point.length!==2||point.some(n=>!Number.isSafeInteger(n)||n<0))refuse('qualification_config_invalid','Use integer coordinates from the inspected screenshot.');
 if(value.evidence!==undefined&&(typeof value.evidence!=='string'||!value.evidence.trim()))refuse('qualification_config_invalid','Evidence must be a project-local path.');
 if(value.close_owned_window!==undefined&&typeof value.close_owned_window!=='boolean')refuse('qualification_config_invalid','close_owned_window must be boolean.');
 const evidence=value.evidence===undefined?null:testPath(path.resolve(projectRoot,value.evidence));
 if(evidence!==null&&path.relative(testRoot,evidence)==='')refuse('qualification_config_invalid','Use a new evidence subdirectory.');
 return {...value,evidence,close_owned_window:value.close_owned_window===true};
}

function rejectLinkedAncestors(file){
 for(let cursor=file;;cursor=path.dirname(cursor)){
  try{if(fs.lstatSync(cursor).isSymbolicLink())refuse('qualification_evidence_link','Evidence cannot traverse a link.');}catch(error){if(error.code!=='ENOENT')throw error;}
  if(path.relative(projectRoot,cursor)==='')break;
  if(path.dirname(cursor)===cursor)refuse('qualification_evidence_outside','Evidence left the checkout.');
 }
}
export function newStopEvidence(config){
 if(config.evidence===null){const base=testPath('installed-stop-resume');rejectLinkedAncestors(base);fs.mkdirSync(base,{recursive:true});return fs.mkdtempSync(path.join(base,'run-'));}
 const target=testPath(config.evidence);rejectLinkedAncestors(target);
 fs.mkdirSync(path.dirname(target),{recursive:true});rejectLinkedAncestors(target);
 fs.mkdirSync(target,{mode:0o700});return target; // EEXIST preserves every prior run.
}

export function verifyQualificationRelease(release,expected){
 const manifest=JSON.parse(fs.readFileSync(path.join(release,'bundle-manifest.json')));
 if(!/^[a-f0-9]{64}$/.test(expected||'')||!manifest.files||typeof manifest.files!=='object'||Array.isArray(manifest.files)||manifest.build_id!==expected||createHash('sha256').update(JSON.stringify(manifest.files)).digest('hex')!==expected)refuse('qualification_build_mismatch','The selected release differs from the expected published build.');
 for(const [name,hash] of Object.entries(manifest.files)){
  if(!name||name.includes('\\')||name.includes(':')||path.isAbsolute(name)||name.split('/').some(part=>!part||part==='.'||part==='..')||!/^[a-f0-9]{64}$/.test(hash))refuse('qualification_manifest_invalid','Invalid sealed payload entry.');
  const file=path.join(release,name),stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==hash)refuse('qualification_payload_mismatch','A selected payload differs from its sealed identity.');
 }
 return manifest;
}

export function qualificationIdle(status,expected){
 if(status?.ok!==true||status.build_id!==expected)refuse('qualification_build_mismatch','Running and selected build identities differ.');
 if(status.permission_mode!=='host-managed'||status.private_data_storage!==true)refuse('qualification_policy_mismatch','The live service did not confirm the installed policy and private storage.');
 if(status.state!=='idle'||status.task_open!==false||status.recovered_task!==false||status.controller_ownership_lost!==false||!Array.isArray(status.approved_apps)||status.approved_apps.length)refuse('qualification_not_idle','Another task or an unconfirmed control state owns this installation. No app input was accepted.');
}
export function qualificationRequest(request,session,policy,command,args={}){
 if(policy.permission_mode!=='host-managed')refuse('qualification_policy_mismatch','This harness cannot bypass standalone native approvals.');
 return request(session,command,args,['status','stop','resume','end','controls'].includes(command)?10000:100000,policy.permission_mode);
}
export function physicalStopSteps(from,to){
 return [{kind:'drag',from,to,steps:120,risk:'routine'},...Array.from({length:7},()=>({kind:'move',x:to[0],y:to[1],risk:'routine'}))];
}
export function currentInputJournal(directory,pid){
 const record=readTaskRecord(path.join(directory,'task-state.json'));
 if(!Number.isSafeInteger(pid)||pid<1||!record.open||record.dispatched!==true||typeof record.guard!=='string'||!record.guard.startsWith('guard-'+pid+'-'))refuse('qualification_guard_unknown','The exact current task input fence could not be established.');
 return path.join(directory,record.guard+'.inputs');
}
export function qualificationLedger(file){
 const stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)refuse('qualification_ledger_unverified','Input cleanup cannot be verified from this ledger.');
 const text=fs.readFileSync(file,'utf8');if(text==='')return '';
 const lines=text.split(/\r?\n/);if(lines.at(-1)==='')lines.pop();
 if(!lines.length||lines.some(line=>!(/^(?:m:\d+|k:\d+:\d+:\d+)$/.test(line))))refuse('qualification_ledger_unverified','The native input ledger is malformed.');
 return text; // Missing, unreadable or whitespace-only files are never empty.
}

export async function finishQualification(call,{ownsTask,operationPending}){
 if(!ownsTask)return {cleanup_attempted:false};
 let confirmed=true;
 if(operationPending)try{if((await call('stop')).ok!==true)confirmed=false;}catch{confirmed=false;}
 try{const ended=await call('end');if(ended.ok!==true||ended.ended!==true)confirmed=false;}catch{confirmed=false;}
 return {cleanup_attempted:true,cleanup_unconfirmed:!confirmed};
}
