// Transport/ownership fixtures only: no compiler, native input or UI is run.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';
import {testDirectory} from './paths.mjs';import {macCompilerLease,waitForMacCompilerWinner} from '../server/macos-build.mjs';

function fixture(t,source){
 const base=fs.mkdtempSync(path.join(testDirectory('tmp'),'compiler-lease-'));const directory=path.join(base,'lease');fs.mkdirSync(directory);const script=path.join(base,'inert-helper.mjs');fs.writeFileSync(script,source);let child;
 const spawnProcess=(_helper,_args,options)=>child=spawn(process.execPath,[script],options);
 t.after(async()=>{
  if(child&&child.exitCode===null&&child.signalCode===null){const exited=new Promise(resolve=>child.once('close',resolve));child.stdin?.destroy();child.kill();await exited;}
  fs.rmSync(base,{recursive:true,force:true});
 });
 return {directory,base,spawnProcess,get child(){return child;}};
}

test('a synchronous source build requires the real lease acknowledgement and detects later loss',t=>{
 const f=fixture(t,"console.log(JSON.stringify({ok:true,lease_acquired:true,private_storage_verified:true,pid:process.pid}));process.stdin.resume();process.stdin.on('end',()=>process.exit(0));");
 const lease=macCompilerLease(f.directory,{helper:'inert',spawnProcess:f.spawnProcess});assert.equal(lease.acquired,true);lease.assertHeld();
 assert.deepEqual(fs.readdirSync(f.directory),[],'transport files must not contaminate a fresh native lease directory');
 const request=fs.readdirSync(f.base).find(name=>name.startsWith('.compiler-reply-'));
 fs.appendFileSync(path.join(f.base,request,'reply.jsonl'),'\n{"ok":false}\n');
 assert.throws(()=>lease.assertHeld(),e=>e.code==='macos_build_lease_lost');
 assert.equal(fs.readdirSync(f.base).some(name=>name.startsWith('.compiler-reply-')),false,'releasing a request removes its transport files');
});

test('a competing source builder is reported busy without starting another compiler',t=>{
 const f=fixture(t,"console.log(JSON.stringify({ok:false,error:{code:'service_already_running'}}));");
 const lease=macCompilerLease(f.directory,{helper:'inert',spawnProcess:f.spawnProcess});assert.equal(lease.acquired,false);lease.release();
});

test('missing acknowledgement has a bounded failure and cannot authorize compilation',t=>{
 const f=fixture(t,'process.stdin.resume();');
 assert.throws(()=>macCompilerLease(f.directory,{helper:'inert',spawnProcess:f.spawnProcess,startupMs:100}),e=>e.code==='macos_build_lease_timeout');
});

test('winner waiting returns only an independently accepted cache entry and never widens its bound',()=>{
 let checked=0;const verified={exe:'inert-verified-app',rebuilt:false};
 assert.equal(waitForMacCompilerWinner(()=>++checked===2?verified:null,{timeoutMs:500}),verified);assert.equal(checked,2);
 assert.throws(()=>waitForMacCompilerWinner(()=>{throw Error('invalid signature');},{timeoutMs:500}),/invalid signature/);
 assert.throws(()=>waitForMacCompilerWinner(()=>null,{timeoutMs:1}),e=>e.code==='macos_build_winner_timeout');
 for(const timeoutMs of [0,NaN,Infinity,150001])assert.throws(()=>waitForMacCompilerWinner(()=>assert.fail(),{timeoutMs}));
});
