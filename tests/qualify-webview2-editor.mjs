// Run on an interactive x64 Windows desktop with the WebView2 Runtime:
// node tests/qualify-webview2-editor.mjs <extracted Microsoft.Web.WebView2 SDK>
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ensureHost} from '../server/build.mjs';
import {testDirectory} from './paths.mjs';

if(process.platform!=='win32'||process.arch!=='x64'||!process.argv[2]){
 throw Error('Pass the extracted WebView2 SDK folder on an x64 Windows desktop.');
}
const sdk=path.resolve(process.argv[2]);
const directory=fs.mkdtempSync(path.join(testDirectory('webview2-editor'),'run-'));
const framework=path.join(process.env.WINDIR,'Microsoft.NET');
const references=['System.Windows.Forms.dll','System.Drawing.dll'];
for(const name of ['UIAutomationClient','UIAutomationTypes','WindowsBase']){
 const folder=path.join(framework,'assembly/GAC_MSIL',name);
 const version=fs.readdirSync(folder).find(entry=>entry.startsWith('v4.0_'));
 if(!version)throw Error('Missing .NET Framework assembly: '+name);
 references.push(path.join(folder,version,name+'.dll'));
}
for(const name of ['Microsoft.Web.WebView2.WinForms.dll','Microsoft.Web.WebView2.Core.dll']){
 fs.copyFileSync(path.join(sdk,'lib/net462',name),path.join(directory,name));
 references.push(name);
}
fs.copyFileSync(path.join(sdk,'build/native/x64/WebView2Loader.dll'),path.join(directory,'WebView2Loader.dll'));
function run(command,args){
 const result=spawnSync(command,args,{cwd:directory,encoding:'utf8',timeout:60000,windowsHide:true});
 if(result.error)throw result.error;
 if(result.status!==0)throw Error(result.stderr||result.stdout||'Editor qualification failed');
 return result.stdout;
}
const source=fileURLToPath(new URL('./WebView2EditorProbe.cs',import.meta.url));
run(path.join(framework,'Framework64/v4.0.30319/csc.exe'),[
 '/nologo','/platform:x64','/out:EditorProbe.exe',...references.map(file=>'/reference:'+file),source
]);
const output=run(path.join(directory,'EditorProbe.exe'),[ensureHost().exe,directory]);
fs.writeFileSync(path.join(directory,'result.txt'),output);
console.log(output.trim()+'\n'+directory);
