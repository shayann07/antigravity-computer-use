import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describeCommand} from '../scripts/desktop.mjs';
import {desktopCommand} from '../scripts/install.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skill = fs.readFileSync(path.join(root, 'skills', 'computer-use', 'SKILL.md'), 'utf8');

test('computer-use entrypoint fits the observed host window after installation and starts with a supported command', () => {
  const entrypoint = /```powershell\s+\{\{DESKTOP_COMMAND\}\} (\w+)\s+```/.exec(skill);
  assert(entrypoint, 'the first terminal example needs the installed command');
  assert.equal(describeCommand(entrypoint[1]).command, 'ready', 'the documented entrypoint must resolve in the actual CLI');
  for(const platform of ['win32','darwin']){
    const base=platform==='win32'?"D:/Private User's Applications/AntigravityComputerUse-long-installation-scope":"/Users/example/Library/Application Support/AntigravityComputerUse-long-installation-scope";
    const command=desktopCommand(base+'/cu-node'+(platform==='win32'?'.exe':''),base+'/cu.mjs',platform);
    const rendered=skill.replaceAll('{{DESKTOP_COMMAND}}',command).replaceAll('{{CONTROLLER_START}}',base+'/Start Computer Use'+(platform==='win32'?'.cmd':'.command'));
    assert(Buffer.byteLength(rendered,'utf8')<=3500,'the complete installed entrypoint must fit before the host clips its safety rules');
    assert(!rendered.includes('{{'),'no installer template may remain in the rendered entrypoint');
  }
});

test('conditional skill pages are reachable and fit a single host read without unresolved templates',()=>{
  const folder=path.join(root,'skills','computer-use'),seen=new Set();
  function check(file){
    if(seen.has(file))return;seen.add(file);const text=fs.readFileSync(file,'utf8');
    if(file!==path.join(folder,'SKILL.md')){assert(Buffer.byteLength(text,'utf8')<=3500,path.basename(file)+' exceeds the observed host window');assert(!text.includes('{{'),'references are copied verbatim by the installer');}
    for(const match of text.matchAll(/\]\(([^)]+\.md)\)/g)){
      const target=path.resolve(path.dirname(file),match[1]);const relative=path.relative(folder,target);
      assert(!relative.startsWith('..')&&!path.isAbsolute(relative),'references must stay in the packaged skill');check(target);
    }
  }
  check(path.join(folder,'SKILL.md'));assert(seen.size>1);
});
