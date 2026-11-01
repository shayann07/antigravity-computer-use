import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {testDirectory} from './paths.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const compiler=path.join(process.env.WINDIR||'C:/Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe');
function compile(output,...files){
 const result=spawnSync(compiler,['-nologo','-target:exe','-r:System.Drawing.dll','-out:'+output,...files],{encoding:'utf8',windowsHide:true,timeout:30000});
 assert.equal(result.status,0,result.stdout||result.stderr||result.error?.message);
}
function fixture(){
 const dir=fs.mkdtempSync(path.join(testDirectory('tmp'),'liquidglass-client-'));
 const bin=path.join(dir,'bin'),helper=path.join(dir,'liquidglass');fs.mkdirSync(bin);fs.mkdirSync(helper);
 const probe=path.join(bin,'probe.exe');
 compile(probe,path.join(root,'server/native/LiquidGlassPackageClient.cs'),path.join(root,'tests/LiquidGlassClientProbe.cs'));
 return {dir,bin,helper,probe};
}
function run(f,kind){
 const result=spawnSync(f.probe,[kind,path.join(f.dir,'package-surface.png')],{encoding:'utf8',windowsHide:true,timeout:30000,env:{...process.env,AGCU_LIQUIDGLASS_HELPER:'ignored-untrusted-path'}});
 assert.equal(result.status,0,result.stdout||result.stderr||result.error?.message);
 assert.match(result.stdout,/package_client_ok/);
}

test('packaged HUD client finds its sibling helper, coalesces renders and cleans up',{skip:process.platform!=='win32',timeout:60000},async()=>{
 const f=fixture();compile(path.join(f.helper,'LiquidGlass.Host.exe'),path.join(root,'tests/LiquidGlassFakeHelper.cs'));
 run(f,'fake');
 assert.deepEqual(fs.readFileSync(path.join(f.helper,'requests.txt'),'utf8').trim().split(/\r?\n/),['468|50|active','468|50|paused','200|40|active']);
 const pid=Number(fs.readFileSync(path.join(f.helper,'fixture.pid'),'utf8'));let gone=false;
 for(let i=0;i<100&&!gone;i++){try{process.kill(pid,0);}catch(error){gone=error.code==='ESRCH';}if(!gone)await new Promise(resolve=>setTimeout(resolve,25));}
 assert.equal(gone,true,'The owned helper process did not exit');
});

test('a hung visual helper is retired and can recover without blocking the HUD',{skip:process.platform!=='win32',timeout:60000},async()=>{
 const f=fixture();compile(path.join(f.helper,'LiquidGlass.Host.exe'),path.join(root,'tests/LiquidGlassFakeHelper.cs'));
 fs.writeFileSync(path.join(f.helper,'hang.once'),'');run(f,'fake');
 const pids=fs.readFileSync(path.join(f.helper,'pids.txt'),'utf8').trim().split(/\r?\n/).map(Number);assert(pids.length>=2,'The hung helper was not replaced');
 for(const pid of pids){let gone=false;for(let i=0;i<100&&!gone;i++){try{process.kill(pid,0);}catch(error){gone=error.code==='ESRCH';}if(!gone)await new Promise(resolve=>setTimeout(resolve,25));}assert.equal(gone,true,'A fixture helper process did not exit');}
});

test('published LiquidGlass helper renders through the native client',{skip:process.platform!=='win32'||!process.env.AGCU_LIQUIDGLASS_HELPER_BUILD,timeout:60000},()=>{
 const f=fixture(),source=path.resolve(process.env.AGCU_LIQUIDGLASS_HELPER_BUILD);
 for(const name of ['LiquidGlass.Host.exe','libSkiaSharp.dll'])fs.copyFileSync(path.join(source,name),path.join(f.helper,name));
 run(f,'package');
 assert(fs.statSync(path.join(f.dir,'package-surface.png')).size>100);
});
