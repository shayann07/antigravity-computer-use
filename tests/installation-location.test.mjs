import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import fs from 'node:fs';import {defaultInstallationRoot} from '../server/storage.mjs';
test('Windows default installation is account scoped below Apps, never at the drive root',{skip:process.platform!=='win32'},()=>{
 const target=defaultInstallationRoot({hasD:true});assert.match(target,/^D:\\Apps\\AntigravityComputerUse\\[a-f0-9]{10}$/);assert.notEqual(path.dirname(target),'D:\\');
 assert.equal(defaultInstallationRoot({hasD:false,localAppData:'C:\\Users\\fixture\\AppData\\Local'}),'C:\\Users\\fixture\\AppData\\Local\\AntigravityComputerUse');
});
test('native ACL audit anchor follows the nested installation layout',()=>{
 const source=fs.readFileSync(new URL('../server/native/StorageGuard.cs',import.meta.url),'utf8');assert(source.includes('Path.Combine("D:\\\\","Apps","AntigravityComputerUse",suffix)'));assert(!source.includes('audit=Path.Combine("D:\\\\","AntigravityComputerUse-"+suffix)'));
});
