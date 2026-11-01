// Measure an explicit receipt interval, excluding later diagnostic status calls.
// Controller timings alone do not prove application success or total AI latency.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function parseReceiptTimestamp(value){
 if(typeof value!=='string')return NaN;
 const match=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
 if(!match)return NaN;
 const time=Date.parse(value);if(!Number.isFinite(time))return NaN;
 const offset=match[1]==='Z'?0:(match[2]==='+'?1:-1)*(Number(match[3])*60+Number(match[4]));
 // Reject calendar dates that Date.parse silently normalises, such as Feb 30.
 return new Date(time+offset*60000).toISOString().slice(0,19)===value.slice(0,19)?time:NaN;
}

export function measureRun(records,{pid,since,through,first}={}){
 const started=parseReceiptTimestamp(since),prefix=String(pid)+'.';
 if(!Array.isArray(records)||typeof since!=='string'||!Number.isFinite(started)||!/^\d+$/.test(String(pid))||!Number.isSafeInteger(Number(pid))||Number(pid)<1||!String(through).startsWith(prefix))throw Error('Pass PID, valid task start time and final task receipt ID.');
 const last=Number(String(through).slice(prefix.length));
 if(!Number.isSafeInteger(last)||last<1||!/^[1-9]\d*$/.test(String(through).slice(prefix.length)))throw Error('Invalid final task receipt ID.');
 const initial=first==null?null:Number(String(first).slice(prefix.length));
 if(first!=null&&(!String(first).startsWith(prefix)||!/^[1-9]\d*$/.test(String(first).slice(prefix.length))||!Number.isSafeInteger(initial)||initial<1||initial>last))throw Error('Invalid first task receipt ID.');
 const rows=records.filter(row=>{
  if(!row||typeof row!=='object'||typeof row.id!=='string')throw Error('Invalid receipt record.');
  if(!row.id.startsWith(prefix))return false;
  const sequence=Number(String(row.id).slice(prefix.length));
  if(!/^[1-9]\d*$/.test(row.id.slice(prefix.length))||!Number.isSafeInteger(sequence))throw Error('Invalid receipt sequence.');
  if(sequence>last||initial!=null&&sequence<initial)return false;
  if(!Number.isFinite(parseReceiptTimestamp(row.at)))throw Error('Invalid timestamp in selected receipt interval.');
  return Date.parse(row.at)>=started;
 }).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
 if(!rows.length||!rows.some(row=>row.id===through))throw Error('Final task receipt is missing from this interval.');
 if(first!=null&&!rows.some(row=>row.id===first))throw Error('First task receipt is missing from this interval.');
 if(rows.some(row=>!Number.isFinite(row.elapsed_ms)||row.elapsed_ms<0))throw Error('Invalid controller duration in receipt.');
 if(rows.some(row=>typeof row.command!=='string'||!/^[a-z][a-z0-9_]{0,79}$/.test(row.command)))throw Error('Invalid command name in receipt.');
 const sequences=rows.map(row=>Number(String(row.id).slice(prefix.length))).sort((a,b)=>a-b);
 if(new Set(sequences).size!==sequences.length)throw Error('Duplicate controller receipt sequence in task interval.');
 const missing_sequences=sequences.slice(1).reduce((total,n,i)=>total+Math.max(0,n-sequences[i]-1),0);
 const bySequence=rows.toSorted((a,b)=>Number(a.id.slice(prefix.length))-Number(b.id.slice(prefix.length)));
 const clock_regression=bySequence.some((row,i)=>i>0&&Date.parse(row.at)<Date.parse(bySequence[i-1].at));
 const groups=Object.create(null),gaps=[];let end=started,overlapping=false;
 for(let i=0;i<rows.length;i++){
  const row=rows[i],at=Date.parse(row.at);
  if(i){const previous=rows[i-1],gap=at-Date.parse(previous.at)-previous.elapsed_ms;gaps.push(Math.max(0,gap));overlapping ||= gap<0;}
  end=Math.max(end,at+row.elapsed_ms);
  const group=groups[row.command]??={count:0,service_ms:0,tool_failures:0,verification_failures:0};
  group.count++;group.service_ms+=row.elapsed_ms;group.tool_failures+=row.ok===false?1:0;group.verification_failures+=row.verification_error?1:0;
 }
 const median=values=>{if(!values.length)return null;const sorted=values.toSorted((a,b)=>a-b),mid=Math.floor(sorted.length/2);return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;};
 const service_ms=rows.reduce((sum,row)=>sum+row.elapsed_ms,0);
 const knownBuild=row=>typeof row.build_id==='string'&&/^[a-f0-9]{64}$/.test(row.build_id);
 const build_ids=[...new Set(rows.filter(knownBuild).map(row=>row.build_id))].sort();
 return {pid:String(pid),from:since,first:first??bySequence[0].id,first_boundary_verified:first!=null,through,to:new Date(end).toISOString(),measurement_scope:'receipt_interval',calls:rows.length,wall_ms:end-started,
  service_ms,outside_service_ms:overlapping||clock_regression?null:end-started-service_ms,median_service_ms:median(rows.map(row=>row.elapsed_ms)),
  median_gap_ms:median(gaps),max_gap_ms:gaps.length?Math.max(...gaps):null,overlapping_calls:overlapping,clock_regression,missing_sequences,
  unknown_outcomes:rows.filter(row=>row.ok!==true&&row.ok!==false).length,build_ids,unknown_builds:rows.filter(row=>!knownBuild(row)).length,
  tool_failures:rows.filter(row=>row.ok===false).length,verification_failures:rows.filter(row=>row.verification_error).length,groups,
  note:'Operator-specified receipt interval only. Outside-service time includes host/model/file/image tools and inference between calls; it is not model reasoning alone. Verify boundaries, application and outputs independently; controller success is not application success.'};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);let first;
 const firstIndex=args.indexOf('--first');if(firstIndex>=0){first=args[firstIndex+1];if(!first||first.startsWith('--'))throw Error('--first needs a receipt ID.');args.splice(firstIndex,2);}
 const [file,pid,since,through,output]=args;
 if(!file||args.length>5||args.some(arg=>arg.startsWith('--')))throw Error('Usage: node scripts/measure-run.mjs RECEIPTS PID TASK_START FINAL_RECEIPT [OUTPUT] [--first FIRST_RECEIPT]');
 const records=fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
 const report=measureRun(records,{pid,since,through,first});
 if(output){if(path.resolve(output)===path.resolve(file))throw Error('Output cannot replace receipt evidence.');fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});}
 console.log(JSON.stringify(report,null,2));
}
