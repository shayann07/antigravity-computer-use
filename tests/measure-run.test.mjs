import test from 'node:test';import assert from 'node:assert/strict';
import {measureRun,parseReceiptTimestamp} from '../scripts/measure-run.mjs';
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {testDirectory} from './paths.mjs';
const since='2026-10-24T07:00:00.000Z';
const record=(id,seconds,elapsed_ms=100)=>({id,at:`2026-10-24T07:00:${String(seconds).padStart(2,'0')}.000Z`,elapsed_ms,command:'computer_snapshot',ok:true,gap_ms:999999});
test('explicit task boundary excludes later diagnostic polling and other processes',()=>{
 const rows=[record('10.1',1),record('11.1',2),{...record('10.2',3),verification_error:'window_not_found'},record('10.3',55)];
 const result=measureRun(rows,{pid:10,since,through:'10.2'});
 assert.equal(result.calls,2);assert.equal(result.wall_ms,3100);assert.equal(result.service_ms,200);
 assert.equal(result.max_gap_ms,1900);assert.equal(result.verification_failures,1);assert.equal(result.tool_failures,0);
});
test('missing boundary and invalid durations refuse rather than emit misleading statistics',()=>{
 assert.throws(()=>measureRun([record('10.1',1)],{pid:10,since,through:'10.2'}),/missing/);
 assert.throws(()=>measureRun([record('10.1',1,-1)],{pid:10,since,through:'10.1'}),/duration/);
 assert.throws(()=>measureRun([],{pid:10,since:'invalid',through:'10.1'}));
});
test('even-length timing samples use the midpoint of the two central values',()=>{
 const result=measureRun([record('10.1',1,100),record('10.2',3,300),record('10.3',7,500)],{pid:10,since,through:'10.3'});
 assert.equal(result.median_service_ms,300);assert.equal(result.median_gap_ms,2800);
 const pair=measureRun([record('10.1',1,100),record('10.2',3,300)],{pid:10,since,through:'10.2'});
 assert.equal(pair.median_service_ms,200);
});
test('missing and duplicate receipt sequences cannot look like a complete trace',()=>{
 const first=record('10.1',1),last=record('10.3',7);
 assert.equal(measureRun([first,last],{pid:10,since,through:'10.3'}).missing_sequences,1);
 assert.throws(()=>measureRun([first,{...first},last],{pid:10,since,through:'10.3'}),/Duplicate/);
});

test('the first receipt must be explicit and present before trace coverage can be assessed',()=>{
 const rows=[record('10.1',1),record('10.2',2),record('10.3',3)];
 assert.equal(measureRun(rows,{pid:10,since,through:'10.3'}).first_boundary_verified,false);
 const report=measureRun(rows,{pid:10,since,first:'10.2',through:'10.3'});
 assert.equal(report.calls,2);assert.equal(report.first_boundary_verified,true);assert.equal(report.first,'10.2');
 assert.throws(()=>measureRun(rows.slice(1),{pid:10,since,first:'10.1',through:'10.3'}),/First task receipt is missing/);
});

test('malformed selected timestamps and sequences are refused, not silently omitted',()=>{
 assert.throws(()=>measureRun([record('10.1',1),{...record('10.2',2),at:'invalid'},record('10.3',3)],{pid:10,since,through:'10.3'}),/timestamp/);
 assert.throws(()=>measureRun([record('10.01',1)],{pid:10,since,through:'10.1'}),/sequence/);
 for(const value of ['10.1','2026-02-30T00:00:00Z','not-a-date'])assert(Number.isNaN(parseReceiptTimestamp(value)));
 assert.equal(parseReceiptTimestamp('2026-10-24T12:00:00+05:00'),Date.parse(since));
});

test('clock regression and unknown outcomes are visible and outside-service attribution is withheld',()=>{
 const rows=[record('10.1',3),{...record('10.2',1),ok:undefined},record('10.3',4)];
 const report=measureRun(rows,{pid:10,since,first:'10.1',through:'10.3'});
 assert.equal(report.clock_regression,true);assert.equal(report.unknown_outcomes,1);assert.equal(report.outside_service_ms,null);
 const clean=measureRun([record('10.1',1)],{pid:10,since,first:'10.1',through:'10.1'});
 assert.equal(clean.outside_service_ms,1000);
});

test('receipt command groups cannot mutate object prototypes',()=>{
 assert.throws(()=>measureRun([{...record('10.1',1),command:'__proto__'}],{pid:10,since,through:'10.1'}),/command/);
 const report=measureRun([{...record('10.1',1),command:'constructor'}],{pid:10,since,through:'10.1'});
 assert.equal(Object.getPrototypeOf(report.groups),null);assert.equal(report.groups.constructor.count,1);
 assert.equal(Object.hasOwn(Object.prototype,'service_ms'),false);
});

test('run reports retain build identities and flag missing identities',()=>{
 const rows=[{...record('10.1',1),build_id:'1'.repeat(64)},{...record('10.2',2),build_id:'2'.repeat(64)},record('10.3',3)];
 const result=measureRun(rows,{pid:10,since,first:'10.1',through:'10.3'});
 assert.deepEqual(result.build_ids,['1'.repeat(64),'2'.repeat(64)]);assert.equal(result.unknown_builds,1);
});

test('measurement CLI preserves existing evidence and accepts an explicit first receipt',()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'measure-cli-'));
 try{
  const input=path.join(dir,'receipts.jsonl'),output=path.join(dir,'report.json');fs.writeFileSync(input,JSON.stringify(record('10.1',1))+'\n');
  const script=path.resolve('scripts/measure-run.mjs'),args=[input,'10',since,'10.1'];
  const created=spawnSync(process.execPath,[script,...args,output,'--first','10.1'],{windowsHide:true,encoding:'utf8'});
  assert.equal(created.status,0,created.stderr);assert.equal(JSON.parse(fs.readFileSync(output)).first_boundary_verified,true);
  const retained=fs.readFileSync(output);const again=spawnSync(process.execPath,[script,...args,output],{windowsHide:true,encoding:'utf8'});
  assert.notEqual(again.status,0);assert.deepEqual(fs.readFileSync(output),retained);
  const original=fs.readFileSync(input);const overwrite=spawnSync(process.execPath,[script,...args,input],{windowsHide:true,encoding:'utf8'});
  assert.notEqual(overwrite.status,0);assert.deepEqual(fs.readFileSync(input),original);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
