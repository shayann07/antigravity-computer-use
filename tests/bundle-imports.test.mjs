// Every server module the installed runtime reaches by a relative import must
// be copied into the release bundle; a missing one stops the installed
// service from starting (found on Mac: conversation-approvals.mjs).
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),bundle=fs.readFileSync(path.join(root,'scripts/bundle.mjs'),'utf8');
const shipped=new Set();
for(const m of bundle.matchAll(/'([A-Za-z0-9_.-]+\.(?:mjs|json))'/g))shipped.add(m[1]);
for(const m of bundle.matchAll(/server\/([A-Za-z0-9_.-]+\.mjs)/g))shipped.add(m[1]);
test('bundle ships every server module reachable from the service entry points',()=>{
 const seen=new Set(),queue=['index.mjs','desktop-service.mjs','mcp.mjs'];
 while(queue.length){
  const name=queue.shift();if(seen.has(name))continue;seen.add(name);
  const source=fs.readFileSync(path.join(root,'server',name),'utf8');
  for(const m of source.matchAll(/(?:from|import)\s*\(?\s*['"]\.\/([A-Za-z0-9_.-]+\.(?:mjs|json))['"]/g))queue.push(m[1]);
 }
 const missing=[...seen].filter(name=>!shipped.has(name));
 assert.deepEqual(missing,[],`not copied by scripts/bundle.mjs: ${missing.join(', ')}`);
});
