import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {EventEmitter} from 'node:events';
import {Runtime} from '../server/runtime.mjs';
import {loadConversationApprovals,saveConversationApprovals,APPROVAL_IDLE_MS,MAX_CONVERSATIONS} from '../server/conversation-approvals.mjs';
import {testDirectory} from './paths.mjs';

const handle=i=>`${String(i).padStart(8,'0')}-0000-4000-8000-000000000000`;
const scratch=name=>{const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),name+'-'));return {dir,file:path.join(dir,'conversation-approvals.json')};};

test('saved conversation approvals round-trip, expire after a day idle and keep the 64 most recent',()=>{
 const {dir,file}=scratch('approvals');
 try{
  const now=1_800_000_000_000;const sessions=new Map();
  for(let i=0;i<70;i++)sessions.set(handle(i),{seen:now-i*1000,apps:new Map([[`/Applications/A${i}.app/Contents/MacOS/A`,'full']])});
  sessions.set(handle(99),{seen:now-APPROVAL_IDLE_MS-1,apps:new Map([['/x','click']])});
  saveConversationApprovals(file,sessions,{now});
  assert.equal(fs.statSync(file).mode&0o777,0o600);
  const loaded=loadConversationApprovals(file,{now});
  assert.equal(loaded.size,MAX_CONVERSATIONS);assert(loaded.has(handle(0)));assert(!loaded.has(handle(69)));assert(!loaded.has(handle(99)));
  assert.equal(loaded.get(handle(0)).apps.get('/Applications/A0.app/Contents/MacOS/A'),'full');
  assert.equal(loadConversationApprovals(file,{now:now+APPROVAL_IDLE_MS+1}).size,0,'everything expires after a day idle');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('a damaged, linked or tampered approvals file is ignored, so the human is asked again',()=>{
 const {dir,file}=scratch('approvals-bad');
 try{
  const now=Date.now();
  for(const bad of ['not json','{"schema":2,"sessions":{}}','{"schema":1,"sessions":[]}'])
   {fs.writeFileSync(file,bad);assert.equal(loadConversationApprovals(file,{now}).size,0,bad);}
  fs.writeFileSync(file,JSON.stringify({schema:1,sessions:{'not-a-handle':{seen:now,apps:{'/x':'full'}},[handle(1)]:{seen:now,apps:{'/x':'admin','/y':'click'}},[handle(2)]:{seen:now+10*60000,apps:{'/z':'full'}}}}));
  const loaded=loadConversationApprovals(file,{now});
  assert.deepEqual([...loaded.keys()],[handle(1)]);assert.deepEqual([...loaded.get(handle(1)).apps],[['/y','click']]);
  fs.rmSync(file);fs.writeFileSync(file+'.real',JSON.stringify({schema:1,sessions:{[handle(3)]:{seen:now,apps:{'/x':'full'}}}}));fs.symlinkSync(file+'.real',file);
  assert.equal(loadConversationApprovals(file,{now}).size,0,'a symbolic link is not followed');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

function runtime(file){
 const guardian=new EventEmitter();guardian.send=()=>true;guardian.request=async m=>m.op==='activate'?{allowed:true}:{state:'idle',controls_visible:true};
 guardian.seen=[];guardian.prompt=async m=>{guardian.seen.push(m.remembered===true);return {allowed:true};};
 const driver={epoch:1,info:{pid:999},async abort(){},async call(){return {result:{ok:true}};}};
 const r=new Runtime({guardian,driver,sessions:{register(){},close(){},async withInput(_o,_t,run){return run();}},latchFile:null});
 r.approvalsFile=file;r.app=async()=>({hwnd:1,pid:11,started:'a',path:'/Applications/Calculator.app/Contents/MacOS/Calculator',process:'Calculator',title:'Calculator'});
 return r;
}
test('a restarted controller still recognises the conversation and marks its apps as approved',async()=>{
 const {dir,file}=scratch('approvals-restart');
 const first=runtime(file),second=runtime(file),third=runtime(file);
 try{
  const opened=await first.ready();await first.grant(1,'first');assert.deepEqual(first.guardian.seen,[false]);
  const again=await second.ready({session_handle:opened.session_handle});assert.equal(again.session_handle,opened.session_handle,'same conversation after restart');
  await second.grant(1,'after restart');assert.deepEqual(second.guardian.seen,[true],'the app is marked as already approved');
  const other=await third.ready();assert.notEqual(other.session_handle,opened.session_handle);
  await third.grant(1,'new conversation');assert.deepEqual(third.guardian.seen,[false],'a new conversation asks again');
  const saved=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.deepEqual(Object.values(saved.sessions[opened.session_handle].apps),['full']);
  for(const record of Object.values(saved.sessions))assert.deepEqual(Object.keys(record).sort(),['apps','seen'],'only the executable key, tier and last use are stored');
 }finally{for(const r of [first,second,third])fs.rmSync(r.guardFile,{force:true});fs.rmSync(dir,{recursive:true,force:true});}
});
