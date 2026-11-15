// Agent-written issue reports. The agent keeps notes during a task and, after
// `end`, asks the runtime for an exact, scrubbed draft. A person approves the
// text in chat; only then does report_submit post that same text. Nothing here
// drives a browser, and the automatic no-human path (diagnostics) is untouched.
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {BUILD_ID,VERSION} from '../server/version.mjs';import {writeAtomicJSON} from '../server/atomic-json.mjs';

export const REPO='shayann07/antigravity-computer-use';
export const LABEL='agent-report';
export const CATEGORIES=['cursor_visual','focus','observation','workflow','performance','missing_capability','unexpected_pause','other'];
export const MAX_FINDINGS=3,MAX_LINE=200,DAILY_CAP=3,DRAFT_TTL_MS=24*3600*1000;
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};

// Order matters: structured identifiers first, then free-form spans, then
// number runs. Every rule replaces with a fixed placeholder, never a hash.
const RULES=[
 [/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi,'[url]'],
 [/\bwww\.\S+/gi,'[url]'],
 [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,'[email]'],
 [/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|dev|app|ai|co|gov|edu|me|xyz)\b(?:\/\S*)?/gi,'[url]'],
 [/(?:\\\\[^\s\\]+\\|\b[a-z]:[\\/])[^\s"'<>|*?]*/gi,'[path]'],
 [/(?:^|(?<=[\s("'`]))(?:~|\.{1,2})?(?:\/[^\s/"'`]+){2,}\/?/g,'[path]'],
 [/(?:^|(?<=[\s("'`]))[\w.-]+(?:\\[\w .-]+){1,}/g,'[path]'],
 [/\b(window\s+)?(?:titled|title|caption)\b\s*[:=]?\s*[^.;\n]*/gi,(m,w)=>`${w||''}[title]`],
 [/"[^"]*"|“[^”]*”|(?<!\w)'[^']{2,}'(?!\w)|`[^`]*`/g,'[text]'],
 [/\b[A-Za-z0-9+/_-]{24,}={0,2}/g,'[token]'],
 [/\d(?:[\s()-]?\d){4,}/g,'[number]']
];
export function scrub(line){
 let text=String(line).replace(/[\u0000-\u001f\u007f]+/g,' ');
 for(const [pattern,replacement] of RULES)text=text.replace(pattern,replacement);
 // Neutralise GitHub notifications, issue cross-references and markup.
 text=text.replace(/@(?=\w)/g,'').replace(/#(?=\d)/g,'no. ').replace(/[<>|]/g,' ').replace(/[*_~[\]]{3,}/g,' ');
 // The brackets we add are intentional; keep them, but collapse whitespace.
 return text.replace(/\s+/g,' ').trim().slice(0,MAX_LINE);
}
// Stable across rewording of digits/case/punctuation so a repeat report matches.
export function fingerprint(category,scrubbed){
 const normal=scrubbed.toLowerCase().replace(/\[[a-z]+\]/g,' ').replace(/[^a-z\s]/g,' ').split(/\s+/).filter(Boolean).slice(0,24).join(' ');
 return createHash('sha256').update(category+'\n'+normal).digest('hex').slice(0,12);
}

export function parseFindings(raw){
 if(!Array.isArray(raw)||raw.length<1||raw.length>MAX_FINDINGS)fail('invalid_finding',`Give 1 to ${MAX_FINDINGS} findings.`);
 const out=[];
 for(const item of raw){
  const text=String(item);const split=text.indexOf(':');
  const category=(split<0?'':text.slice(0,split)).trim(),line=(split<0?text:text.slice(split+1)).trim();
  if(!CATEGORIES.includes(category))fail('invalid_finding',`Category must be one of: ${CATEGORIES.join(', ')}.`);
  if(!line||line.length>MAX_LINE)fail('invalid_finding',`Each line must be 1 to ${MAX_LINE} characters.`);
  const clean=scrub(line);
  if(clean.replace(/\[[a-z]+\]/g,'').replace(/[^a-z0-9]/gi,'').length<8)fail('invalid_finding','The line has too little left after privacy scrubbing; describe the behaviour without names, paths or numbers.');
  out.push({category,line:clean,fingerprint:fingerprint(category,clean)});
 }
 return out;
}

export function buildDraft(findings,{build=BUILD_ID,version=VERSION,platform=process.platform,arch=process.arch}={}){
 const categories=[...new Set(findings.map(f=>f.category))];
 const title=`[agent report] ${categories.join(', ')} (${platform})`;
 const body=['Agent-reported observations (unverified). The runtime scrubbed paths, emails, URLs, window titles and long numbers, and the user approved this exact text before it was posted.','',
  `- Build: ${build}`,`- Version: ${version}`,`- Platform: ${platform} ${arch}`,`- Categories: ${categories.join(', ')}`,`- Label: ${LABEL}`,'','Findings:',
  ...findings.map((f,i)=>`${i+1}. [${f.category}] ${f.line}`),'',
  ...findings.map(f=>`<!-- agent-report-fp:${f.fingerprint} -->`)].join('\n');
 return {title,body,id:draftId(title,body)};
}
const draftId=(title,body)=>createHash('sha256').update(title+'\n'+body).digest('hex').slice(0,16);

const files=directory=>({prefs:path.join(directory,'agent-report.json'),drafts:path.join(directory,'agent-report-drafts.json')});
const readJSON=(file,fallback)=>{try{const v=JSON.parse(fs.readFileSync(file,'utf8'));return v&&typeof v==='object'?v:fallback;}catch{return fallback;}};
const today=now=>new Date(now).toISOString().slice(0,10);
function prefs(directory,now){
 const p=readJSON(files(directory).prefs,{});
 return {never:p.never===true,day:p.day===today(now)?p.day:today(now),count:p.day===today(now)&&Number.isSafeInteger(p.count)?p.count:0};
}
const savePrefs=(directory,value)=>{fs.mkdirSync(directory,{recursive:true});writeAtomicJSON(files(directory).prefs,value);};

function duplicates(findings,run){
 const query=run('gh',['issue','list','--repo',REPO,'--state','open','--label',LABEL,'--limit','100','--json','number,url,body'],{encoding:'utf8',timeout:15000,windowsHide:true});
 if(query.status!==0)return {checked:false,match:null};
 let rows;try{rows=JSON.parse(query.stdout);}catch{return {checked:false,match:null};}
 if(!Array.isArray(rows))return {checked:false,match:null};
 for(const row of rows){
  if(!Number.isSafeInteger(row?.number)||typeof row.url!=='string'||typeof row.body!=='string')continue;
  if(findings.some(f=>row.body.includes(`agent-report-fp:${f.fingerprint}`)))return {checked:true,match:{number:row.number,url:row.url}};
 }
 return {checked:true,match:null};
}

export function reportDraft(directory,rawFindings,{run=spawnSync,now=Date.now()}={}){
 const p=prefs(directory,now);
 if(p.never)return {status:'disabled',message:'The user chose Never ask on this install. Do not ask again.'};
 if(p.count>=DAILY_CAP)return {status:'daily_limit',message:'The daily report limit for this install is reached. Do not ask.'};
 const findings=parseFindings(rawFindings);
 const draft=buildDraft(findings);
 const dup=duplicates(findings,run);
 const stored={id:draft.id,title:draft.title,body:draft.body,duplicate:dup.match,created:now,fingerprints:findings.map(f=>f.fingerprint)};
 // Only one draft is pending at a time, so one task yields at most one issue.
 fs.mkdirSync(directory,{recursive:true});writeAtomicJSON(files(directory).drafts,{pending:stored});
 return {status:'ready',draft_id:draft.id,title:draft.title,body:draft.body,labels:[LABEL],
  duplicate:dup.match,duplicate_check:dup.checked?'done':'unavailable',
  action_if_yes:dup.match?`comment on ${dup.match.url}`:'create a new issue',
  ask_user:'Show the title and body exactly as written and ask once: Yes / Not now / Never ask.'};
}

export function reportNever(directory,{now=Date.now()}={}){
 savePrefs(directory,{...prefs(directory,now),never:true});return {status:'disabled',message:'Reports will not be offered on this install.'};
}

export function issueLink(title,body){
 return `https://github.com/${REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=${LABEL}`;
}

export function reportSubmit(directory,draftId_,{run=spawnSync,now=Date.now(),dryRun=false}={}){
 const p=prefs(directory,now);
 if(p.never)return {status:'disabled',message:'The user chose Never ask on this install.'};
 if(p.count>=DAILY_CAP)return {status:'daily_limit',message:'The daily report limit for this install is reached.'};
 const pending=readJSON(files(directory).drafts,{}).pending;
 if(!pending||pending.id!==draftId_||pending.id!==draftId(String(pending.title),String(pending.body)))fail('draft_not_found','No pending draft has that id. Run report_draft again.');
 if(now-pending.created>DRAFT_TTL_MS)fail('draft_expired','The draft is more than a day old. Run report_draft again.');
 const link=issueLink(pending.title,pending.body);
 const finish=result=>{
  if(dryRun)return result;
  fs.writeFileSync(files(directory).drafts,'{}');savePrefs(directory,{...p,count:p.count+1});return result;
 };
 const auth=dryRun?{status:0}:run('gh',['auth','status'],{encoding:'utf8',timeout:15000,windowsHide:true});
 if(auth.status!==0)return finish({status:'link',url:link,message:'GitHub CLI is not signed in. Give the user this link to open; do not open it yourself.'});
 const commentOn=pending.duplicate&&Number.isSafeInteger(pending.duplicate.number)?pending.duplicate.number:null;
 const args=commentOn?['issue','comment',String(commentOn),'--repo',REPO,'--body-file','-']:['issue','create','--repo',REPO,'--title',pending.title,'--body-file','-','--label',LABEL];
 if(dryRun)return {status:'dry_run',would:commentOn?`comment on issue ${commentOn}`:'create issue',args:args.slice(0,4),title:pending.title,body:pending.body};
 const options={input:pending.body,encoding:'utf8',timeout:15000,windowsHide:true};
 let result=run('gh',args,options);
 if(result.status!==0&&!commentOn){
  // The label may not exist yet; create it once and retry.
  run('gh',['label','create',LABEL,'--repo',REPO,'--color','6f42c1','--description','Unverified reports written by an agent after a task'],{encoding:'utf8',timeout:15000,windowsHide:true});
  result=run('gh',args,options);
 }
 if(result.status!==0)return finish({status:'link',url:link,message:'GitHub posting failed. Give the user this link to open; do not open it yourself.'});
 const url=String(result.stdout||'').trim().split(/\s+/).find(w=>w.startsWith('https://github.com/'))||null;
 return finish({status:commentOn?'commented':'created',url:url||pending.duplicate?.url||null});
}
