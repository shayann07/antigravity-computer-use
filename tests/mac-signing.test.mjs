import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import {macSigning,macSignArguments} from '../server/macos-build.mjs';
import {testDirectory} from './paths.mjs';

test('Mac helper stays ad-hoc unless an owner signing identity is configured',()=>{
 assert.equal(macSigning({}),null);
 assert.deepEqual(macSignArguments(null,'/x/A.app'),['--force','--sign','-','/x/A.app']);
});
test('a configured Mac signing identity is validated and signs without a timestamp',()=>{
 const sha='867af5502ab4fe0a1c9f45a86683479be1e5dfcc';
 const keychain=path.join(testDirectory('tmp'),'signing-'+process.pid+'.keychain-db');fs.writeFileSync(keychain,'');
 try{
  const signing=macSigning({AGCU_MAC_SIGN_IDENTITY:sha,AGCU_MAC_SIGN_KEYCHAIN:keychain});
  assert.deepEqual(signing,{identity:sha.toUpperCase(),keychain});
  assert.deepEqual(macSignArguments(signing,'/x/A.app'),['--force','--sign',sha.toUpperCase(),'--timestamp=none','--keychain',keychain,'/x/A.app']);
  for(const env of [{AGCU_MAC_SIGN_IDENTITY:'Apple Development: someone'},{AGCU_MAC_SIGN_IDENTITY:sha.slice(1)},{AGCU_MAC_SIGN_IDENTITY:sha,AGCU_MAC_SIGN_KEYCHAIN:'relative.keychain-db'},{AGCU_MAC_SIGN_IDENTITY:sha,AGCU_MAC_SIGN_KEYCHAIN:keychain+'.missing'}])
   assert.throws(()=>macSigning(env),e=>e.code==='mac_signing_invalid',JSON.stringify(env));
 }finally{fs.rmSync(keychain,{force:true});}
});
