import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {testDirectory} from './paths.mjs';import {macToolProbe,publishMacBundle,checkMacStorageBuild} from '../server/macos-build.mjs';

test('Mac storage compiler reports timeout, spawn failure and silent exit distinctly',()=>{
 checkMacStorageBuild({status:0});
 assert.throws(()=>checkMacStorageBuild({status:null,error:{code:'ETIMEDOUT'}}),e=>e.code==='macos_storage_build_timeout');
 assert.throws(()=>checkMacStorageBuild({status:null,error:{code:'ENOENT'}}),e=>e.code==='macos_storage_build_spawn_failed');
 assert.throws(()=>checkMacStorageBuild({status:null,signal:'SIGKILL'}),e=>e.code==='macos_storage_build_failed'&&/SIGKILL.*no compiler output/.test(e.message));
});
import {spawn,spawnSync} from 'node:child_process';
test('Mac tool lookup distinguishes a timeout from unavailable tools',()=>{
 assert.equal(macToolProbe({status:0,stdout:' /usr/bin/swiftc\n'},'compiler'),'/usr/bin/swiftc');
 assert.throws(()=>macToolProbe({status:null,error:{code:'ETIMEDOUT'}},'compiler'),e=>e.code==='macos_toolchain_probe_timeout'&&/may still be installed/.test(e.message));
 assert.throws(()=>macToolProbe({status:null,error:{code:'ENOENT'}},'SDK'),e=>e.code==='macos_toolchain_probe_failed');
 assert.throws(()=>macToolProbe({status:1,stdout:''},'compiler'),e=>e.code==='macos_toolchain_unavailable');
 assert.throws(()=>macToolProbe({status:0,stdout:' '},'SDK'),e=>e.code==='macos_toolchain_unavailable');
});
test('concurrent macOS builds publish one verified signed bundle',{skip:process.platform!=='darwin',timeout:300000},async()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'mac-compile-race-'));
 const script=`import {ensureHost} from ${JSON.stringify(new URL('../server/build.mjs',import.meta.url).href)};const logs=[];const info=ensureHost({force:true,log:line=>logs.push(line)});console.log(JSON.stringify({...info,compile_requests:logs.filter(line=>line.startsWith('compiling host')).length}));`;
 const env={...process.env,AGCU_DATA_DIR:dir};delete env.CU_PLUGIN_DATA;delete env.CLAUDE_PLUGIN_DATA;
 const run=()=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['--input-type=module','-e',script],{env,stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);
  const timer=setTimeout(()=>child.kill('SIGKILL'),240000);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',code=>{clearTimeout(timer);if(code!==0)return reject(Error('Mac build failed: '+err));try{resolve(JSON.parse(out));}catch(error){reject(error);}});
 });
 try{
  const results=await Promise.allSettled([run(),run()]);for(const result of results)if(result.status==='rejected')throw result.reason;
  const [first,second]=results.map(result=>result.value);assert.equal(first.exe,second.exe);assert.notEqual(first.rebuilt,second.rebuilt);
  assert.equal(first.compile_requests+second.compile_requests,1,'Concurrent same-stamp requests must not run two expensive optimized compilers');
  const app=path.dirname(path.dirname(path.dirname(first.exe)));const check=spawnSync('/usr/bin/codesign',['--verify','--strict',app],{encoding:'utf8',timeout:30000});assert.equal(check.status,0,check.stderr);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Mac bundle publication preserves a verified winner and refuses an incomplete one',()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'mac-publish-'));
 try{
  const app=path.join(dir,'host.app'),stage=path.join(dir,'first.app');fs.mkdirSync(stage);fs.writeFileSync(path.join(stage,'marker'),'first');
  const verify=folder=>{if(fs.readFileSync(path.join(folder,'marker'),'utf8')!=='first')throw Error('invalid signature fixture');};
  assert.equal(publishMacBundle(stage,app,verify),true);verify(app);
  const second=path.join(dir,'second.app');fs.mkdirSync(second);fs.writeFileSync(path.join(second,'marker'),'second');
  assert.equal(publishMacBundle(second,app,verify),false);assert.equal(fs.readFileSync(path.join(app,'marker'),'utf8'),'first');assert(fs.existsSync(second));
  fs.writeFileSync(path.join(app,'marker'),'invalid');assert.throws(()=>publishMacBundle(second,app,verify),/invalid signature/);assert(fs.existsSync(second));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
