import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {testDirectory} from './paths.mjs';
import {compareRuns, loadRunReport, formatComparisonMarkdown,parseComparisonArguments,readReportText} from '../scripts/compare-runs.mjs';
import {spawnSync} from 'node:child_process';

// Shared synthetic context only; these unit tests are not benchmark evidence.
const context={workload:'fixture-export',measurement_scope:'receipt_interval',first_boundary_verified:true,missing_sequences:0,unknown_outcomes:0,overlapping_calls:false,clock_regression:false,benchmark:{platform:'win32',arch:'x64',agent_model:'fixture-model',host_version:'fixture-host',app_sha256:'a'.repeat(64),input_sha256:'b'.repeat(64),settings_sha256:'c'.repeat(64),hardware_sha256:'d'.repeat(64),engine_sha256:'e'.repeat(64),model_sha256:'f'.repeat(64)}};
context.build_ids=['1'.repeat(64)];context.unknown_builds=0;
const compareFixture=(before,after)=>compareRuns(before&&typeof before==='object'?{...context,...before}:before,after&&typeof after==='object'?{...context,...after}:after);

test('compareRuns computes correct deltas and percentages across matched runs with verified output', () => {
  const before = {
    pid: '100',
    from: '2026-10-24T10:00:00.000Z',
    through: '100.15',
    wall_ms: 269280,
    calls: 15,
    service_ms: 11893,
    median_service_ms: 450,
    median_gap_ms: 9500,
    tool_failures: 0,
    verification_failures: 0,
    success: true,
    output_verified: true,
    groups: {
      computer_snapshot: { count: 5, service_ms: 4500 },
      computer_click: { count: 8, service_ms: 3600 },
      computer_file_dialog: { count: 2, service_ms: 3793 },
    }
  };

  const after = {
    pid: '200',
    from: '2026-10-28T10:00:00.000Z',
    through: '200.10',
    wall_ms: 185000,
    calls: 10,
    service_ms: 9200,
    median_service_ms: 410,
    median_gap_ms: 9200,
    tool_failures: 0,
    verification_failures: 0,
    success: true,
    output_verified: true,
    groups: {
      computer_snapshot: { count: 3, service_ms: 2100 },
      computer_run: { count: 3, service_ms: 3800 },
      computer_click: { count: 4, service_ms: 3300 },
    }
  };

  const result = compareFixture(before, after);

  assert.equal(result.deltas.wall_ms, -84280);
  assert.equal(result.deltas.wall_pct, -31.3);
  assert.equal(result.deltas.calls, -5);
  assert.equal(result.deltas.calls_pct, -33.3);
  assert.equal(result.deltas.service_ms, -2693);
  assert.equal(result.deltas.median_gap_ms, -300);
  assert.equal(result.conclusion.faster, true);
  assert.equal(result.conclusion.pair_eligible, true);
  assert.equal(result.conclusion.release_speed_qualified, false);
  assert.equal(result.conclusion.scope, 'single_matched_pair_only');
  assert.equal(result.conclusion.qualification_status, 'matched_pair_speedup');
  assert.equal(result.conclusion.fewer_calls, true);
  assert.equal(result.conclusion.wall_savings_sec, 84.3);

  // Check command breakdown
  assert.equal(result.command_deltas.computer_snapshot.count_delta, -2);
  assert.equal(result.command_deltas.computer_run.count_delta, 3);
  assert.equal(result.command_deltas.computer_file_dialog.after_count, 0);
  assert.equal(result.command_deltas.computer_file_dialog.count_delta, -2);

  // Markdown formatting
  const md = formatComparisonMarkdown(result);
  assert.match(md, /Total Wall Time/);
  assert.match(md, /269,280 ms/);
  assert.match(md, /185,000 ms/);
  assert.match(md, /-84280 ms \(-31\.3%\)/);
  assert.match(md, /31\.3% shorter/);
  assert.match(md, /matched_pair_speedup/);
});

test('failed-but-shorter run with tool failure is disqualified and not reported as faster', () => {
  const before = {
    wall_ms: 1000,
    calls: 15,
    service_ms: 400,
    tool_failures: 0,
    verification_failures: 0,
    success: true,
    output_verified: true
  };

  const after = {
    wall_ms: 100,
    calls: 1,
    service_ms: 40,
    tool_failures: 1,
    verification_failures: 0,
    success: false,
    output_verified: false
  };

  const result = compareFixture(before, after);
  assert.equal(result.conclusion.faster, false, 'Failed task must NOT be reported as faster');
  assert.equal(result.conclusion.pair_eligible, false, 'Failed task must NOT be qualified');
  assert.equal(result.conclusion.qualification_status, 'disqualified_due_to_failure');
  assert.match(result.conclusion.summary, /shorter wall time cannot be claimed as an optimization/);

  const md = formatComparisonMarkdown(result);
  assert.doesNotMatch(md, /Run is 90% faster/, 'Markdown must not claim speedup on failed run');
  assert.match(md, /disqualified_due_to_failure/);
});

test('failed-but-shorter run with verification failure is disqualified', () => {
  const before = {
    wall_ms: 2000,
    calls: 5,
    service_ms: 500,
    tool_failures: 0,
    verification_failures: 0,
    success: true,
    output_verified: true
  };

  const after = {
    wall_ms: 500,
    calls: 2,
    service_ms: 100,
    tool_failures: 0,
    verification_failures: 1,
    success: false,
    output_verified: false
  };

  const result = compareFixture(before, after);
  assert.equal(result.conclusion.faster, false);
  assert.equal(result.conclusion.pair_eligible, false);
  assert.equal(result.conclusion.qualification_status, 'disqualified_due_to_failure');
});

test('missing success or completion evidence leaves run unqualified', () => {
  const before = { wall_ms: 1000, calls: 5, service_ms: 200, success: true, output_verified: true };
  const after = { wall_ms: 500, calls: 3, service_ms: 100 }; // Missing success and output_verified
  const result = compareFixture(before, after);
  assert.equal(result.conclusion.pair_eligible, false);
  assert.equal(result.conclusion.qualification_status, 'unqualified_missing_evidence');
  assert.equal(result.conclusion.faster, false);
});

test('unverified output leaves run unqualified despite zero failures', () => {
  const before = { wall_ms: 1000, calls: 5, service_ms: 200, success: true, output_verified: true };
  const after = { wall_ms: 500, calls: 3, service_ms: 100, success: true, output_verified: false };
  const result = compareFixture(before, after);
  assert.equal(result.conclusion.pair_eligible, false);
  assert.equal(result.conclusion.qualification_status, 'unqualified_missing_verification');
  assert.equal(result.conclusion.faster, false);
});

test('mismatched workloads are disqualified', () => {
  const before = { wall_ms: 1000, calls: 5, service_ms: 200, success: true, output_verified: true, workload: 'export_upscaly' };
  const after = { wall_ms: 500, calls: 3, service_ms: 100, success: true, output_verified: true, workload: 'open_notepad' };
  const result = compareFixture(before, after);
  assert.equal(result.matched_workload, false);
  assert.equal(result.conclusion.pair_eligible, false);
  assert.equal(result.conclusion.qualification_status, 'disqualified_mismatched_workload');
});

test('compareRuns validates inputs and rejects missing or non-numeric metrics', () => {
  assert.throws(() => compareFixture(null, {}), error => error.code === 'invalid_report');
  assert.throws(() => compareFixture({}, null), error => error.code === 'invalid_report');
  assert.throws(() => compareFixture({ wall_ms: 'invalid', calls: 1, service_ms: 10 }, { wall_ms: 100, calls: 1, service_ms: 10 }), error => error.code === 'invalid_report');
  assert.throws(() => compareFixture({ wall_ms: -50, calls: 1, service_ms: 10 }, { wall_ms: 100, calls: 1, service_ms: 10 }), error => error.code === 'invalid_report');
  assert.throws(() => compareFixture({ wall_ms: 100, calls: -1, service_ms: 10 }, { wall_ms: 100, calls: 1, service_ms: 10 }), error => error.code === 'invalid_report');
  assert.throws(() => compareFixture({ wall_ms: 100, calls: 1, service_ms: NaN }, { wall_ms: 100, calls: 1, service_ms: 10 }), error => error.code === 'invalid_report');
});

test('loadRunReport parses JSON report files correctly', () => {
  const dir = testDirectory('compare-runs');
  fs.mkdirSync(dir, { recursive: true });
  const reportFile = path.join(dir, 'test-report.json');
  try {
    const reportData = {
      pid: '300',
      from: '2026-10-28T12:00:00.000Z',
      through: '300.5',
      wall_ms: 50000,
      calls: 5,
      service_ms: 3000,
    };
    fs.writeFileSync(reportFile, JSON.stringify(reportData));
    const loaded = loadRunReport(reportFile);
    assert.equal(loaded.pid, '300');
    assert.equal(loaded.wall_ms, 50000);
    assert.equal(loaded.calls, 5);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

test('loadRunReport rejects raw receipts jsonl when explicit boundaries are missing', () => {
  const dir = testDirectory('compare-runs-raw');
  fs.mkdirSync(dir, { recursive: true });
  const receiptsFile = path.join(dir, 'receipts.jsonl');
  try {
    fs.writeFileSync(receiptsFile, '{"ts":"2026-10-28T00:00:00Z"}\n');
    assert.throws(() => loadRunReport(receiptsFile), error => error.code === 'missing_boundaries');
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

test('adversarial: completed: false is disqualified and never marked as success or faster', () => {
  const before = { wall_ms: 1000, calls: 5, service_ms: 200, success: true, output_verified: true };
  const after = { wall_ms: 200, calls: 2, service_ms: 50, completed: false, output_verified: true };
  const result = compareFixture(before, after);
  assert.equal(result.after.success, false);
  assert.equal(result.conclusion.faster, false);
  assert.equal(result.conclusion.pair_eligible, false);
  assert.equal(result.conclusion.qualification_status, 'disqualified_due_to_failure');
});

test('adversarial: before run failure disqualifies comparison even if after run succeeded', () => {
  const before = { wall_ms: 2000, calls: 10, service_ms: 500, tool_failures: 2, success: false, output_verified: false };
  const after = { wall_ms: 500, calls: 3, service_ms: 100, success: true, output_verified: true };
  const result = compareFixture(before, after);
  assert.equal(result.before.success, false);
  assert.equal(result.conclusion.faster, false);
  assert.equal(result.conclusion.pair_eligible, false);
  assert.equal(result.conclusion.qualification_status, 'disqualified_due_to_failure');
  assert.match(result.conclusion.summary, /Baseline run failed/);
});

test('adversarial: before run unverified leaves comparison unqualified', () => {
  const before = { wall_ms: 2000, calls: 10, service_ms: 500, success: true, output_verified: false };
  const after = { wall_ms: 500, calls: 3, service_ms: 100, success: true, output_verified: true };
  const result = compareFixture(before, after);
  assert.equal(result.conclusion.faster, false);
  assert.equal(result.conclusion.pair_eligible, false);
  assert.equal(result.conclusion.qualification_status, 'unqualified_missing_verification');
  assert.match(result.conclusion.summary, /baseline lacks independent output verification/);
});

test('adversarial: invalid tool_failures or verification_failures or median gaps throw invalid_report', () => {
  const valid = { wall_ms: 1000, calls: 5, service_ms: 200, success: true, output_verified: true };
  assert.throws(() => compareFixture({ ...valid, tool_failures: -1 }, valid), error => error.code === 'invalid_report');
  assert.throws(() => compareFixture({ ...valid, tool_failures: 'none' }, valid), error => error.code === 'invalid_report');
  assert.throws(() => compareFixture(valid, { ...valid, verification_failures: -2 }), error => error.code === 'invalid_report');
  assert.throws(() => compareFixture(valid, { ...valid, median_gap_ms: -10 }), error => error.code === 'invalid_report');
  assert.throws(() => compareFixture(valid, { ...valid, median_service_ms: NaN }), error => error.code === 'invalid_report');
});

const valid=()=>({...context,wall_ms:1000,calls:5,service_ms:200,completed:true,output_verified:true});

test('missing workload/environment metadata never becomes a qualified speedup',()=>{
 const before=valid(),after={...valid(),wall_ms:500};delete before.workload;delete after.benchmark;
 const result=compareRuns(before,after);
 assert.equal(result.matched_workload,null);assert.equal(result.conclusion.pair_eligible,false);assert.equal(result.conclusion.faster,false);
 assert.equal(result.conclusion.qualification_status,'unqualified_missing_context');
});

test('non-boolean completion or verification values are refused instead of treated as evidence',()=>{
 for(const [key,value] of [['success','unknown'],['completed',1],['ok','true'],['output_verified','yes']])
  assert.throws(()=>compareRuns(valid(),{...valid(),[key]:value}),e=>e.code==='invalid_report');
 assert.throws(()=>compareRuns(valid(),{...valid(),verification:{verified:'true'}}),e=>e.code==='invalid_report');
});

test('a successful controller response alone does not establish completed application work',()=>{
 const after={...valid(),ok:true};delete after.completed;
 assert.equal(compareRuns(valid(),after).conclusion.qualification_status,'unqualified_missing_evidence');
});

test('in-progress task status and differing task descriptions cannot qualify',()=>{
 assert.equal(compareRuns(valid(),{...valid(),status:'running'}).conclusion.pair_eligible,false);
 const result=compareRuns({...valid(),task:'Export PNG'},{...valid(),task:'Export JPEG'});
 assert.equal(result.matched_workload,false);assert(result.context_mismatched.includes('task'));
 const failed=compareRuns(valid(),{...valid(),wall_ms:500,calls:1,completed:false});
 assert.doesNotMatch(formatComparisonMarkdown(failed),/Required .*fewer controller round trips/);
});

test('missing receipts, unknown outcomes, overlap and backwards clocks disqualify a pair',()=>{
 for(const [key,value] of [['first_boundary_verified',false],['missing_sequences',1],['unknown_outcomes',1],['overlapping_calls',true],['clock_regression',true]]){
  const result=compareRuns(valid(),{...valid(),[key]:value});
  assert.equal(result.conclusion.pair_eligible,false,key);assert.equal(result.conclusion.qualification_status,'unqualified_incomplete_trace',key);
 }
 const incomplete=valid();delete incomplete.missing_sequences;
 assert.equal(compareRuns(valid(),incomplete).conclusion.pair_eligible,false);
 assert.equal(compareRuns(valid(),{...valid(),build_ids:['1'.repeat(64),'2'.repeat(64)]}).conclusion.pair_eligible,false);
 assert.equal(compareRuns(valid(),{...valid(),unknown_builds:1}).conclusion.pair_eligible,false);
});

test('different models, hardware, input, application, engine or settings are not matched',()=>{
 for(const key of Object.keys(context.benchmark)){
  const changed=key.endsWith('_sha256')?'0'.repeat(64):'different';
  const result=compareRuns(valid(),{...valid(),benchmark:{...context.benchmark,[key]:changed}});
  assert.equal(result.matched_workload,false,key);assert(result.context_mismatched.includes(key));assert.equal(result.conclusion.pair_eligible,false);
 }
});

test('conflicting output flags and inconsistent command totals are rejected',()=>{
 assert.throws(()=>compareRuns(valid(),{...valid(),verification:{verified:false}}),e=>e.code==='invalid_report');
 assert.throws(()=>compareRuns(valid(),{...valid(),groups:{computer_click:{count:1,service_ms:200}}}),e=>e.code==='invalid_report');
 assert.throws(()=>compareRuns(valid(),{...valid(),groups:{'bad\ncommand':{count:5,service_ms:200}}}),e=>e.code==='invalid_report');
 assert.throws(()=>compareRuns(valid(),{...valid(),median_service_ms:201}),e=>e.code==='invalid_report');
 assert.throws(()=>compareRuns(valid(),{...valid(),median_gap_ms:1001}),e=>e.code==='invalid_report');
});

test('a command named constructor cannot select an inherited command group',()=>{
 const before={...valid(),calls:1,groups:{computer_click:{count:1,service_ms:200}}};
 const after={...valid(),calls:1,groups:{constructor:{count:1,service_ms:200}}};
 const result=compareRuns(before,after);assert.equal(result.command_deltas.constructor.before_count,0);
 assert.equal(result.command_deltas.constructor.after_count,1);assert.equal(Object.getPrototypeOf(result.command_deltas),null);
});

test('raw receipt aliases keep timestamp and first/final boundaries explicit',()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'compare-boundaries-'));
 try{
  const file=path.join(dir,'receipts.jsonl');fs.writeFileSync(file,JSON.stringify({id:'10.1',at:'2026-10-24T07:00:01.000Z',command:'computer_end',elapsed_ms:20,ok:true})+'\n');
  const report=loadRunReport(file,{pid:10,start:'2026-10-24T07:00:00.000Z',first:'10.1',final:'10.1'});
  assert.equal(report.calls,1);assert.equal(report.first_boundary_verified,true);
  assert.throws(()=>loadRunReport(valid(),{since:'2026-10-24T07:00:00.000Z'}),e=>e.code==='bad_arguments');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('CLI options reject missing values, ID-as-timestamp, duplicates and evidence overwrite',()=>{
 for(const args of [['b','a','--pid'],['b','a','--pid','-1'],['b','a','--since','10.1'],['b','a','--since','2026-02-30T00:00:00Z'],['b','a','--first','10.bad'],['b','a','--pid','10','--pid','11'],['b','a','o.json','extra'],['b','a','b'],['b.json','a.json','b.json']])
  assert.throws(()=>parseComparisonArguments(args),e=>e.code==='bad_arguments');
 const parsed=parseComparisonArguments(['before','after','out.json','--before-pid','10','--before-since','2026-10-24T07:00:00Z','--before-first','10.2','--before-through','10.3']);
 assert.equal(parsed.beforeOpts.first,'10.2');assert.equal(parsed.beforeOpts.pid,'10');
});

test('a report growing after stat cannot exceed the bounded reader',()=>{
 let read=0,closed=0;
 const io={openSync:()=>1,fstatSync:()=>({isFile:()=>true,size:0}),readSync(_fd,buffer,_offset,length){read+=length;buffer.fill(0);return length;},closeSync(){closed++;}};
 assert.throws(()=>readReportText('fixture',{io,limit:10}),e=>e.code==='bad_arguments');assert.equal(read,11);assert.equal(closed,1);
});

test('CLI never overwrites an earlier report or an input file',()=>{
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'compare-cli-'));
 try{
  const before=path.join(dir,'before.json'),after=path.join(dir,'after.json'),output=path.join(dir,'out.json');
  fs.writeFileSync(before,JSON.stringify(valid()));fs.writeFileSync(after,JSON.stringify({...valid(),wall_ms:500}));fs.writeFileSync(output,'retained');
  const script=path.resolve('scripts/compare-runs.mjs');
  const run=spawnSync(process.execPath,[script,before,after,output],{windowsHide:true,encoding:'utf8'});
  assert.notEqual(run.status,0);assert.equal(fs.readFileSync(output,'utf8'),'retained');
  const inputBytes=fs.readFileSync(before);const same=spawnSync(process.execPath,[script,before,after,before],{windowsHide:true,encoding:'utf8'});
  assert.notEqual(same.status,0);assert.deepEqual(fs.readFileSync(before),inputBytes);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
