import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import net from 'node:net';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {briefReply,encodeReply} from '../scripts/desktop.mjs';
import {testDirectory,projectRoot} from './paths.mjs';

const tree=Array.from({length:90},(_,i)=>`${i+1} Button "Control ${i+1} می\u200cخواهم 👩🏽‍💻 ${'value '.repeat(5)}"`).join('\n');
const observed=()=>({ok:true,input_completed:true,receipt:{id:'123.4',elapsed_ms:7},metadata:{hwnd:17,observation_id:'fresh-frame',tree,tree_incomplete:true},image:{path:'inert-not-a-screenshot.jpg',width:100,height:100}});

test('brief output preserves the complete rendered tree, exact Unicode and native completeness',()=>{
 for(const incomplete of [true,false]){
  const native=observed();native.metadata.tree_incomplete=incomplete;const before=structuredClone(native);
  const result=JSON.parse(encodeReply(briefReply(native)));
  assert.equal(result.tree,tree);assert.equal(result.tree_incomplete,incomplete);assert.equal(result.observation_id,'fresh-frame');assert.equal(result.hwnd,17);
  assert.equal(result.input_completed,true);assert.deepEqual(result.receipt,native.receipt);assert.deepEqual(result.image,native.image);
  assert.equal(result.metadata,undefined);assert.deepEqual(native,before);assert.deepEqual(JSON.parse(encodeReply(native)),before);
 }
});

test('brief completeness never hides a pre-existing incomplete flag or input/cancellation evidence',()=>{
 const native={...observed(),ok:false,tree_incomplete:true,delivery_unknown:true,cancellation_requested:true,error:{code:'input_outcome_unknown'},verification_error:{code:'capture_failed'},failed_index:0,completed:[],skipped:7};
 native.metadata.tree_incomplete=false;
 const result=JSON.parse(encodeReply(briefReply(native)));
 assert.equal(result.tree_incomplete,true);assert.equal(result.tree,tree);
 for(const key of ['ok','input_completed','delivery_unknown','cancellation_requested','error','verification_error','failed_index','completed','skipped'])assert.deepEqual(result[key],native[key]);
});

test('the actual CLI retains native completeness and full content over inert IPC in both output modes',async t=>{
 assert(!fs.existsSync(path.join(projectRoot,'desktop-policy.json')),'Do not run against an installed deployment');
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'brief-reply-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const native=observed();let requests=0;
 const server=net.createServer(socket=>{socket.setEncoding('utf8');let data='';socket.on('data',chunk=>{
  data+=chunk;if(!data.includes('\n'))return;const request=JSON.parse(data.slice(0,data.indexOf('\n')));
  assert.equal(request.secret,'inert-test');assert.equal(request.command,'snapshot');assert.equal(request.expected_permission_mode,'standalone');requests++;
  socket.end(JSON.stringify(native)+'\n');
 });});
 await new Promise(resolve=>server.listen({host:'127.0.0.1',port:0},resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 fs.writeFileSync(path.join(dir,'desktop-session.json'),JSON.stringify({pid:process.pid,pipe:{host:'127.0.0.1',port:server.address().port},secret:'inert-test'}));
 const env={...process.env,AGCU_DATA_DIR:dir,AGCU_PERMISSION_MODE:'standalone'};delete env.CU_PLUGIN_DATA;delete env.CLAUDE_PLUGIN_DATA;
 const run=args=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[fileURLToPath(new URL('../scripts/desktop.mjs',import.meta.url)),'snapshot',...args],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',error='';
  const timer=setTimeout(()=>{child.kill();reject(Error('Inert CLI timed out'));},10000);child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>error+=data);
  child.once('error',reject);child.once('close',code=>{clearTimeout(timer);code===0?resolve(JSON.parse(output)):reject(Error(error));});
 });
 const brief=await run(['--hwnd','17']);assert.equal(brief.tree,tree);assert.equal(brief.tree_incomplete,true);assert.equal(brief.observation_id,'fresh-frame');
 const full=await run(['--json','--hwnd','17']);assert.deepEqual(full,native);
 assert.equal(requests,2,'only the two intentional read-only snapshots may run');assert.deepEqual(fs.readdirSync(dir),['desktop-session.json']);
});

test('CLI ready forwards session_handle to a running service so approved apps are not asked again',async t=>{
 assert(!fs.existsSync(path.join(projectRoot,'desktop-policy.json')),'Do not run against an installed deployment');
 const {VERSION,BUILD_ID}=await import('../server/version.mjs');
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'ready-handle-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const {storageOperation,ensureStorageGuard}=await import('../server/storage.mjs');fs.chmodSync(dir,0o700);storageOperation('data',dir,{helper:ensureStorageGuard()});
 const seen=[];
 const server=net.createServer(socket=>{socket.setEncoding('utf8');let data='';socket.on('data',chunk=>{
  data+=chunk;if(!data.includes('\n'))return;const request=JSON.parse(data.slice(0,data.indexOf('\n')));seen.push(request);
  socket.end(JSON.stringify(request.command==='status'?{ok:true,build_id:BUILD_ID,build_version:VERSION,permission_mode:'standalone'}:{ok:true,session_handle:request.args.session_handle??'new'})+'\n');
 });});
 await new Promise(resolve=>server.listen({host:'127.0.0.1',port:0},resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 fs.writeFileSync(path.join(dir,'desktop-session.json'),JSON.stringify({pid:process.pid,pipe:{host:'127.0.0.1',port:server.address().port},secret:'inert-test'}));
 const env={...process.env,AGCU_DATA_DIR:dir,AGCU_PERMISSION_MODE:'standalone'};delete env.CU_PLUGIN_DATA;delete env.CLAUDE_PLUGIN_DATA;
 const run=args=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[fileURLToPath(new URL('../scripts/desktop.mjs',import.meta.url)),'ready',...args],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',error='';
  const timer=setTimeout(()=>{child.kill();reject(Error('Inert CLI timed out'));},10000);child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>error+=data);
  child.once('error',reject);child.once('close',code=>{clearTimeout(timer);code===0?resolve(JSON.parse(output)):reject(Error(error+output));});
 });
 const handle='0f4d1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
 const later=await run(['--json','--session_handle',handle]);assert.equal(later.session_handle,handle);
 const fresh=await run(['--json']);assert.equal(fresh.session_handle,'new');
 const readies=seen.filter(r=>r.command==='ready');assert.equal(readies.length,2);
 assert.deepEqual(readies[0].args,{session_handle:handle});assert.deepEqual(readies[1].args,{});
});
