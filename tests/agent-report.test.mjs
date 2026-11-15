import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {reportDraft,reportSubmit,reportNever,scrub,parseFindings,fingerprint,issueLink,REPO} from '../scripts/agent-report.mjs';
import {describeCommand} from '../scripts/desktop.mjs';import {testDirectory} from './paths.mjs';
const dir=()=>fs.mkdtempSync(path.join(testDirectory('tmp'),'agent-report-'));
// Injected gh: never touches the network or the real repository.
function gh({issues=[],authed=true,createFails=0}={}){const calls=[];let failures=createFails;
 const run=(exe,args,options)=>{calls.push({exe,args,input:options?.input});
  if(args[0]==='issue'&&args[1]==='list')return {status:0,stdout:JSON.stringify(issues)};
  if(args[0]==='auth')return {status:authed?0:1};
  if(args[0]==='label')return {status:0};
  if(args[0]==='issue'&&args[1]==='create'){if(failures>0){failures--;return {status:1};}return {status:0,stdout:'https://github.com/'+REPO+'/issues/900\n'};}
  if(args[0]==='issue'&&args[1]==='comment')return {status:0,stdout:'https://github.com/'+REPO+'/issues/5#c\n'};
  return {status:1};};
 return {run,calls};}

test('scrub removes paths, emails, urls, titles, quoted text and long digit runs',()=>{
 const out=scrub('Typing into "Payroll - Secret.xlsx" failed at C:\\Users\\Ann\\Docs\\a.txt and /home/ann/x/y, mail ann@corp.com via https://corp.example/p?q=1 or www.site.org, call 555 123 4567, token abcdefghijklmnopqrstuvwxyz123, window titled Quarterly Plan. @bob see #12');
 for(const leak of ['Payroll','Ann','corp','example','site.org','4567','abcdefghijkl','Quarterly','@bob','#12','C:\\'])assert(!out.includes(leak),leak+' leaked: '+out);
 for(const mark of ['[text]','[path]','[email]','[url]','[number]','[token]','[title]'])assert(out.includes(mark),mark+' missing: '+out);
 assert.equal(scrub("it doesn't focus and can't type"),"it doesn't focus and can't type");
});
test('findings are validated: category, count, length, and too little left after scrubbing',()=>{
 assert.throws(()=>parseFindings([]),e=>e.code==='invalid_finding');
 assert.throws(()=>parseFindings(Array(4).fill('focus: focus was lost after launch')),e=>e.code==='invalid_finding');
 assert.throws(()=>parseFindings(['secret: focus was lost after launch']),e=>e.code==='invalid_finding');
 assert.throws(()=>parseFindings(['focus: '+'x'.repeat(201)]),e=>e.code==='invalid_finding');
 assert.throws(()=>parseFindings(['focus: C:\\Users\\a\\b.txt 123456789']),e=>e.code==='invalid_finding');
 assert.equal(parseFindings(['focus: focus was lost after launch']).length,1);
});
test('fingerprint ignores case, digits and punctuation but not category',()=>{
 assert.equal(fingerprint('focus','Focus lost after launch #1!'),fingerprint('focus','focus lost after launch 22'));
 assert.notEqual(fingerprint('focus','focus lost'),fingerprint('workflow','focus lost'));
});
test('draft is exact, scrubbed, labelled, and stored; duplicates are found by fingerprint',()=>{
 const d=dir(),f=['focus: Focus left the dialog after launch of "Secret.docx"','performance: snapshot took long, see C:\\Users\\Ann\\x.png'];
 const first=gh();const draft=reportDraft(d,f,{run:first.run});
 assert.equal(draft.status,'ready');assert.deepEqual(draft.labels,['agent-report']);assert.equal(draft.duplicate,null);
 assert.match(draft.title,/^\[agent report\] focus, performance \(/);
 for(const needle of ['Build:','Version:','Platform:','Categories: focus, performance','[focus]','[performance]','[text]','[path]'])assert(draft.body.includes(needle),needle);
 assert(!/Secret|Ann/.test(draft.body+draft.title));
 assert.deepEqual(first.calls[0].args.slice(0,2),['issue','list']);assert(first.calls[0].args.includes('--label')&&first.calls[0].args.includes('agent-report')&&first.calls[0].args.includes('open'));
 const marker=/agent-report-fp:[a-f0-9]{12}/.exec(draft.body)[0];
 const second=gh({issues:[{number:5,url:'https://github.com/'+REPO+'/issues/5',body:'x '+marker}]});
 const again=reportDraft(d,f,{run:second.run});assert.equal(again.duplicate.number,5);assert.equal(again.draft_id,draft.draft_id);
 const offline=reportDraft(d,f,{run:()=>({status:1})});assert.equal(offline.duplicate_check,'unavailable');
});
test('submit creates an issue with the exact stored text, once, then the draft is consumed',()=>{
 const d=dir(),g=gh();const draft=reportDraft(d,['workflow: the launch reply omitted the window handle'],{run:g.run});
 g.calls.length=0;const out=reportSubmit(d,draft.draft_id,{run:g.run});
 assert.equal(out.status,'created');assert.match(out.url,/issues\/900/);
 const create=g.calls.find(c=>c.args[1]==='create');assert.equal(create.input,draft.body);assert.equal(create.args[create.args.indexOf('--title')+1],draft.title);assert.equal(create.args[create.args.indexOf('--label')+1],'agent-report');
 assert.throws(()=>reportSubmit(d,draft.draft_id,{run:g.run}),e=>e.code==='draft_not_found');
});
test('submit comments on a duplicate instead of creating',()=>{
 const d=dir(),f=['workflow: the launch reply omitted the window handle'];
 const probe=reportDraft(d,f,{run:gh().run});const marker=/agent-report-fp:[a-f0-9]{12}/.exec(probe.body)[0];
 const g=gh({issues:[{number:5,url:'https://github.com/'+REPO+'/issues/5',body:marker}]});const draft=reportDraft(d,f,{run:g.run});
 const out=reportSubmit(d,draft.draft_id,{run:g.run});assert.equal(out.status,'commented');
 assert(g.calls.some(c=>c.args[1]==='comment'&&c.args[2]==='5'));assert(!g.calls.some(c=>c.args[1]==='create'));
});
test('without gh authentication, or if posting fails, a prefilled link is returned and nothing is driven',()=>{
 for(const g of [gh({authed:false}),gh({createFails:2})]){
  const d=dir();const draft=reportDraft(d,['observation: the tree omitted the visible Save button'],{run:g.run});
  const out=reportSubmit(d,draft.draft_id,{run:g.run});assert.equal(out.status,'link');
  const url=new URL(out.url);assert.equal(url.origin+url.pathname,`https://github.com/${REPO}/issues/new`);
  assert.equal(url.searchParams.get('title'),draft.title);assert.equal(url.searchParams.get('body'),draft.body);assert.equal(url.searchParams.get('labels'),'agent-report');
  assert.equal(out.url,issueLink(draft.title,draft.body));
 }
});
test('Never ask is stored per install and disables drafts and submits',()=>{
 const d=dir(),g=gh();const draft=reportDraft(d,['focus: focus left the dialog after launch'],{run:g.run});
 reportNever(d);g.calls.length=0;
 assert.equal(reportDraft(d,['focus: focus left the dialog after launch'],{run:g.run}).status,'disabled');
 assert.equal(reportSubmit(d,draft.draft_id,{run:g.run}).status,'disabled');assert.equal(g.calls.length,0);
});
test('daily cap limits submissions per install and resets the next day',()=>{
 const d=dir(),g=gh(),t=Date.UTC(2026,0,1,12);
 for(let i=0;i<3;i++){const x=reportDraft(d,['focus: focus left the dialog after launch '+'ab'.repeat(i+1)],{run:g.run,now:t});assert.equal(reportSubmit(d,x.draft_id,{run:g.run,now:t}).status,'created');}
 assert.equal(reportDraft(d,['focus: focus left the dialog again'],{run:g.run,now:t}).status,'daily_limit');
 assert.equal(reportDraft(d,['focus: focus left the dialog again'],{run:g.run,now:t+24*3600*1000}).status,'ready');
});
test('dry run makes no gh write and keeps the draft; expired or tampered drafts are refused',()=>{
 const d=dir(),g=gh();const draft=reportDraft(d,['focus: focus left the dialog after launch'],{run:g.run});g.calls.length=0;
 const dry=reportSubmit(d,draft.draft_id,{run:g.run,dryRun:true});assert.equal(dry.status,'dry_run');assert.equal(g.calls.length,0);
 assert.throws(()=>reportSubmit(d,draft.draft_id,{run:g.run,now:Date.now()+25*3600*1000}),e=>e.code==='draft_expired');
 const file=path.join(d,'agent-report-drafts.json'),v=JSON.parse(fs.readFileSync(file));v.pending.body+='\nextra';fs.writeFileSync(file,JSON.stringify(v));
 assert.throws(()=>reportSubmit(d,draft.draft_id,{run:g.run}),e=>e.code==='draft_not_found');
});
test('the commands are described and the automatic path stays enum-only',()=>{
 for(const name of ['report_draft','report_submit','report_never'])assert.equal(describeCommand(name).command,name);
 assert.equal(describeCommand('report_draft').inputSchema.properties.finding.maxItems,3);
 assert.throws(()=>describeCommand('computer_agent_report'));
});
