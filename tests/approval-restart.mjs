import {testDirectory} from './paths.mjs';
// Hands-on check of the access prompt's app row and the guardian's saved
// approvals. A person answers two prompts; no input is sent to any app.
//
//   node tests/approval-restart.mjs
//
// 1. Notepad opens and a prompt asks for it: look at the row, click Allow.
// 2. The guardian is restarted and asked again: no prompt may appear.
// 3. A new conversation asks: a prompt must appear. Click Deny.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawn,spawnSync} from 'node:child_process';import {randomUUID} from 'node:crypto';
import {Guardian} from '../server/guardian.mjs';
if(process.platform!=='win32'){console.log('Windows only.');process.exit(0);}
const dir=fs.mkdtempSync(path.join(testDirectory('approval-restart'),'run-'));const file=path.join(dir,'guard.state');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
fs.writeFileSync(file,'idle||0|');fs.writeFileSync(file+'.inputs','');
const env={AGCU_GUARD_FILE:file,AGCU_PARENT_PID:String(process.pid),CU_OVERLAY:'off',CU_PRESENCE:'off',AGCU_PERMISSION_MODE:'standalone'};
const start=async()=>{const g=new Guardian(env);await g.start();return g;};
const stop=async g=>{const p=g.proc;g.close();for(let i=0;i<50&&p&&p.exitCode===null&&p.signalCode===null;i++)await delay(100);};
const notepad=spawn('notepad.exe',[],{detached:true,stdio:'ignore'});notepad.unref();await delay(2500);
const found=spawnSync('powershell',['-NoProfile','-Command','(Get-Process notepad | Where-Object {$_.MainWindowHandle -ne 0} | Sort-Object StartTime -Descending | Select-Object -First 1).MainWindowHandle'],{encoding:'utf8',windowsHide:true});
const hwnd=Number(found.stdout.trim());assert(Number.isSafeInteger(hwnd)&&hwnd>0,'No Notepad window was found.');
const ask=(g,handle,remembered)=>g.request({op:'prompt',kind:'app',hwnd,tier:'full',session_handle:handle,...(remembered?{remembered:true}:{}),card:1,
 task:'Hands-on check of the access prompt. No input is sent.',notice:'This is a test prompt from tests/approval-restart.mjs.',message:'Allow this application for this session?\r\n\r\nNotepad\r\nHands-on check.'});
const conversation=randomUUID();let guardian;
try{
 guardian=await start();
 console.log('1. A prompt for Notepad is on screen. Check the row (name, "Full control", "Until you start a new conversation"), then click Allow.');
 const first=await ask(guardian,conversation,false);assert.equal(first.decision,'allowed','Step 1 needs Allow. Got '+first.decision);
 const same=await ask(guardian,conversation,true);assert.equal(same.decision,'remembered','The same guardian must not ask twice.');
 const saved=JSON.parse(fs.readFileSync(path.join(dir,'guardian-approvals.json'),'utf8'));
 assert.equal(saved.schema,1);assert.equal(Object.values(saved.sessions[conversation].apps)[0],'full','The saved record holds the app and its tier.');
 await stop(guardian);guardian=await start();
 console.log('2. The guardian was restarted. No prompt should appear now.');
 const began=Date.now();const after=await ask(guardian,conversation,true);
 assert.equal(after.decision,'remembered','A restarted guardian must remember the approval.');assert(Date.now()-began<3000,'A remembered approval must not wait on a prompt.');
 console.log('3. A new conversation asks. A prompt must appear: click Deny.');
 const other=await ask(guardian,randomUUID(),true);assert.equal(other.decision,'denied','A new conversation must ask, and step 3 needs Deny. Got '+other.decision);
 console.log('PASS: the row was shown, the approval survived a guardian restart, and a new conversation asked again.');
}finally{
 if(guardian)await stop(guardian);
 fs.rmSync(dir,{recursive:true,force:true});
 console.log('Close the Notepad window this opened.');
}
