// Same-directory metadata publication. Flush the complete file before exposing
// it; never truncate the previous recovery journal in place.
import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
export function readTaskRecord(file,{io=fs}={}){
 let fd,observed=false;
 try{const entry=io.lstatSync(file,{bigint:true});observed=true;if(!entry.isFile()||entry.isSymbolicLink()||entry.nlink!==1n||entry.size>1024n)throw Error();
  fd=io.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));const opened=io.fstatSync(fd,{bigint:true});
  if(!opened.isFile()||opened.nlink!==1n||opened.size>1024n||opened.dev!==entry.dev||opened.ino!==entry.ino)throw Error();
  // The file can grow after fstat. Read at most one byte beyond the limit,
  // rather than allowing readFileSync to allocate for an unbounded stream.
  const bytes=Buffer.alloc(1025);let used=0;
  while(used<bytes.length){const count=io.readSync(fd,bytes,used,bytes.length-used,null);if(!Number.isSafeInteger(count)||count<0||count>bytes.length-used)throw Error();if(!count)break;used+=count;}
  if(used>1024)throw Error();const after=io.fstatSync(fd,{bigint:true});
  if(after.size!==opened.size||BigInt(used)!==opened.size||after.mtimeNs!==opened.mtimeNs||after.ctimeNs!==opened.ctimeNs)throw Error();
  const value=JSON.parse(bytes.subarray(0,used).toString('utf8'));if(value?.schema!==1||typeof value.open!=='boolean')throw Error();
  if(value.guard!==undefined&&(typeof value.guard!=='string'||!/^guard-[1-9][0-9]{0,9}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.state$/.test(value.guard)))throw Error();
  if(value.children!==undefined&&(!Array.isArray(value.children)||value.children.length>32||value.children.some(pid=>!Number.isSafeInteger(pid)||pid<=0||pid>4294967295)||new Set(value.children).size!==value.children.length))throw Error();
  if(value.dispatched!==undefined&&typeof value.dispatched!=='boolean')throw Error();
  if(value.watchdogs_complete!==undefined&&typeof value.watchdogs_complete!=='boolean')throw Error();
  const current=io.lstatSync(file,{bigint:true});if(!current.isFile()||current.isSymbolicLink()||current.nlink!==1n||current.dev!==opened.dev||current.ino!==opened.ino||current.size!==opened.size||current.mtimeNs!==opened.mtimeNs||current.ctimeNs!==opened.ctimeNs)throw Error();
  return {open:value.open,guard:value.guard??null,children:value.children??null,dispatched:value.dispatched??null,watchdogs_complete:value.watchdogs_complete??null};}
 catch(error){if(error.code==='ENOENT'&&!observed)return {open:false,guard:null,children:null,dispatched:null,watchdogs_complete:null};throw Object.assign(Error('task_state_invalid: inspect private storage before continuing.'),{code:'task_state_invalid'});}
 finally{if(fd!==undefined)io.closeSync(fd);}
}
export function readTaskState(file){return readTaskRecord(file).open;}
export function writeAtomicJSON(file,value,{exclusive=false,io=fs}={}){
 return writeAtomicText(file,JSON.stringify(value),{exclusive,io});
}
export function writeAtomicText(file,bytes,{exclusive=false,io=fs}={}){
 const directory=path.dirname(file),temporary=path.join(directory,'.'+path.basename(file)+'.'+randomUUID()+'.tmp');
 let descriptor;
 try{
  descriptor=io.openSync(temporary,'wx',0o600);io.writeFileSync(descriptor,bytes);io.fsyncSync(descriptor);io.closeSync(descriptor);descriptor=undefined;
  if(exclusive){io.linkSync(temporary,file);io.unlinkSync(temporary);}else io.renameSync(temporary,file);
  let folder;
  try{folder=io.openSync(directory,'r');io.fsyncSync(folder);return {file_flushed:true,directory_flushed:true};}
  catch(error){
   // Node/Windows cannot always open or flush directory handles. The file flush
   // above is mandatory; unsupported directory flush is not a power-loss pass.
   if(!['EPERM','EACCES','EISDIR','EINVAL','ENOTSUP','EOPNOTSUPP'].includes(error.code))throw error;
   return {file_flushed:true,directory_flushed:false};
  }finally{if(folder!==undefined)io.closeSync(folder);}
 }finally{
  if(descriptor!==undefined)io.closeSync(descriptor);
  if(io.existsSync(temporary))io.unlinkSync(temporary);
 }
}
export function flushPreparedFile(file){const info=fs.lstatSync(file);if(!info.isFile()||info.isSymbolicLink())throw Error('prepared_payload_not_regular');const fd=fs.openSync(file,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
export function flushPreparedTree(directory){
 const info=fs.lstatSync(directory);if(!info.isDirectory()||info.isSymbolicLink())throw Error('prepared_payload_not_directory');
 for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())flushPreparedTree(file);else flushPreparedFile(file);}
}
