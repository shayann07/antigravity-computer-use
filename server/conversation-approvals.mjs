// Approvals that last for an agent's conversation (session_handle), kept in
// private storage so a controller restart, an update or an idle shutdown does
// not ask the human again for every app. Only the executable key and access
// tier are stored; never titles, paths of documents or any screen content.
// A handle expires after APPROVAL_IDLE_MS without use. Native guardians keep
// their own record of what the human approved and do not trust this file.
import fs from 'node:fs';
import {writeAtomicJSON} from './atomic-json.mjs';

export const APPROVAL_IDLE_MS=24*60*60*1000;
export const MAX_CONVERSATIONS=64;
export const MAX_APPS_PER_CONVERSATION=64;
const MAX_BYTES=256*1024;
const HANDLE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TIERS=new Set(['full','click','read']);

// Returns Map<handle,{seen:number,apps:Map<executableKey,tier>}>. A missing
// file is empty. A damaged, linked or oversized file is ignored, so the human
// is asked again rather than trusting it.
export function loadConversationApprovals(file,{now=Date.now(),io=fs}={}){
  const sessions=new Map();
  let entry;
  try{entry=io.lstatSync(file);}catch{return sessions;}
  if(!entry.isFile()||entry.isSymbolicLink()||entry.nlink!==1||entry.size>MAX_BYTES)return sessions;
  let value;
  try{value=JSON.parse(io.readFileSync(file,'utf8'));}catch{return sessions;}
  if(value?.schema!==1||typeof value.sessions!=='object'||value.sessions===null||Array.isArray(value.sessions))return sessions;
  for(const [handle,record] of Object.entries(value.sessions)){
    if(!HANDLE.test(handle)||!Number.isSafeInteger(record?.seen)||record.seen>now+60000||now-record.seen>APPROVAL_IDLE_MS)continue;
    if(typeof record.apps!=='object'||record.apps===null||Array.isArray(record.apps))continue;
    const apps=new Map();
    for(const [key,tier] of Object.entries(record.apps)){
      if(apps.size>=MAX_APPS_PER_CONVERSATION)break;
      if(typeof key==='string'&&key.length>0&&key.length<=4096&&!key.includes('\0')&&TIERS.has(tier))apps.set(key,tier);
    }
    sessions.set(handle,{seen:record.seen,apps});
  }
  return pruneConversationApprovals(sessions,now);
}

export function pruneConversationApprovals(sessions,now=Date.now()){
  const live=[...sessions].filter(([,record])=>now-record.seen<=APPROVAL_IDLE_MS).sort((a,b)=>b[1].seen-a[1].seen).slice(0,MAX_CONVERSATIONS);
  return new Map(live);
}

export function saveConversationApprovals(file,sessions,{now=Date.now(),io=fs}={}){
  const kept=pruneConversationApprovals(sessions,now);
  const out={};
  for(const [handle,record] of kept){
    if(!HANDLE.test(handle))continue;
    out[handle]={seen:record.seen,apps:Object.fromEntries([...record.apps].filter(([,tier])=>TIERS.has(tier)).slice(0,MAX_APPS_PER_CONVERSATION))};
  }
  writeAtomicJSON(file,{schema:1,sessions:out},{io});
  try{io.chmodSync(file,0o600);}catch{}
  return kept;
}
