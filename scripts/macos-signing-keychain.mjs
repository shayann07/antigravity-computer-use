#!/usr/bin/env node
// Imports the Mac helper signing certificate into a separate, temporary
// keychain file for one build, without touching the login keychain or the
// keychain search list.
//
//   node scripts/macos-signing-keychain.mjs create <keychain> <p12-file> <expected-sha1>
//     reads the PKCS#12 password from AGCU_MAC_HELPER_P12_PASSWORD
//   node scripts/macos-signing-keychain.mjs delete <keychain>
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';

const [command,keychain,p12,expected]=process.argv.slice(2);
const security=(argv,label)=>{
  const result=spawnSync('/usr/bin/security',argv,{encoding:'utf8'});
  if(result.status!==0)throw Error(`security ${label} failed: ${(result.stderr||result.stdout||'').trim()}`);
  return result.stdout;
};
if(process.platform!=='darwin')throw Error('Mac helper signing needs macOS.');
if(!keychain||!path.isAbsolute(keychain))throw Error('Pass an absolute keychain path.');
if(command==='delete'){
  if(fs.existsSync(keychain))security(['delete-keychain',keychain],'delete-keychain');
  console.log(JSON.stringify({ok:true,deleted:keychain}));
}else if(command==='create'){
  const password=(process.env.AGCU_MAC_HELPER_P12_PASSWORD||'').trim();
  if(!p12||!fs.existsSync(p12)||!password)throw Error('Pass the .p12 file and set AGCU_MAC_HELPER_P12_PASSWORD.');
  if(!/^[0-9A-F]{40}$/i.test(expected||''))throw Error('Pass the expected certificate SHA-1.');
  if(fs.existsSync(keychain))throw Error('The keychain file already exists.');
  const keychainPassword=randomBytes(24).toString('hex');
  security(['create-keychain','-p',keychainPassword,keychain],'create-keychain');
  try{
    security(['set-keychain-settings','-lut','3600',keychain],'set-keychain-settings');
    security(['unlock-keychain','-p',keychainPassword,keychain],'unlock-keychain');
    security(['import',p12,'-k',keychain,'-P',password,'-f','pkcs12','-T','/usr/bin/codesign'],'import');
    security(['set-key-partition-list','-S','apple-tool:,apple:,codesign:','-s','-k',keychainPassword,keychain],'set-key-partition-list');
    // A self-signed certificate is not trusted, so list every identity, not
    // only valid ones, and require the expected one.
    const identities=security(['find-identity','-p','codesigning',keychain],'find-identity');
    if(!identities.toUpperCase().includes(expected.toUpperCase()))throw Error('The imported certificate is not the expected one.');
  }catch(error){spawnSync('/usr/bin/security',['delete-keychain',keychain]);throw error;}
  console.log(JSON.stringify({ok:true,keychain,identity:expected.toUpperCase()}));
}else throw Error('Use create or delete.');
