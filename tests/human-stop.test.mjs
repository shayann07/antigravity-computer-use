import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Runtime,HUMAN_STOP_HOLD_MS} from '../server/runtime.mjs';
import {recoveryAdvice} from '../server/recovery.mjs';
import {landedCount} from '../server/plan-runner.mjs';

const stopped=(reason,at=Date.now())=>{
  const runtime=Object.create(Runtime.prototype);
  runtime.state='stopped';runtime.lastControlReason=reason;runtime.humanStop={reason,at};
  return runtime;
};

// Esc ends the native worker, so the call it interrupts used to come back as
// host_exited ("the next call will start a fresh host"), and an agent took
// that as a crash and called ready again 30 s after the human pressed Esc.
test('a call cut short by Esc reports the human stop, not a crash',()=>{
  const human=stopped('escape').humanStopError({code:'host_exited'});
  assert.equal(human.stopped_by_human,true);
  assert.equal(human.error.code,'control_stopped');
  assert.equal(human.error.interrupted,'host_exited');
  assert.match(human.error.message,/pressed Esc/);
  assert.match(human.error.message,/Do not call ready or retry/);
  assert.match(stopped('button').humanStopError({code:'host_exited'}).error.message,/pressed Stop/);
  assert.equal(stopped('hotkey').humanStopError({code:'input_outcome_unknown'}).error.code,'control_stopped');
});

test('only a stop a person caused is reported as a human stop',()=>{
  assert.equal(stopped('requested_stop').humanStopError({code:'host_exited'}),null,'an agent-sent stop is not the human');
  assert.equal(stopped('guardian_stop_unconfirmed').humanStopError({code:'host_exited'}),null);
  const active=stopped('escape');active.state='active';
  assert.equal(active.humanStopError({code:'host_exited'}),null);
});

test('the failure waits briefly for a stop that lands just after it',async()=>{
  const runtime=stopped('escape');runtime.state='active';runtime.lastControlReason='active';
  setTimeout(()=>{runtime.state='stopped';runtime.lastControlReason='escape';},60);
  const human=await runtime.awaitHumanStopError({code:'host_exited'},{waitMs:1000,stepMs:10});
  assert.equal(human?.error.code,'control_stopped');
  const started=Date.now();
  const plain=Object.create(Runtime.prototype);plain.state='active';plain.lastControlReason='active';
  assert.equal(await plain.awaitHumanStopError({code:'bad_points'},{waitMs:1000}),null);
  assert.ok(Date.now()-started<500,'an ordinary refusal never waits');
});

test('ready is held back for a while after a human stop',()=>{
  const now=Date.now();
  const hold=stopped('escape',now).humanStopHold(now+1000);
  assert.equal(hold.reason,'escape');
  assert.equal(hold.remaining,HUMAN_STOP_HOLD_MS-1000);
  assert.equal(stopped('escape',now).humanStopHold(now+HUMAN_STOP_HOLD_MS),null,'the hold ends');
  assert.equal(stopped('requested_stop',now).humanStopHold(now),null,'an agent-sent stop does not hold ready');
});

test('a human stop always means report and wait, even when delivery is unknown',()=>{
  const advice=recoveryAdvice({stopped_by_human:true,delivery_unknown:true,error:{code:'control_stopped'}});
  assert.equal(advice.next_action,'report_and_wait_for_human');
  assert.equal(advice.replay_allowed,false);
});

test('a plan step interrupted by a human stop is never replayed',()=>{
  assert.equal(landedCount({ok:false,failed_index:3,stopped_by_human:true,error:{code:'control_stopped'}},8),4);
  assert.equal(landedCount({ok:false,stopped_by_human:true,error:{code:'control_stopped'}},8),8);
});

// NSWorkspace.frontmostApplication is cached and the helper does not reliably
// receive the notifications that refresh it. It kept reading "TextEdit" while
// Claude was in front, so typing meant for TextEdit went into Claude.
test('no Mac input gate reads the cached front-most application',()=>{
  const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','server','native');
  const files=[path.join(root,'AxonHost.swift'),...fs.readdirSync(path.join(root,'macos')).filter(f=>f.endsWith('.swift')).map(f=>path.join(root,'macos',f))];
  for(const file of files){
    const code=fs.readFileSync(file,'utf8').split('\n').map(line=>line.replace(/\/\/.*$/,''));
    const hits=code.map((line,i)=>line.includes('frontmostApplication')?`${path.basename(file)}:${i+1}`:null).filter(Boolean);
    assert.deepEqual(hits,[],'use macFrontmostPid() or macWindowServerFrontPid()');
  }
});
