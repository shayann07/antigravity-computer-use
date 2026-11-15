// Named arguments avoid per-step JSON request files. They are conveniences,
// not a second permission system; the shared tool schema remains authoritative.
import fs from 'node:fs';
const bad=message=>{throw Object.assign(Error(message+' No desktop request was sent.'),{code:'bad_arguments'});};
const readText=file=>fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');
export function parseArguments(schema,words,{read=readText,defaultImage=false}={}){
 if(!words.length)return {};
 if(words[0]==='--request'){
  if(words.length!==2)bad('Use --request FILE alone, or named flags.');
  return JSON.parse(read(words[1]));
 }
 if(!words[0].startsWith('--')){
  if(words.length!==1)bad('An inline JSON object must be one argument.');
  return JSON.parse(words[0]);
 }
 const properties=schema.properties||{};const result={};
 if(properties.observe?.type==='object')result.observe={with_image:defaultImage};
 const seen=new Set();
 for(let i=0;i<words.length;i++){
  const word=words[i];if(!word.startsWith('--'))bad('Expected a named flag, got '+word+'.');
  const split=word.indexOf('=');const flag=word.slice(2,split<0?undefined:split);let inline=split<0?undefined:word.slice(split+1);
  let key=flag.replaceAll('-','_'),nested=false,forced;
  if(flag==='image'||flag==='no-image'){key='with_image';forced=flag==='image';}
  if((key==='text_file'||key==='steps_file')){
   const target=key==='text_file'?'text':'steps';if(!properties[target])bad('--'+flag+' is not valid for this command.');
   if(seen.has(target))bad('Duplicate argument '+target+'.');seen.add(target);
   const file=inline??words[++i];if(!file||file.startsWith('--'))bad('--'+flag+' needs a file path.');
   result[target]=target==='text'?read(file):JSON.parse(read(file));continue;
  }
  // Agents pass --reason out of habit; commands without a reason field accept and ignore it.
  if(key==='reason'&&!properties.reason){if(inline===undefined&&words[i+1]!==undefined&&!words[i+1].startsWith('--'))i++;continue;}
  // key takes --keys; guessing --text by analogy with type/set_value is common.
  if(key==='text'&&!properties.text&&properties.keys)key='keys';
  let type=properties[key];
  if(!type&&properties.observe?.properties?.[key]){nested=true;type=properties.observe.properties[key];}
  if(!type)bad('Unknown flag --'+flag+'. Run describe for this command.');
  if((nested&&seen.has('observe'))||(key==='observe'&&[...seen].some(k=>k.startsWith('observe.'))))bad('Use --observe JSON or observation flags, not both.');
  const identity=(nested?'observe.':'')+key;if(seen.has(identity))bad('Duplicate argument '+identity+'.'+(properties[key]?.type==='array'?' Write an array once, as --'+flag+' X,Y or JSON such as --'+flag+" '[X,Y]'.":''));seen.add(identity);
  let value;
  if(forced!==undefined){if(inline!==undefined)bad('--'+flag+' takes no value.');value=forced;}
  else if(type.type==='boolean'){
   if(inline===undefined&&['true','false'].includes(words[i+1]))inline=words[++i];
   if(inline!==undefined&&!['true','false'].includes(inline))bad('--'+flag+' must be true or false.');
   value=inline===undefined||inline==='true';
  }else{
   const raw=inline??words[++i];if(raw===undefined||(inline===undefined&&raw.startsWith('--')))bad('--'+flag+' needs a value.');
   if(type.type==='integer'||type.type==='number'){value=Number(raw);if(!Number.isFinite(value))bad('--'+flag+' must be numeric.');}
   else if(type.type==='array'){
    if(raw.startsWith('['))value=JSON.parse(raw);
    else {const parts=raw.split(',');if(parts.some(v=>!v.trim()))bad('--'+flag+' has an empty array item.');value=parts.map(v=>type.items?.type==='integer'?Number(v):v);}
   }
   else if(type.type==='object')value=JSON.parse(raw);
   else value=raw;
  }
  if(nested)(result.observe??={})[key]=value;
  else result[key]=key==='observe'&&type.type==='object'?{with_image:false,...value}:value;
 }
 // A literal section query is usually discovery of controls, not a visual
 // checkpoint. Avoid an unnecessary JPEG/image-reading round trip. Explicit
 // --image still wins; JSON callers retain their original defaults.
 if(properties.with_image&&typeof result.query==='string'&&result.query.trim()&&!Object.hasOwn(result,'with_image'))result.with_image=false;
 return result;
}

// A shell-safe batch needs no JSON quoting or temporary plan-file tool call.
// Owner/frame/reason precede the first --step; all later flags belong to steps.
export function parseRunArguments(schema,words,describe,options={}){
 const first=words.indexOf('--step');if(first<0)return parseArguments(schema,words,options);
 const root=parseArguments(schema,words.slice(0,first),options);
 if(Object.hasOwn(root,'steps'))bad('Do not mix --step groups with JSON/file steps.');
 const groups=[];
 for(let i=first;i<words.length;){
  if(words[i]!=='--step')bad('Expected --step COMMAND.');
  const kind=words[++i];if(!kind||kind.startsWith('--'))bad('--step needs an action name.');
  const from=++i;while(i<words.length&&words[i]!=='--step')i++;
  groups.push({kind,words:words.slice(from,i)});
 }
 if(groups.length>8)bad('A batch accepts at most eight steps.');
 root.steps=groups.map(({kind,words},i)=>{
  const step=parseArguments(describe(kind).inputSchema,words,{...options,defaultImage:i===groups.length-1});
  if(Object.hasOwn(step,'hwnd')||Object.hasOwn(step,'observation_id'))bad('A batch step cannot replace its owner or frame.');
  return {kind,...step};
 });return root;
}
