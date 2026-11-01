import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {setImmediate as flush} from 'node:timers/promises';
import {downloadFile,sha256} from '../server/update-core.mjs';
import {testDirectory} from './paths.mjs';

function fixture(t,content='abc'){
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'download-deadlines-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 t.mock.timers.enable({apis:['setTimeout']});
 const destination=path.join(dir,'payload');let stream,signal;
 const fetcher=async(_url,options)=>{
  signal=options.signal;
  return {ok:true,body:new ReadableStream({start(c){stream=c;signal.addEventListener('abort',()=>c.error(signal.reason),{once:true});}})};
 };
 const run=()=>downloadFile('fixture',destination,{size:content.length,hash:sha256(content),fetcher});
 return {destination,run,send:value=>stream.enqueue(Buffer.from(value)),close:()=>stream.close(),signal:()=>signal};
}

test('a progressing download can exceed the old 30-second total deadline',async t=>{
 const f=fixture(t);const result=f.run();await flush();
 for(const char of 'abc'){t.mock.timers.tick(20000);f.send(char);await flush();}
 f.close();await result;
 assert.equal(fs.readFileSync(f.destination,'utf8'),'abc');
 assert.equal(f.signal().aborted,false);assert(!fs.existsSync(f.destination+'.part'));
 t.mock.timers.tick(600000);assert.equal(f.signal().aborted,false,'completed transfer timers were cleared');
});

test('a stalled body aborts and removes partial bytes',async t=>{
 const f=fixture(t);const result=f.run();const rejected=assert.rejects(result,/update_download_timeout/);await flush();
 f.send('a');await flush();t.mock.timers.tick(30000);await rejected;
 assert(f.signal().aborted);assert(!fs.existsSync(f.destination));assert(!fs.existsSync(f.destination+'.part'));
});

test('progress cannot extend a download beyond the ten-minute total bound',async t=>{
 const content='abc'.repeat(10),f=fixture(t,content);const result=f.run();const rejected=assert.rejects(result,/update_download_timeout/);await flush();
 for(let index=0;index<29;index++){t.mock.timers.tick(20000);f.send(content[index]);await flush();}
 t.mock.timers.tick(20000);await rejected;
 assert(!fs.existsSync(f.destination));assert(!fs.existsSync(f.destination+'.part'));
});

test('empty chunks cannot keep a stalled download alive',async t=>{
 const f=fixture(t);const result=f.run();const rejected=assert.rejects(result,/update_download_timeout/);await flush();
 t.mock.timers.tick(20000);f.send('');await flush();t.mock.timers.tick(10000);await rejected;
 assert(!fs.existsSync(f.destination));assert(!fs.existsSync(f.destination+'.part'));
});

test('headers retain a separate 15-second bound',async t=>{
 const f=fixture(t);let signal;
 const result=downloadFile('fixture',f.destination,{size:0,hash:sha256(''),fetcher:(_url,options)=>new Promise((_resolve,reject)=>{signal=options.signal;signal.addEventListener('abort',()=>reject(signal.reason),{once:true});})});
 const rejected=assert.rejects(result,/update_download_timeout/);
 t.mock.timers.tick(15000);await rejected;assert(signal.aborted);assert(!fs.existsSync(f.destination+'.part'));
});

test('rename failure removes this transfer partial without touching the destination',async t=>{
 const f=fixture(t);fs.writeFileSync(f.destination,'previous');
 const io={...fs,renameSync(){throw Error('rename refused');}};
 await assert.rejects(downloadFile('fixture',f.destination,{size:3,hash:sha256('abc'),fetcher:async()=>({ok:true,body:(async function*(){yield Buffer.from('abc');})()}),io}),/rename refused/);
 assert.equal(fs.readFileSync(f.destination,'utf8'),'previous');assert(!fs.existsSync(f.destination+'.part'));
});

test('an existing partial from another attempt is never removed',async t=>{
 const f=fixture(t);fs.writeFileSync(f.destination+'.part','retained');
 await assert.rejects(downloadFile('fixture',f.destination,{size:3,hash:sha256('abc'),fetcher:async()=>({ok:true,body:(async function*(){yield Buffer.from('abc');})()})}),/EEXIST/);
 assert.equal(fs.readFileSync(f.destination+'.part','utf8'),'retained');assert(!fs.existsSync(f.destination));
});
