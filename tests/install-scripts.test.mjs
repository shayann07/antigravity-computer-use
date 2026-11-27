import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {testDirectory} from './paths.mjs';
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
// Use Git's native Windows shell for this Windows-filesystem fixture. WSL
// can leave its private mode-0700 staging folders inaccessible to Node.
const gitExec=process.platform==='win32'?spawnSync('git',['--exec-path'],{encoding:'utf8'}).stdout?.trim():null;
const bash=gitExec?path.resolve(gitExec,'../../../bin/bash.exe'):'bash';
test('each install.sh run stages in its own private folder (#140)',{skip:spawnSync(bash,['-c','command -v mktemp'],{encoding:'utf8'}).status!==0},()=>{
 const sh=read('install.sh');
 assert.doesNotMatch(sh,/rm -rf "\$STAGE"/,'a run never deletes a shared stage');
 const start=sh.indexOf('CACHE='),end=sh.indexOf('cd "$STAGE"');assert.ok(start>0&&end>start);
 const home=fs.mkdtempSync(path.join(testDirectory('tmp'),'install-sh-'));
 try{
  // Pass shell source on stdin, preserving its own quoting on both platforms.
  const snippet='set -eu\nexport HOME="$PWD"\nfail(){ echo "$1" >&2; exit 1; }\nVERSION=9.9.9\nARCH=macos-arm64\n'+sh.slice(start,end)+'basename "$STAGE"\n';
  const run=()=>{
   const r=spawnSync(bash,['-s'],{input:snippet,encoding:'utf8',cwd:home});
   assert.equal(r.status,0,r.stderr);
   const name=r.stdout.trim();assert.match(name,/^install-9\.9\.9-macos-arm64\.[a-zA-Z0-9]+$/);
   return path.join(home,'Library/Caches/AntigravityComputerUse',name);
  };
  const first=run(),second=run();
  assert.notEqual(first,second);assert.ok(fs.existsSync(first)&&fs.existsSync(second),'the first stage survives a second run');
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
