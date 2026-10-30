// Hash the exact checked-out bytes, including authored modifications. Keep
// upstream revision/hashes intact; .gitattributes specifies canonical source LF.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const file=path.join(root,'UPSTREAM.json');
const record=JSON.parse(fs.readFileSync(file,'utf8'));
const mismatches=[];
for(const [entries,key] of [[record.files,'local_sha256'],[record.authored_files,'sha256'],[record.external_files||[],'local_sha256']]){
 for(const entry of entries){
  const actual=createHash('sha256').update(fs.readFileSync(path.join(root,entry.path))).digest('hex');
  if(entry[key]!==actual)mismatches.push(entry.path);
  if(process.argv.includes('--write')){
   entry[key]=actual;
   if(entry.upstream_sha256)entry.modified=actual!==entry.upstream_sha256;
  }
 }
}
if(process.argv.includes('--write'))fs.writeFileSync(file,JSON.stringify(record,null,2)+'\n');
console.log(JSON.stringify({checked:record.files.length+record.authored_files.length+(record.external_files||[]).length,updated:process.argv.includes('--write'),mismatches}));
if(mismatches.length&&!process.argv.includes('--write'))process.exitCode=1;
