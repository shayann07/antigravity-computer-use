import {testDirectory} from './paths.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import {parseArguments,parseRunArguments} from '../scripts/arguments.mjs';import {TOOLS,validate} from '../server/desktop-tools.mjs';
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {pathToFileURL} from 'node:url';
const parse=(command,words,options)=>{const name='computer_'+command;const args=parseArguments(TOOLS.find(t=>t.name===name).inputSchema,words,options);validate(name,args);return args;};
test('named native action flags need no request file and preserve explicit frame/permission boundaries',()=>{
 const args=parse('click',['--hwnd','123','--observation-id','fresh','--index','7','--risk','routine','--reason','Open settings']);
 assert.deepEqual(args,{hwnd:123,observation_id:'fresh',index:7,risk:'routine',reason:'Open settings',observe:{with_image:false}});
 for(const extra of ['--confirmed','--preapprove','--mode','--takeover-mode'])assert.throws(()=>parse('click',['--hwnd','123',extra,'true']));
 assert.throws(()=>parse('click',['--hwnd','123','--index','7','--reason','Missing frame']));
});
test('named observation flags preserve actual image opt-in and bounded native ranges',()=>{
 assert.deepEqual(parse('snapshot',['--hwnd','123','--no-image','--query','JPEG','--settle-ms','600']),{hwnd:123,with_image:false,query:'JPEG',settle_ms:600});
 const args=parse('scroll',['--hwnd','123','--observation-id','f','--index','2','--amount','-3','--reason','Scroll','--image','--query','Output']);
 assert.deepEqual(args.observe,{with_image:true,query:'Output'});assert.equal(args.amount,-3);
 assert.deepEqual(parse('click',['--hwnd','123','--observation-id','f','--index','2','--reason','test','--observe','{"settle_ms":600}']).observe,{with_image:false,settle_ms:600});
 assert.throws(()=>parse('snapshot',['--hwnd','123','--settle-ms','2001']));
 assert.throws(()=>parse('snapshot',['--hwnd','true']));
});
test('UTF-8 text files and batch files do not require shell-embedded private content',()=>{
 const text='اردو — می\u200cخواهم 😀';let reads=0;
 const args=parse('paste',['--hwnd','123','--observation-id','f','--index','2','--text-file','D:/generated.txt','--reason','Paste owned sample'],{read:file=>{reads++;assert.equal(file,'D:/generated.txt');return text;}});
 assert.equal(args.text,text);assert.equal(reads,1);
 const run=parse('run',['--hwnd','123','--observation-id','f','--steps-file','D:/steps.json','--reason','Predictable steps'],{read:()=>JSON.stringify([{kind:'key',keys:'tab'}])});assert.equal(run.steps.length,1);
 assert.throws(()=>parse('type',['--hwnd','123','--observation-id','f','--text-file','x','--reason','Too long'],{read:()=>'a'.repeat(401)}));
});
test('legacy JSON requests remain unchanged; duplicate/unknown/ambiguous flags refuse before dispatch',()=>{
 const original={hwnd:123,observation_id:'f',index:7,reason:'Click'};
 assert.deepEqual(parse('click',[JSON.stringify(original)]),original);
 assert.deepEqual(parse('click',['--request','file'],{read:()=>JSON.stringify(original)}),original);
 for(const words of [['--hwnd'],['--hwnd','123','--hwnd','456'],['--request','file','--index','7'],['--unknown','x']])assert.throws(()=>parse('click',words));
 assert.throws(()=>parse('paste',['--hwnd','123','--observation-id','f','--text','x','--text-file','file','--reason','Ambiguous'],{read:()=>''}));
 for(const flags of [['--observe','{}','--query','x'],['--query','x','--observe','{}']])assert.throws(()=>parse('click',['--hwnd','123','--observation-id','f','--reason','test',...flags]),/not both/);
 assert.throws(()=>parse('drag',['--hwnd','123','--observation-id','f','--reason','test','--from','1,','--to','2,3']),/empty array/);
});

test('file-picker clipboard entry is explicit and cannot manufacture confirmation',()=>{
 const words=['--hwnd','123','--observation-id','fresh','--path','D:/Tests/new.txt','--action','save','--reason','Save with explicit temporary clipboard'];
 const plain=parse('file_dialog',words);assert(!Object.hasOwn(plain,'entry_method'));
 assert.equal(parse('file_dialog',[...words,'--entry-method','clipboard']).entry_method,'clipboard');
 for(const value of ['auto','confirmed','true'])assert.throws(()=>parse('file_dialog',[...words,'--entry-method',value]));
 assert.throws(()=>parse('file_dialog',[...words,'--entry-method','clipboard','--confirmed','true']));
});

const batchSchema=TOOLS.find(t=>t.name==='computer_run').inputSchema;
test('named section queries are tree-only unless an image is explicitly requested',()=>{
 const schema=TOOLS.find(t=>t.name==='computer_snapshot').inputSchema;
 const base=['--hwnd','123','--query','Export format','--reason','Inspect section'];
 assert.equal(parseArguments(schema,base).with_image,false);
 assert.equal(parseArguments(schema,[...base,'--image']).with_image,true);
 assert.equal(parseArguments(schema,['--hwnd','123']).with_image,undefined);
 assert.equal(parseArguments(schema,['{"hwnd":123,"query":"Export format"}']).with_image,undefined);
});
const describe=name=>({inputSchema:TOOLS.find(t=>t.name==='computer_'+name).inputSchema});
test('named batch groups need no plan file and retain fresh-frame and explicit image boundaries',()=>{
 const a=parseRunArguments(batchSchema,['--hwnd','123','--observation-id','f','--reason','Import owned image','--step','click','--index','7','--risk','routine','--step','file_dialog','--path','D:/cat.png','--action','open','--entry-method','clipboard'],describe,{read(){throw Error('No file should be read');}});
 validate('computer_run',a);assert.equal(a.steps.length,2);assert.equal(a.steps[0].observe.with_image,false);assert.equal(a.steps[1].observe.with_image,true);assert.equal(a.steps[1].entry_method,'clipboard');
 const save=parseRunArguments(batchSchema,['--hwnd','123','--observation-id','f','--reason','Save document','--step','click','--index','8','--risk','routine','--step','file_dialog','--path','D:/result.txt','--action','save','--entry-method','clipboard','--settle-ms','600'],describe);
 validate('computer_run',save);assert.equal(save.steps[1].action,'save');assert.equal(save.steps[1].entry_method,'clipboard');
 for(const tail of [['--step'],['--step','click','--hwnd','999'],['--step','click','--confirmed','true']])assert.throws(()=>parseRunArguments(batchSchema,['--hwnd','123','--observation-id','f','--reason','No partial dispatch',...tail],describe));
 assert.throws(()=>parseRunArguments(batchSchema,['--steps','[]','--step','click','--index','7'],describe),/Do not mix/);
 assert.throws(()=>parseRunArguments(batchSchema,Array.from({length:9},()=>['--step','key','--keys','tab']).flat(),describe),/at most eight/);
});

test('named batches cross actual Windows PowerShell without JSON quoting or Unicode path loss',{skip:process.platform!=='win32'},()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'agcu-batch-')),file=path.join(dir,'parse.mjs');
 try{
  fs.writeFileSync(file,`import {parseRunArguments} from ${JSON.stringify(pathToFileURL(path.resolve('scripts/arguments.mjs')).href)};import {describeCommand,encodeReply} from ${JSON.stringify(pathToFileURL(path.resolve('scripts/desktop.mjs')).href)};console.log(encodeReply(parseRunArguments(describeCommand('run').inputSchema,process.argv.slice(2),describeCommand)));`);
  const quote=s=>"'"+s.replaceAll("'","''")+"'",sample="D:/Samples/cat's 100% & اردو 😀.png";
  const script=`& ${quote(process.execPath)} ${quote(file)} --hwnd 123 --observation-id fresh --reason 'Import sample' --step click --index 7 --risk routine --step file_dialog --path ${quote(sample)} --action open --entry-method clipboard`;
  const ps=path.join(process.env.WINDIR||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  const r=spawnSync(ps,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,encoding:'utf8'});assert.equal(r.status,0,r.stderr);const a=JSON.parse(r.stdout);assert.equal(a.steps[1].path,sample);assert.equal(a.steps[1].observe.with_image,true);assert.equal(a.hwnd,123);
 }finally{fs.unlinkSync(file);fs.rmdirSync(dir);}
});
test('out-of-range arguments are fixable, not a diagnostics lockout (#151)',async()=>{
 const {recoveryAdvice}=await import('../server/recovery.mjs');
 let error;try{parse('click',['--hwnd','123','--observation-id','fresh','--index','7','--risk','routine','--reason','Start','--settle-ms','2400']);}catch(e){error=e;}
 assert.equal(error?.code,'bad_arguments');
 assert.match(error.message,/0 to 2000.*no input was sent/);
 const advice=recoveryAdvice({ok:false,error:{code:error.code,message:error.message}},'click');
 assert.equal(advice.next_action,'fix_arguments_and_retry');
 assert.equal(advice.replay_allowed,true);
});
