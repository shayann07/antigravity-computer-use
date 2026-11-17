import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');

test('install.sh and install.ps1 pin the same release',()=>{
 const sh=read('install.sh'),ps=read('install.ps1');
 const shVersion=/^VERSION=(\d+\.\d+\.\d+)$/m.exec(sh)?.[1];
 const psVersions=[...ps.matchAll(/releases\/download\/v(\d+\.\d+\.\d+)\//g)].map(m=>m[1]);
 assert.ok(shVersion,'install.sh sets VERSION');assert.ok(psVersions.length,'install.ps1 has release URLs');
 for(const v of psVersions)assert.equal(v,shVersion);
});

test('install.sh verifies the archive before it extracts or runs anything',()=>{
 const sh=read('install.sh');
 assert.match(sh,/^set -eu$/m);
 const verify=sh.indexOf('SHA-256 check failed'),extract=sh.indexOf('tar -xzf'),run=sh.indexOf('./macos-bundle/install.command');
 assert.ok(verify>0&&verify<extract&&extract<run,'checksum, then extract, then install');
 assert.match(sh,/--proto '=https'/);
});
