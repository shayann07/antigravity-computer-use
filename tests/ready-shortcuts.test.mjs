import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {serveDesktop} from '../server/desktop-service.mjs';
import {BUILD_ID,VERSION} from '../server/version.mjs';
import {projectRoot,testDirectory} from './paths.mjs';

const execute=promisify(execFile);
const app='Fixture Reader';
const window={hwnd:37,pid:123456,title:app,process:app};

test('ready shortcuts through the CLI preserve ownership, frames and recovery',async t=>{
  const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'ready-shortcuts-'));
  let open=false,gate='discover_or_launch',launchFailure=false;
  const calls=[];
  const runtime={
    status:()=>({state:'idle',task_open:open,build_id:BUILD_ID,build_version:VERSION,permission_mode:'standalone'}),
    ready(args){
      calls.push('ready');
      assert.deepEqual(args,{session_handle:'conversation'});
      open=true;
      return {ready:gate!=='ask_human_before_resume',next_action:gate,session_handle:'conversation'};
    },
    launch(input){
      calls.push('launch');
      assert.deepEqual(input,{app,reason:'Read the sample',observe:true});
      if(launchFailure)throw Object.assign(Error('Launch acknowledgement unavailable'),{code:'input_outcome_unknown'});
      return {input_completed:true,metadata:{hwnd:window.hwnd,observation_id:'reader-frame',tree:['Sample document']}};
    },
    guardian:{},driver:{async call(op){assert.equal(op,'list_apps');calls.push('apps');return {result:{windows:[window]}};}},
    finish(){open=false;return {ended:true};},async close(){}
  };
  const service=await serveDesktop({directory:dir,runtime,requireTaskOwnership:true});
  t.after(async()=>{await service.shutdown();fs.rmSync(dir,{recursive:true,force:true});});
  const env={...process.env,AGCU_DATA_DIR:dir,AGCU_PERMISSION_MODE:'standalone'};
  delete env.CU_PLUGIN_DATA;
  delete env.CLAUDE_PLUGIN_DATA;
  let invocations=0;
  async function cli(words){
    invocations++;
    const args=[path.join(projectRoot,'scripts','desktop.mjs'),...words];
    try{return JSON.parse((await execute(process.execPath,args,{env,windowsHide:true,timeout:30000})).stdout);}
    catch(error){if(error.stdout)return JSON.parse(error.stdout);throw error;}
  }
  const start=['ready','--session-handle','conversation'];
  const launch=['--launch',app,'--reason','Read the sample'];
  const end=async token=>assert.equal((await cli(['--task',token,'end'])).ended,true);
  const conflict=await cli([...start,'--apps',...launch]);
  assert.equal(conflict.error.code,'bad_arguments');
  assert.deepEqual(calls,[]);

  for(const action of ['apps','launch']){
    const samples={separate:[],combined:[]};
    const measure=process.env.AGCU_BENCH_READY==='1';
    for(let trial=0;trial<(measure?6:1);trial++){
      for(const mode of trial%2?['combined','separate']:['separate','combined']){
        calls.length=0;
        const beforeCalls=invocations,before=performance.now();
        let ready,result;
        if(mode==='combined'){
          ready=result=await cli([...start,...(action==='apps'?['--apps']:launch)]);
        }else{
          ready=await cli(start);
          result=await cli(['--task',ready.task_token,...(action==='apps'?['apps']:['launch','--app',app,'--reason','Read the sample','--observe'])]);
        }
        samples[mode].push(Math.round(performance.now()-before));
        assert.equal(invocations-beforeCalls,mode==='combined'?1:2);
        assert.deepEqual(calls,['ready',action]);
        assert.equal(result.ok,true);
        assert.equal(ready.session_handle,'conversation');
        assert.ok(ready.task_command_prefix.endsWith('--task '+ready.task_token));
        if(action==='apps')assert.equal(result.windows[0].hwnd,window.hwnd);
        else{
          assert.equal(result.observation_id,'reader-frame');
          assert.equal(result.hwnd,window.hwnd);
          assert.deepEqual(result.tree,['Sample document']);
        }
        await end(ready.task_token);
      }
    }
    if(measure)t.diagnostic(action+' CLI wall milliseconds '+JSON.stringify(samples));
  }

  for(const next of ['ask_human_before_resume','inspect_diagnostics']){
    gate=next;
    for(const flags of [['--apps'],launch]){
      calls.length=0;
      const blocked=await cli([...start,...flags]);
      assert.equal(blocked.next_action,next);
      assert.deepEqual(calls,['ready']);
      await end(blocked.task_token);
    }
  }
  gate='discover_or_launch';
  launchFailure=true;
  calls.length=0;
  const unknown=await cli([...start,...launch]);
  assert.equal(unknown.ok,false);
  assert.equal(unknown.delivery_unknown,true);
  assert.equal(unknown.observe_before_continuing,true);
  assert.deepEqual(calls,['ready','launch']);
  assert.equal(unknown.session_handle,'conversation');
  await end(unknown.task_token);
});
