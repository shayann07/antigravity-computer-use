// Adapted from the project's Antigravity latency work at a44e532a74fe6863e8c31fd612af99a80ee1273a.
// Compare two desktop task runs (either precomputed bounded reports or bounded raw receipts).
// Evaluates wall time, call count, service time, median gap, command breakdown,
// task completion, independent output verification, and speed qualification.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { measureRun,parseReceiptTimestamp } from './measure-run.mjs';

const identityKeys=['platform','arch','agent_model','host_version','app_sha256','input_sha256','settings_sha256','hardware_sha256','engine_sha256','model_sha256'];
const invalid=message=>{throw Object.assign(Error(message),{code:'invalid_report'});};
function assessContext(before,after){
  const missing=[],mismatched=[];
  for(const key of ['workload','measurement_scope',...(before.task!==undefined||after.task!==undefined?['task']:[])]){
    if(!before[key]||!after[key])missing.push(key);
    else if(before[key]!==after[key])mismatched.push(key);
  }
  for(const key of identityKeys){
    if(!before.benchmark?.[key]||!after.benchmark?.[key])missing.push(key);
    else if(before.benchmark[key]!==after.benchmark[key])mismatched.push(key);
  }
  return {missing,mismatched};
}
const completeTrace=report=>report.calls>0&&report.wall_ms>0&&report.first_boundary_verified===true&&report.missing_sequences===0&&report.unknown_outcomes===0&&report.overlapping_calls===false&&report.clock_regression===false&&report.unknown_builds===0&&report.build_ids?.length===1;

export function readReportText(file,{io=fs,limit=32*1024*1024}={}){
  if(!Number.isSafeInteger(limit)||limit<1||limit>32*1024*1024)throw Object.assign(Error('Invalid report input limit.'),{code:'bad_arguments'});
  const fd=io.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NONBLOCK||0));
  try{
    const stat=io.fstatSync(fd);
    if(!stat.isFile()||stat.size>limit)throw Object.assign(Error('Use a regular report file of at most 32 MiB.'),{code:'bad_arguments'});
    const chunks=[];let length=0;
    while(length<=limit){
      const chunk=Buffer.allocUnsafe(Math.min(65536,limit+1-length));
      const count=io.readSync(fd,chunk,0,chunk.length,null);if(!count)break;
      length+=count;if(length>limit)throw Object.assign(Error('Report grew beyond the input size limit.'),{code:'bad_arguments'});
      chunks.push(chunk.subarray(0,count));
    }
    return Buffer.concat(chunks,length).toString('utf8').trim();
  }finally{io.closeSync(fd);}
}

function validateReportMetrics(report, label) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    throw Object.assign(Error(`${label} report must be a non-null object.`), { code: 'invalid_report' });
  }
  if (typeof report.wall_ms !== 'number' || !Number.isFinite(report.wall_ms) || report.wall_ms < 0) {
    throw Object.assign(Error(`${label} report must have non-negative finite numeric wall_ms.`), { code: 'invalid_report' });
  }
  if (typeof report.calls !== 'number' || !Number.isSafeInteger(report.calls) || report.calls < 0) {
    throw Object.assign(Error(`${label} report must have non-negative integer calls.`), { code: 'invalid_report' });
  }
  if (typeof report.service_ms !== 'number' || !Number.isFinite(report.service_ms) || report.service_ms < 0) {
    throw Object.assign(Error(`${label} report must have non-negative finite numeric service_ms.`), { code: 'invalid_report' });
  }
  if (report.tool_failures != null && (!Number.isSafeInteger(report.tool_failures) || report.tool_failures < 0)) {
    throw Object.assign(Error(`${label} report tool_failures must be a non-negative integer.`), { code: 'invalid_report' });
  }
  if (report.verification_failures != null && (!Number.isSafeInteger(report.verification_failures) || report.verification_failures < 0)) {
    throw Object.assign(Error(`${label} report verification_failures must be a non-negative integer.`), { code: 'invalid_report' });
  }
  if (report.median_service_ms != null && (!Number.isFinite(report.median_service_ms) || report.median_service_ms < 0)) {
    throw Object.assign(Error(`${label} report median_service_ms must be a non-negative finite number.`), { code: 'invalid_report' });
  }
  if (report.median_gap_ms != null && (!Number.isFinite(report.median_gap_ms) || report.median_gap_ms < 0)) {
    throw Object.assign(Error(`${label} report median_gap_ms must be a non-negative finite number.`), { code: 'invalid_report' });
  }
  if(report.median_service_ms>report.service_ms||report.median_gap_ms>report.wall_ms)invalid(`${label} timing medians exceed their interval totals.`);
  for(const key of ['success','completed','ok','failed','output_verified','first_boundary_verified','overlapping_calls','clock_regression'])
    if(report[key]!==undefined&&typeof report[key]!=='boolean')invalid(`${label} ${key} must be boolean.`);
  for(const key of ['missing_sequences','unknown_outcomes','unknown_builds'])
    if(report[key]!==undefined&&(!Number.isSafeInteger(report[key])||report[key]<0))invalid(`${label} ${key} must be a non-negative integer.`);
  if(report.build_ids!==undefined&&(!Array.isArray(report.build_ids)||report.build_ids.length>16||report.build_ids.some(id=>typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))||new Set(report.build_ids).size!==report.build_ids.length))invalid(`${label} build IDs are invalid.`);
  if(report.unknown_outcomes>report.calls||report.unknown_builds>report.calls||report.tool_failures>report.calls||report.verification_failures>report.calls)invalid(`${label} failure counts exceed call count.`);
  if(report.overlapping_calls===false&&report.service_ms>report.wall_ms)invalid(`${label} service time exceeds a non-overlapping interval.`);
  if(report.verification!==undefined){
    if(!report.verification||typeof report.verification!=='object'||Array.isArray(report.verification))invalid(`${label} verification must be an object.`);
    if(report.verification.verified!==undefined&&typeof report.verification.verified!=='boolean')invalid(`${label} verification.verified must be boolean.`);
    if(report.output_verified!==undefined&&report.verification.verified!==undefined&&report.output_verified!==report.verification.verified)invalid(`${label} output-verification flags conflict.`);
  }
  if(report.workload!==undefined&&(typeof report.workload!=='string'||!report.workload.trim()||report.workload.length>128||/[\x00-\x1f\x7f]/.test(report.workload)))invalid(`${label} workload must be a bounded identifier.`);
  if(report.task!==undefined&&(typeof report.task!=='string'||!report.task.trim()||report.task.length>2048))invalid(`${label} task description is invalid.`);
  if(report.status!==undefined&&!['completed','success','succeeded','failed','error','running','cancelled','stopped'].includes(report.status))invalid(`${label} task status is unknown.`);
  if(report.measurement_scope!==undefined&&!['receipt_interval','host_task'].includes(report.measurement_scope))invalid(`${label} measurement scope is unknown.`);
  if(report.benchmark!==undefined){
    if(!report.benchmark||typeof report.benchmark!=='object'||Array.isArray(report.benchmark))invalid(`${label} benchmark must be an object.`);
    for(const key of identityKeys){const value=report.benchmark[key];if(value===undefined)continue;
      if(typeof value!=='string'||!value.trim()||value.length>128||/[\x00-\x1f\x7f]/.test(value)||key.endsWith('_sha256')&&!/^[a-f0-9]{64}$/.test(value))invalid(`${label} benchmark.${key} is invalid.`);
    }
  }
  if(report.groups!==undefined){
    if(!report.groups||typeof report.groups!=='object'||Array.isArray(report.groups))invalid(`${label} groups must be an object.`);
    let count=0,service=0;
    for(const [command,group] of Object.entries(report.groups)){
      if(!/^[a-z][a-z0-9_]{0,79}$/.test(command)||!group||!Number.isSafeInteger(group.count)||group.count<0||!Number.isFinite(group.service_ms)||group.service_ms<0)invalid(`${label} command group is invalid.`);
      count+=group.count;service+=group.service_ms;
    }
    if(count!==report.calls||Math.abs(service-report.service_ms)>1e-6*Math.max(1,report.service_ms))invalid(`${label} command groups disagree with totals.`);
  }
}

export function loadRunReport(input, options = {}) {
  const hasBoundaries=Object.values(options).some(value=>value!==undefined);
  if (typeof input === 'object' && input !== null && Number.isFinite(input.wall_ms)) {
    if(hasBoundaries)throw Object.assign(Error('Receipt boundaries do not filter a precomputed report.'),{code:'bad_arguments'});
    validateReportMetrics(input,'Loaded');
    return input;
  }
  if (typeof input !== 'string') {
    throw Object.assign(Error('Report input must be a file path or report object.'), { code: 'bad_arguments' });
  }
  const content = readReportText(input);
  if (content.startsWith('{')) {
    try {
      const parsed = JSON.parse(content);
      if(Object.hasOwn(parsed,'wall_ms')){
        if(hasBoundaries)throw Object.assign(Error('Receipt boundaries do not filter a precomputed report.'),{code:'bad_arguments'});
        validateReportMetrics(parsed,'Loaded');return parsed;
      }
    } catch(error) {if(!(error instanceof SyntaxError))throw error;}
  }
  // Raw jsonl receipts: require explicit boundaries
  const hasStart = options.since != null || options.start != null;
  const hasThrough = options.through != null || options.final != null;
  if (!options.pid || !hasStart || !hasThrough) {
    throw Object.assign(Error('Raw receipts comparison requires explicit boundary parameters (pid, since/start, through/final). Supply precomputed bounded reports or provide boundary options.'), { code: 'missing_boundaries' });
  }
  const records = content.split('\n').filter(Boolean).map(JSON.parse);
  return measureRun(records, {...options,since:options.since??options.start,through:options.through??options.final});
}

export function compareRuns(beforeReport, afterReport) {
  validateReportMetrics(beforeReport, 'Before');
  validateReportMetrics(afterReport, 'After');

  const delta = (curr, prev) => curr - prev;
  const pctDelta = (curr, prev) => prev > 0 ? Math.round(((curr - prev) / prev) * 1000) / 10 : null;

  // Task success and evidence assessment
  const assessSuccess = report => {
    const hasEvidence = report.success !== undefined || report.completed !== undefined;
    const explicitFailed = report.failed === true || report.success === false || report.ok === false || report.completed === false || report.status!==undefined&&!['completed','success','succeeded'].includes(report.status) || Boolean(report.error);
    const hasToolFailures = (report.tool_failures || 0) > 0;
    const hasVerificationFailures = (report.verification_failures || 0) > 0;
    const isSuccess = hasEvidence && !explicitFailed && !hasToolFailures && !hasVerificationFailures && (report.success === true || report.completed === true);
    return {
      has_evidence: hasEvidence,
      failed: explicitFailed || hasToolFailures || hasVerificationFailures,
      success: isSuccess
    };
  };

  const beforeAssessment = assessSuccess(beforeReport);
  const afterAssessment = assessSuccess(afterReport);

  const beforeVerified = beforeReport.output_verified === true || beforeReport.verification?.verified === true;
  const afterVerified = afterReport.output_verified === true || afterReport.verification?.verified === true;

  // Workload comparison
  const context=assessContext(beforeReport,afterReport);
  const matchedWorkload=context.mismatched.length?false:context.missing.length?null:true;

  // Derive qualified speed conclusion
  let qualified = false;
  let qualificationStatus = 'unqualified';
  let faster = false;
  let wallSavingsSec = 0;
  let summary = '';

  if (afterAssessment.failed) {
    qualified = false;
    qualificationStatus = 'disqualified_due_to_failure';
    faster = false;
    summary = `Task run failed with ${afterReport.tool_failures || 0} tool failures and ${afterReport.verification_failures || 0} verification failures; shorter wall time cannot be claimed as an optimization.`;
  } else if (!afterAssessment.has_evidence) {
    qualified = false;
    qualificationStatus = 'unqualified_missing_evidence';
    faster = false;
    summary = 'Run is unqualified: missing proof of successful task completion.';
  } else if (beforeAssessment.failed) {
    qualified = false;
    qualificationStatus = 'disqualified_due_to_failure';
    faster = false;
    summary = `Baseline run failed with ${beforeReport.tool_failures || 0} tool failures and ${beforeReport.verification_failures || 0} verification failures; comparison against a broken baseline is disqualified.`;
  } else if (!beforeAssessment.has_evidence) {
    qualified = false;
    qualificationStatus = 'unqualified_missing_evidence';
    faster = false;
    summary = 'Run is unqualified: baseline run lacks proof of successful task completion.';
  } else if (matchedWorkload===false) {
    qualified = false;
    qualificationStatus = 'disqualified_mismatched_workload';
    faster = false;
    summary = 'Disqualified: Comparison between mismatched workloads or tasks.';
  } else if (context.missing.length) {
    qualificationStatus='unqualified_missing_context';
    summary='Matching workload, scope, host/model, input, app, settings and hardware evidence is missing.';
  } else if (!completeTrace(beforeReport)||!completeTrace(afterReport)) {
    qualificationStatus='unqualified_incomplete_trace';
    summary='Explicit first boundaries and complete, non-overlapping traces with one known build and known outcomes are required.';
  } else if (!afterVerified) {
    qualified = false;
    qualificationStatus = 'unqualified_missing_verification';
    faster = false;
    summary = 'Run completed without errors but lacks independent output verification evidence.';
  } else if (!beforeVerified) {
    qualified = false;
    qualificationStatus = 'unqualified_missing_verification';
    faster = false;
    summary = 'Run completed without errors but baseline lacks independent output verification evidence.';
  } else {
    // Both completed successfully with verified outputs on matched workload
    if (afterReport.wall_ms < beforeReport.wall_ms) {
      qualified = true;
      qualificationStatus = 'matched_pair_speedup';
      faster = true;
      wallSavingsSec = Math.round((beforeReport.wall_ms - afterReport.wall_ms) / 100) / 10;
      summary = `Matched pair is ${Math.abs(pctDelta(afterReport.wall_ms, beforeReport.wall_ms))}% shorter (${wallSavingsSec}s saved). Verification is caller-supplied; one pair does not establish release speed or repeatability.`;
    } else {
      qualified = true;
      qualificationStatus = 'matched_pair_no_speedup';
      faster = false;
      summary = 'The reported verified completions form an eligible pair, but wall time did not improve. No release-speed qualification is implied.';
    }
  }

  const comparison = {
    matched_workload: matchedWorkload,
    measurement_scope:beforeReport.measurement_scope===afterReport.measurement_scope?beforeReport.measurement_scope??null:null,
    context_missing:context.missing,
    context_mismatched:context.mismatched,
    before: {
      pid: beforeReport.pid,
      from: beforeReport.from,
      through: beforeReport.through,
      wall_ms: beforeReport.wall_ms,
      calls: beforeReport.calls,
      service_ms: beforeReport.service_ms,
      median_service_ms: beforeReport.median_service_ms,
      median_gap_ms: beforeReport.median_gap_ms,
      tool_failures: beforeReport.tool_failures || 0,
      verification_failures: beforeReport.verification_failures || 0,
      has_completion_evidence: beforeAssessment.has_evidence,
      success: beforeAssessment.success,
      output_verified: beforeVerified,
      build_ids:beforeReport.build_ids
    },
    after: {
      pid: afterReport.pid,
      from: afterReport.from,
      through: afterReport.through,
      wall_ms: afterReport.wall_ms,
      calls: afterReport.calls,
      service_ms: afterReport.service_ms,
      median_service_ms: afterReport.median_service_ms,
      median_gap_ms: afterReport.median_gap_ms,
      tool_failures: afterReport.tool_failures || 0,
      verification_failures: afterReport.verification_failures || 0,
      has_completion_evidence: afterAssessment.has_evidence,
      success: afterAssessment.success,
      output_verified: afterVerified,
      build_ids:afterReport.build_ids
    },
    deltas: {
      wall_ms: delta(afterReport.wall_ms, beforeReport.wall_ms),
      wall_pct: pctDelta(afterReport.wall_ms, beforeReport.wall_ms),
      calls: delta(afterReport.calls, beforeReport.calls),
      calls_pct: pctDelta(afterReport.calls, beforeReport.calls),
      service_ms: delta(afterReport.service_ms, beforeReport.service_ms),
      service_pct: pctDelta(afterReport.service_ms, beforeReport.service_ms),
      median_gap_ms: (afterReport.median_gap_ms != null && beforeReport.median_gap_ms != null)
        ? delta(afterReport.median_gap_ms, beforeReport.median_gap_ms) : null,
      median_gap_pct: (afterReport.median_gap_ms != null && beforeReport.median_gap_ms != null)
        ? pctDelta(afterReport.median_gap_ms, beforeReport.median_gap_ms) : null,
    },
    command_deltas: Object.create(null),
    conclusion: {
      pair_eligible:qualified,
      release_speed_qualified:false,
      scope:'single_matched_pair_only',
      qualification_status: qualificationStatus,
      faster,
      fewer_calls: afterReport.calls < beforeReport.calls,
      wall_savings_sec: wallSavingsSec,
      summary
    }
  };

  const allCommands = new Set([
    ...Object.keys(beforeReport.groups || {}),
    ...Object.keys(afterReport.groups || {})
  ]);

  for (const cmd of allCommands) {
    const bGroup = Object.hasOwn(beforeReport.groups||{},cmd)?beforeReport.groups[cmd]:{count:0,service_ms:0};
    const aGroup = Object.hasOwn(afterReport.groups||{},cmd)?afterReport.groups[cmd]:{count:0,service_ms:0};
    comparison.command_deltas[cmd] = {
      before_count: bGroup.count,
      after_count: aGroup.count,
      count_delta: aGroup.count - bGroup.count,
      before_service_ms: bGroup.service_ms,
      after_service_ms: aGroup.service_ms,
      service_ms_delta: aGroup.service_ms - bGroup.service_ms,
    };
  }

  return comparison;
}

export function formatComparisonMarkdown(comp) {
  const sign = num => num > 0 ? `+${num}` : `${num}`;
  const pctStr = pct => pct != null ? ` (${sign(pct)}%)` : '';

  return `# Computer Use Latency Comparison

| Metric | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Total Wall Time | ${comp.before.wall_ms.toLocaleString()} ms (${(comp.before.wall_ms / 1000).toFixed(1)}s) | ${comp.after.wall_ms.toLocaleString()} ms (${(comp.after.wall_ms / 1000).toFixed(1)}s) | ${sign(comp.deltas.wall_ms)} ms${pctStr(comp.deltas.wall_pct)} |
| Controller Calls | ${comp.before.calls} | ${comp.after.calls} | ${sign(comp.deltas.calls)}${pctStr(comp.deltas.calls_pct)} |
| Controller Service Time | ${comp.before.service_ms.toLocaleString()} ms | ${comp.after.service_ms.toLocaleString()} ms | ${sign(comp.deltas.service_ms)} ms${pctStr(comp.deltas.service_pct)} |
| Median Service Time | ${comp.before.median_service_ms ?? 'N/A'} ms | ${comp.after.median_service_ms ?? 'N/A'} ms | - |
| Median Decision Gap | ${comp.before.median_gap_ms ?? 'N/A'} ms | ${comp.after.median_gap_ms ?? 'N/A'} ms | ${comp.deltas.median_gap_ms != null ? sign(comp.deltas.median_gap_ms) + ' ms' + pctStr(comp.deltas.median_gap_pct) : 'N/A'} |
| Tool Failures | ${comp.before.tool_failures} | ${comp.after.tool_failures} | ${sign(comp.after.tool_failures - comp.before.tool_failures)} |
| Verification Failures | ${comp.before.verification_failures} | ${comp.after.verification_failures} | ${sign(comp.after.verification_failures - comp.before.verification_failures)} |
| Task Completed | ${comp.before.has_completion_evidence ? (comp.before.success ? 'Yes' : 'Failed') : 'Unqualified'} | ${comp.after.has_completion_evidence ? (comp.after.success ? 'Yes' : 'Failed') : 'Unqualified'} | - |
| Output Verification Reported | ${comp.before.output_verified ? 'Yes' : 'Unverified'} | ${comp.after.output_verified ? 'Yes' : 'Unverified'} | - |
| Controller Build | ${(comp.before.build_ids||[]).join(', ')||'Unknown'} | ${(comp.after.build_ids||[]).join(', ')||'Unknown'} | - |
| Qualification Status | - | - | **${comp.conclusion.qualification_status}** |

## Command Breakdown
| Command | Before Calls | After Calls | Call Delta | Before Svc (ms) | After Svc (ms) | Svc Delta (ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
${Object.entries(comp.command_deltas).map(([cmd, d]) => `| \`${cmd}\` | ${d.before_count} | ${d.after_count} | ${sign(d.count_delta)} | ${d.before_service_ms} | ${d.after_service_ms} | ${sign(d.service_ms_delta)} |`).join('\n')}

**Conclusion**: ${comp.conclusion.summary} ${comp.conclusion.pair_eligible&&comp.conclusion.fewer_calls ? `Required ${Math.abs(comp.deltas.calls)} fewer controller round trips.` : ''}

Missing comparison fields: ${comp.context_missing.join(', ')||'none'}. Mismatched fields: ${comp.context_mismatched.join(', ')||'none'}.

Scope: one pair only. This tool does not independently verify application outputs or qualify a release-speed claim.
`;
}

export function parseComparisonArguments(argv){
  const aliases={'--pid':'pid','--since':'since','--start':'since','--through':'through','--final':'through','--first':'first',
    '--before-pid':'beforePid','--after-pid':'afterPid','--before-since':'beforeSince','--before-start':'beforeSince','--after-since':'afterSince','--after-start':'afterSince',
    '--before-through':'beforeThrough','--before-final':'beforeThrough','--after-through':'afterThrough','--after-final':'afterThrough','--before-first':'beforeFirst','--after-first':'afterFirst'};
  const positionals=[],options=Object.create(null);
  const bad=message=>{throw Object.assign(Error(message),{code:'bad_arguments'});};
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];
    if(!arg.startsWith('--')){positionals.push(arg);continue;}
    if(!Object.hasOwn(aliases,arg))bad('Unknown option: '+arg);
    const key=aliases[arg],value=argv[++i];
    if(!value||value.startsWith('--'))bad(arg+' needs a value.');
    if(Object.hasOwn(options,key))bad('Duplicate option: '+arg);
    if(/pid$/i.test(key)&&(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)<1))bad('Invalid process ID.');
    if(/since$/i.test(key)&&!Number.isFinite(parseReceiptTimestamp(value)))bad('Use an ISO task-start timestamp.');
    if(/first$|through$/i.test(key)&&!/^\d+\.[1-9]\d*$/.test(value))bad('Invalid receipt boundary.');
    options[key]=value;
  }
  if(positionals.length<2||positionals.length>3)bad('Pass before, after and optionally one new output file.');
  const [beforePath,afterPath,outputPath]=positionals;
  if(outputPath&&(!/\.(json|md)$/i.test(outputPath)||[beforePath,afterPath].some(input=>path.resolve(input)===path.resolve(outputPath))))bad('Use a new .json/.md output, separate from the inputs.');
  return {beforePath,afterPath,outputPath,beforeOpts:{pid:options.beforePid??options.pid,since:options.beforeSince??options.since,through:options.beforeThrough??options.through,first:options.beforeFirst??options.first},afterOpts:{pid:options.afterPid??options.pid,since:options.afterSince??options.since,through:options.afterThrough??options.through,first:options.afterFirst??options.first}};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.length < 2 || argv.includes('--help') || argv.includes('-h')) {
    console.log(`Compare two desktop task runs (precomputed bounded reports or bounded raw receipts).

Usage:
  node scripts/compare-runs.mjs <before_path> <after_path> [output_path] [options]

Arguments:
  before_path            Precomputed report JSON or raw receipts JSONL
  after_path             Precomputed report JSON or raw receipts JSONL
  output_path            Optional destination (.json or .md)

Boundary options (required for raw receipts JSONL):
  --pid <number>         Process ID for both runs
  --since <timestamp>    Task-start timestamp for both runs
  --first <id>           Explicit first receipt for both runs
  --through <id>         Final receipt boundary for both runs
  --before-pid <number>  Process ID for before run
  --after-pid <number>   Process ID for after run
  --before-since <time>  Task-start timestamp for before run
  --after-since <time>   Task-start timestamp for after run
  --before-first <id>    First receipt for before run
  --after-first <id>     First receipt for after run
  --before-through <id>  Final receipt for before run
  --after-through <id>   Final receipt for after run
`);
    process.exit(argv.includes('--help') || argv.includes('-h') ? 0 : 1);
  }

  const {beforePath,afterPath,outputPath,beforeOpts,afterOpts}=parseComparisonArguments(argv);

  const before = loadRunReport(beforePath, beforeOpts);
  const after = loadRunReport(afterPath, afterOpts);
  const comparison = compareRuns(before, after);

  if (outputPath) {
    if (outputPath.toLowerCase().endsWith('.json')) {
      fs.writeFileSync(outputPath, JSON.stringify(comparison, null, 2) + '\n',{flag:'wx'});
    } else {
      fs.writeFileSync(outputPath, formatComparisonMarkdown(comparison),{flag:'wx'});
    }
  }
  console.log(formatComparisonMarkdown(comparison));
}
