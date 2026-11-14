// Adapted stdio dispatch and tool vocabulary from ridelink0/claude-computer-use (MIT).
import {contract} from './platform.mjs';
import {safeWaitMetrics} from './recovery.mjs';
const str={type:'string'},num={type:'integer'},bool={type:'boolean'};
const nodeCount={...num,minimum:1,maximum:500};
const settle={...num,minimum:0,maximum:2000};
const selectorText={type:'string',minLength:1,maxLength:1000};
const target={hwnd:num,observation_id:str,index:num,name:selectorText,role:selectorText,automation_id:selectorText,x:num,y:num,risk:{type:'string',enum:['routine','sensitive'],default:'sensitive'},reason:str,observe:{type:'object',properties:{with_image:bool,query:str,max_nodes:nodeCount,settle_ms:settle},additionalProperties:false}};
const tool=(name,description,properties={},required=[])=>({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false}});
export const TOOLS=[
 tool('computer_apps','List desktop apps and opaque window handles. Set include_hidden to discover minimized windows and apps on other virtual desktops; do not confuse them with closed apps.',{include_hidden:bool}),
 tool('computer_grant','Select application instance for this task under the host permission policy. Native identity checks apply; model approval flags are rejected.',{hwnd:num,reason:str},['hwnd','reason']),
 tool('computer_snapshot','Observe accessibility controls and screenshot. Returns one-use observation_id. Literal query matches include their child controls, preserving indexes/offscreen state. Optional settle_ms waits up to2seconds before reading an animating UI; never repeats input.',{hwnd:num,with_image:bool,max_width:{...num,minimum:100,maximum:1400},max_nodes:nodeCount,query:str,settle_ms:settle,reason:str},['hwnd']),
 tool('computer_move','Move the real pointer to screenshot pixels without clicking; use to hover and inspect.',{...target},['hwnd','observation_id','x','y','reason']),
 tool('computer_click','Click an index, uniquely observed exact name/role/automation_id, or screenshot pixels. Clicks move the real cursor by default; physical:false explicitly requests a semantic action for an indexed control. Names resolve only in the current observation; ambiguity refuses. Pixel clicks always move the cursor.',{...target,button:{type:'string',enum:['left','right','middle']},clicks:{...num,minimum:1,maximum:3},physical:bool},['hwnd','observation_id','reason']),
 tool('computer_type','Type up to 400 UTF-16 units into the observed focus/element. For larger text use explicit paste and verify the result.',{...target,text:{...str,maxLength:400}},['hwnd','observation_id','text','reason']),
 tool('computer_paste','Explicit clipboard operation: paste text into the observed editor, then restore saved clipboard formats unless another app changed it. Verify actual contents afterward.',{...target,text:{...str,maxLength:20000}},['hwnd','observation_id','text','reason']),
 tool('computer_set_value','Set an observed field by index or exact unique name/role/automation_id. Supply exactly one of text or numeric value. Inspect the result.',{...target,text:str,value:{type:'number'}},['hwnd','observation_id','reason']),
 tool('computer_key','Press a chord: ctrl+a, enter, tab, etc. Optional index focuses and verifies that control first; otherwise uses current focus. Native sensitive checks apply.',{...target,keys:str},['hwnd','observation_id','keys','reason']),
 tool('computer_scroll','Scroll element or screenshot point. Negative amount scrolls down.',{...target,amount:{...num,minimum:-20,maximum:20},horizontal:bool,into_view:bool},['hwnd','observation_id','reason']),
 tool('computer_drag','Drag real cursor; from/to are screenshot pixels. Or pass points (2-400 [x,y] screenshot points) for one continuous stroke through every point, such as a curve on a canvas.',{...target,from:{type:'array',items:num,minItems:2,maxItems:2},to:{type:'array',items:num,minItems:2,maxItems:2},points:{type:'array',items:{type:'array',items:num,minItems:2,maxItems:2},minItems:2,maxItems:400},steps:{...num,minimum:2,maximum:120},button:str},['hwnd','observation_id','reason']),
 tool('computer_focus','Activate an approved app.',{hwnd:num,reason:str,risk:{type:'string',enum:['routine','sensitive']}},['hwnd','reason']),
 tool('computer_fit_window','Explicitly restore and fit an approved window onto its nearest display working area, shrinking only as needed. Clears old observations and returns fresh state. Never moves between virtual desktops.',{hwnd:num,reason:str,risk:{type:'string',enum:['routine','sensitive']},observe:target.observe},['hwnd','reason']),
 tool('computer_close_window','Ask window to close under the host permission policy. Can discard unsaved work.',{hwnd:num,reason:str},['hwnd','reason']),
 tool('computer_clipboard','Explicit clipboard read/write. Explain the data and effect under the host permission policy.',{text:str,reason:str},['reason']),
 tool('computer_launch','Launch an existing GUI application (.exe on Windows, .app on macOS) under the host permission policy. Optional observe returns the first unambiguous visible window of that exact launched PID and executable; never relaunch on observe_pending or verification_error.',{app:str,args:{type:'array',items:str},observe:bool,reason:str},['app','reason']),
 tool('computer_open','Open document/folder with its handler; separate confirmation.',{...target,path:str},['hwnd','observation_id','path','reason']),
 tool('computer_file_dialog','Fill and confirm an ALREADY OPEN native file picker. Use owner hwnd, fresh frame and exact path. entry_method clipboard explicitly uses temporary clipboard-preserving paste for atomic filename entry; keyboard is the compatibility default. Never confirms a mismatched filename.',{...target,path:str,action:{type:'string',enum:['open','save']},entry_method:{type:'string',enum:['keyboard','clipboard']}},['hwnd','observation_id','path','reason']),
 tool('computer_run','Run 1-8 predictable actions or observed waits sequentially. Combined polling budgets are at most30seconds; slow observations can extend actual elapsed time. Stop on first failure or unmet wait; do not replay completed steps.',{hwnd:num,observation_id:str,steps:{type:'array',minItems:1,maxItems:contract.batch_steps,items:{type:'object'}},reason:str},['hwnd','observation_id','steps','reason']),
 tool('computer_wait','Wait for expected UI text without repeating input: until waits for text to appear; until_gone waits for text you observed (such as a Cancel or progress label) to disappear, and the text must be visible when the wait starts. Supply exactly one. Optional abort_on strings stop early on a known failure; failures win if success and failure appear together. Do not combine abort_on with query: filtering may hide failures. Returns a fresh observation; with_image controls screenshot capture.',{hwnd:num,until:selectorText,until_gone:selectorText,abort_on:{type:'array',minItems:1,maxItems:8,items:selectorText},timeout_ms:{...num,minimum:100,maximum:30000},query:str,with_image:bool,reason:str},['hwnd','reason']),
 tool('computer_wait_change','Wait for the accessible text tree to differ from a fresh observation. Returns a fresh text-only observation. A change is not proof of success, and pixel-only changes may be invisible.',{hwnd:num,observation_id:str,timeout_ms:{...num,minimum:100,maximum:30000},reason:str},['hwnd','observation_id','reason']),
 tool('computer_feedback','Record an agent-observed concern as bounded, unverified local metadata. Automatic GitHub submission requires the installation reporting preference and authentication. No free text, screenshots, paths or task content are accepted.',{category:{type:'string',enum:['cursor_visual','focus','observation','workflow','performance','missing_capability','unexpected_pause','other']},operation:{type:'string',enum:['observe','click','type','scroll','drag','keyboard','launch','wait','update','other']},evidence:{type:'string',enum:['suspected','observed','reproduced']}},['category','operation','evidence']),
 tool('computer_end','Finish normally; no Antigravity restart needed.'),
 tool('computer_controls','Explicitly show local controls for human re-arm or pause/stop. Showing controls never clears an emergency Stop, grants an app or sends input. Stopped controls dismiss automatically after30seconds.'),
 tool('computer_ready','Check control readiness and reveal local controls once. Follow next_action; never repeat startup or clear Stop.'),
 tool('computer_pause','Pause for human takeover. Do not replay interrupted input.'),
 tool('computer_resume','Resume a soft pause ONLY after the user explicitly says to continue under the host permission policy. Clears observations; never clears emergency Stop.'),
 tool('computer_stop','Emergency stop, release inputs; HUMAN re-arm required.'),
 tool('computer_status','Read status without permission prompts or screenshots.')
];
const OPS={computer_move:'move',computer_click:'click',computer_type:'type',computer_paste:'paste',computer_key:'key',computer_scroll:'scroll',computer_drag:'drag',computer_focus:'focus',computer_fit_window:'fit_window',computer_close_window:'close_window',computer_set_value:'set_value',computer_clipboard:'clipboard',computer_open:'open',computer_file_dialog:'file_dialog'};
export function validate(name,args){
 const s=TOOLS.find(t=>t.name===name)?.inputSchema;if(!s)throw new Error('Unknown tool');
 const visit=(t,v,k)=>{
  if(t.type==='integer'&&!Number.isSafeInteger(v))throw new Error(k+' must be integer');
  if((t.type==='integer'||t.type==='number')&&(!Number.isFinite(v)||(t.minimum!=null&&v<t.minimum)||(t.maximum!=null&&v>t.maximum)))throw new Error(k+' is outside the allowed range');
  if(t.type==='string'&&typeof v!=='string')throw new Error(k+' must be text');
  if(t.type==='string'&&t.maxLength!=null&&v.length>t.maxLength)throw new Error(k+' exceeds the allowed length');
  if(t.type==='string'&&t.minLength&&v.trim().length<t.minLength)throw new Error(k+' is empty');
  if(t.type==='boolean'&&typeof v!=='boolean')throw new Error(k+' must be boolean');
  if(t.type==='array'&&(!Array.isArray(v)||(t.maxItems&&v.length>t.maxItems)||(t.minItems&&v.length<t.minItems)))throw new Error('Invalid '+k);
  if(t.enum&&!t.enum.includes(v))throw new Error('Invalid '+k);
  if(t.type==='array'&&t.items)v.forEach((item,i)=>visit(t.items,item,`${k}[${i}]`));
  if(t.type==='object'){
   if(!v||typeof v!=='object'||Array.isArray(v))throw new Error(k+' must be an object');
   for(const key of t.required||[])if(!Object.hasOwn(v,key))throw new Error('Required field: '+k+'.'+key);
   for(const [key,value] of Object.entries(v)){
    if(t.additionalProperties===false&&!Object.hasOwn(t.properties||{},key))throw new Error('Unsupported field: '+k+'.'+key);
    if(t.properties?.[key])visit(t.properties[key],value,k+'.'+key);
   }
  }
 };
 visit(s,args,'arguments');
 if(name==='computer_wait'&&Object.hasOwn(args,'until')===Object.hasOwn(args,'until_gone'))throw new Error('Supply exactly one of until or until_gone; no input was sent.');
 if(name==='computer_wait'&&args.abort_on?.length&&args.query?.trim())throw new Error('A query can hide failure labels. Omit query when using abort_on; no input was sent.');
 if(name==='computer_set_value'&&(Object.hasOwn(args,'text')===Object.hasOwn(args,'value')))throw new Error('Supply exactly one of text or value');
 const pixel=Object.hasOwn(args,'x')||Object.hasOwn(args,'y');
 const named=['name','role','automation_id'].some(k=>Object.hasOwn(args,k));
 if(pixel&&(!Object.hasOwn(args,'x')||!Object.hasOwn(args,'y')))throw new Error('Supply both x and y for a pixel target');
 if(pixel&&Object.hasOwn(args,'index'))throw new Error('Supply an accessibility index or screenshot coordinates, not both');
 if(named&&(pixel||Object.hasOwn(args,'index')))throw new Error('Do not mix exact observed names with index or pixel targeting');
 if(['computer_click','computer_scroll','computer_set_value'].includes(name)&&!pixel&&!named&&!Object.hasOwn(args,'index'))throw new Error('Supply an observed index, unique exact name/role/id, or allowed screenshot coordinates');
 if(name==='computer_set_value'&&pixel)throw new Error('Set value requires an observed accessible control');
 if(name==='computer_move'&&named)throw new Error('Move uses screenshot coordinates');
 if(name==='computer_drag'&&(pixel||named||Object.hasOwn(args,'index')))throw new Error('Drag uses only from/to screenshot coordinates');
}
export async function call(r,name,a){
 validate(name,a);
 if(name==='computer_status')return r.status();
 if(name==='computer_controls')return r.showControls();
 if(name==='computer_ready')return r.ready();
 if(name==='computer_apps')return {windows:(await r.driver.call('list_apps',{include_hidden:a.include_hidden===true})).result.windows.filter(w=>![r.guardian.pid,r.driver.info?.pid,process.pid,process.ppid].includes(w.pid))};
 if(name==='computer_grant')return {approved:await r.grant(a.hwnd,a.reason)};
 if(name==='computer_snapshot')return r.observe(a);
 if(name==='computer_wait')return r.wait(a);
 if(name==='computer_wait_change')return r.waitChange(a);
 if(name==='computer_feedback')return r.feedback(a);
 if(name==='computer_end')return r.finish();
 if(name==='computer_stop')return r.stop();
 if(name==='computer_pause')return r.pause();
 if(name==='computer_resume')return r.resume();
 if(name==='computer_launch')return r.launch(a);
 if(name==='computer_run'){
  // Validate the whole plan before sending the first input. A typo in step8
  // must not execute steps1-7 and then throw away their delivery evidence.
  const plan=a.steps.map(({kind,...rest},i)=>{
   const n='computer_'+kind;if(!OPS[n]&&!['computer_wait','computer_wait_change'].includes(n))throw new Error('Unsupported batch step '+kind);
   const properties=TOOLS.find(t=>t.name===n).inputSchema.properties;
   if(!Object.hasOwn(properties,'hwnd'))throw new Error('Batch steps must target their owner window; use explicit paste for text instead of a window-free clipboard step.');
   if(Object.hasOwn(rest,'hwnd')||Object.hasOwn(rest,'observation_id'))throw new Error('Batch steps cannot replace the owner window or frame.');
   const args={hwnd:a.hwnd,reason:a.reason,...rest};
   const framed=Object.hasOwn(properties,'observation_id');if(framed)args.observation_id=a.observation_id;
   // A pixel step (move, drag or x/y) needs a screenshot of the frame it acts
   // on, so the step before it captures one automatically.
   const following=a.steps[i+1],nextPixel=!!following&&(['move','drag'].includes(following.kind)||Object.hasOwn(following,'x')||Object.hasOwn(following,'y'));
   // The CLI always sends an explicit with_image, so a following pixel step
   // must override it; an extra capture is always safe.
   if(properties.observe)args.observe={with_image:i===a.steps.length-1,...rest.observe,...(nextPixel?{with_image:true}:{})};
   validate(n,args);return {kind,n,args,framed};
  });
  const waitBudget=plan.filter(step=>['computer_wait','computer_wait_change'].includes(step.n)).reduce((sum,step)=>sum+(step.args.timeout_ms??15000),0);
  if(waitBudget>contract.batch_wait_ms)throw new Error('Combined batch waits must not exceed30seconds. No input was sent.');
  for(let i=0;i<plan.length;i++)if(['computer_wait','computer_wait_change'].includes(plan[i].n)){
   const next=plan[i+1];
   const needsImage=!!next&&(['computer_move','computer_drag'].includes(next.n)||Object.hasOwn(next.args,'x')||Object.hasOwn(next.args,'y'));
   if(needsImage)throw new Error('A pixel action cannot use an unseen batch observation. End the batch, inspect a fresh screenshot, then act. No input was sent.');
   if(plan[i].n==='computer_wait'&&!Object.hasOwn(plan[i].args,'with_image'))plan[i].args.with_image=!next;
  }
  const completed=[];let last=null;let observation=a.observation_id;
  for(let i=0;i<plan.length;i++){
   const {kind,n,args,framed}=plan[i];
   try{
    last=await call(r,n,framed?{...args,observation_id:observation}:args);
    if(!last||typeof last!=='object'||Array.isArray(last))return {ok:false,delivery_unknown:true,error:{code:'input_outcome_unknown',message:'The step returned no usable result. Inspect the app; do not replay it.'},completed,failed_index:i,skipped:plan.length-i-1,observe_before_continuing:true};
    if(last.ok===false){
     const error=last.error&&typeof last.error==='object'&&!Array.isArray(last.error)&&typeof last.error.code==='string'
      ?last.error:{code:'batch_step_failed',message:'The step reported failure. Inspect the app before continuing.'};
     const framed=error.code==='wait_label_not_observed'&&typeof last.metadata?.observation_id==='string';
     return {...last,ok:false,error,completed,failed_index:i,skipped:plan.length-i-1,...(framed?{}:{observe_before_continuing:true})};
    }
    completed.push({index:i,kind,ok:true,...(['computer_wait','computer_wait_change'].includes(n)&&last.wait_metrics?{wait_metrics:last.wait_metrics}:{})});
    if(last.verification_error)return {...last,batch:{completed,failed_index:i,skipped:plan.length-i-1,phase:'verification'}};
    if(n==='computer_wait'&&!last.matched){
     completed.pop();return {...last,ok:false,verification_error:{code:last.aborted?'wait_failure_observed':last.incomplete?'wait_observation_incomplete':'wait_condition_timeout',message:last.aborted?'A known failure was observed. Inspect the returned state; do not replay prior steps.':last.incomplete?'The accessible tree was incomplete; inspect the returned state before continuing. Do not replay prior steps.':'Expected observed text was not found. Inspect the returned state; do not replay prior steps.'},batch:{completed,failed_index:i,skipped:plan.length-i-1,phase:'wait'}};
    }
    if(n==='computer_wait_change'&&!last.changed){
     completed.pop();return {...last,ok:false,verification_error:{code:last.incomplete?'wait_observation_incomplete':'wait_change_timeout',message:last.incomplete?'The accessible tree was incomplete; inspect the returned state before continuing. Do not replay prior steps.':'No accessible tree change was observed. Inspect the returned state; do not replay prior steps.'},batch:{completed,failed_index:i,skipped:plan.length-i-1,phase:'wait'}};
    }
    observation=last.metadata?.observation_id;
   }catch(e){return {ok:false,completed,failed_index:i,skipped:plan.length-i-1,...(safeWaitMetrics(e.wait_metrics)?{wait_metrics:safeWaitMetrics(e.wait_metrics)}:{}),...(e.delivery_unknown===true||e.code==='input_outcome_unknown'?{delivery_unknown:true}:{}),error:{code:e.code||'batch_step_failed',message:e.message,...(e.hint?{hint:e.hint}:{})},observe_before_continuing:true};}
  }
  return {...last,batch:{completed,skipped:0}};
 }
 return r.action(OPS[name],a);
}
export function content(v){
 const image=v?.image;const clean={...v};
 if(v?.metadata){
  clean.metadata={...v.metadata};
  // The rendered tree already contains the observation-scoped control indexes.
  // Avoid sending the same accessibility hierarchy twice on every action.
  if(clean.metadata.tree)delete clean.metadata.elements;
  delete clean.metadata.image;
 }
 if(image)clean.image={width:image.width,height:image.height,source:image.source};
 return [{type:'text',text:JSON.stringify(clean)},...(image?.data?[{type:'image',data:image.data,mimeType:image.mime||'image/jpeg'}]:[])];
}
