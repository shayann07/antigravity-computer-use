import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import net from 'node:net';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {briefReply,encodeReply,MAX_BRIEF_REPLY_BYTES} from '../scripts/terminal-reply.mjs';
import {testDirectory,projectRoot} from './paths.mjs';

const rows=Array.from({length:90},(_,i)=>`${i+1} Button "Control ${i+1} می\u200cخواهم 👩🏽‍💻 ${'value '.repeat(5)}"`);
const observed=()=>({ok:true,input_completed:true,receipt:{id:'123.4',elapsed_ms:7},metadata:{hwnd:17,observation_id:'fresh-frame',tree:rows.join('\n'),tree_incomplete:false},image:{path:'inert-not-a-screenshot.jpg',width:100,height:100}});
const wire=value=>{const encoded=encodeReply(briefReply(value));assert(encoded.length<=MAX_BRIEF_REPLY_BYTES);assert(!/[^\x00-\x7f]/.test(encoded));return JSON.parse(encoded.slice(0,4096));};

test('a long multilingual observation stays parseable through the observed host output cap',()=>{
 const original=observed(),before=structuredClone(original);
 assert(encodeReply(original).length>4096);assert.throws(()=>JSON.parse(encodeReply(original).slice(0,4096)));
 const result=wire(original);assert.equal(result.observation_id,'fresh-frame');assert.equal(result.hwnd,17);
 assert.equal(result.input_completed,true);assert.deepEqual(result.receipt,original.receipt);assert.deepEqual(result.image,original.image);
 assert.equal(result.tree_incomplete,true);assert.equal(result.terminal_tree_truncated,true);
 assert(result.tree.includes(rows[0]));assert(result.tree.includes(rows.at(-1)));
 for(const line of result.tree.split('\n'))assert(rows.includes(line)||/^\[\d+ display lines omitted; use snapshot --query\]$/.test(line),'No control label may be cut or index invented');
 assert.deepEqual(original,before);assert.deepEqual(JSON.parse(encodeReply(original)),before,'full JSON remains lossless');
});

test('small observations retain native incompleteness and exact Unicode without terminal omissions',()=>{
 for(const incomplete of [true,false]){
  const text='17 Edit "می\u200cخواهم 👩🏽‍💻"';const result=wire({ok:true,metadata:{observation_id:'id',hwnd:17,tree:text,tree_incomplete:incomplete}});
  assert.equal(result.tree,text);assert.equal(result.tree_incomplete,incomplete);assert.equal(result.terminal_tree_truncated,undefined);
 }
});

test('whole oversized lines are omitted without suppressing reachable tail controls',()=>{
 const result=wire({ok:true,metadata:{observation_id:'id',hwnd:17,tree:'1 Text "'+'字'.repeat(10000)+'"\n2 Button "Save"\n3 Button "Cancel"'}});
 assert(result.tree.includes('2 Button "Save"'));assert(result.tree.includes('3 Button "Cancel"'));assert(!result.tree.includes('字'));assert.equal(result.tree_incomplete,true);
});

test('tree compaction preserves unknown delivery, verification failure and batch cancellation evidence',()=>{
 const native={...observed(),ok:false,delivery_unknown:true,cancellation_requested:true,verification_error:{code:'capture_failed'},error:{code:'input_outcome_unknown'},failed_index:0,completed:[],skipped:7};
 const result=wire(native);for(const key of ['ok','delivery_unknown','cancellation_requested','input_completed','failed_index','skipped'])assert.equal(result[key],native[key]);
 assert.deepEqual(result.completed,[]);assert.deepEqual(result.verification_error,native.verification_error);assert.deepEqual(result.error,native.error);
});

test('an oversized non-tree envelope reports incomplete presentation without denying known input or replaying it',()=>{
 const native={...observed(),state:'stopped',control_reason:'escape',delivery_unknown:true,cancellation_requested:true,error:{code:'control_stopped',message:'private '.repeat(5000)},batch:{failed_index:0,skipped:7,completed:[]}};
 const result=wire(native);assert.equal(result.ok,true);assert.equal(result.input_completed,true);assert.equal(result.delivery_unknown,true);assert.equal(result.cancellation_requested,true);
 assert.equal(result.state,'stopped');assert.equal(result.control_reason,'escape');assert.equal(result.error.code,'control_stopped');assert.equal(result.terminal_reply_error.code,'terminal_reply_too_large');
 assert.deepEqual(result.batch_summary,{failed_index:0,skipped:7,completed_steps:0});assert.equal(result.batch_details_omitted,true);
 assert.equal(result.observation_id,undefined);assert.equal(result.observation_valid,false);assert.equal(result.image_omitted,true);assert.equal(result.replay_allowed,false);
 assert.equal(result.next_action,'inspect_effect_without_replay');assert(!JSON.stringify(result).includes('private'));
});

test('brief size bounds include all escaped error/state fields and oversized raw data',()=>{
 const native={ok:false,tree:'x',result:{text:'sensitive '.repeat(10000)},receipt:{id:'9'.repeat(10000)+'.1'}};
 for(const key of ['state','control_reason','permission_mode','build_id','build_version','incident_id','diagnostic_error'])native[key]='x'.repeat(128);
 for(const key of ['input_completed','delivery_unknown','cancellation_requested','ready','task_open','recovered_task','controls_visible','guardian_running','repeated_failure','diagnostic_pending','ended','restart_required','matched','changed','timed_out','aborted','incomplete'])native[key]=true;
 native.error={code:'x'.repeat(100)};native.verification_error={code:'y'.repeat(100)};
 const result=wire(native);assert.equal(result.delivery_unknown,true);assert.equal(result.input_completed,true);assert.equal(result.terminal_reply_incomplete,true);assert.equal(result.result,undefined);assert.equal(result.receipt,undefined);
});

test('the actual CLI emits bounded brief JSON and lossless explicit JSON over an inert IPC fixture',async t=>{
 assert(!fs.existsSync(path.join(projectRoot,'desktop-policy.json')),'Do not run against an installed deployment');
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'terminal-reply-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
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
  child.once('error',reject);child.once('close',code=>{clearTimeout(timer);code===0?resolve(output):reject(Error(error));});
 });
 const brief=await run(['--hwnd','17']);assert(brief.trim().length<=MAX_BRIEF_REPLY_BYTES);assert.equal(JSON.parse(brief.slice(0,4096)).tree_incomplete,true);
 const full=await run(['--json','--hwnd','17']);assert(full.length>4096);assert.deepEqual(JSON.parse(full),native);
 assert.equal(requests,2,'only the two intentional read-only snapshots may run');assert.deepEqual(fs.readdirSync(dir),['desktop-session.json'],'no private reply archives or native helpers are created');
});
