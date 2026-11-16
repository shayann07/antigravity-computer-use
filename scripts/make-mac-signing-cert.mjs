#!/usr/bin/env node
// Creates the long-lived certificate that signs the Mac helper, for the
// project owner to run once on their own machine. macOS keeps users'
// Accessibility, Screen Recording and Input Monitoring permissions for every
// later helper signed by this same certificate, so it must never be replaced
// casually: a new certificate makes every user grant the permissions again.
//
// Usage: node scripts/make-mac-signing-cert.mjs <output-directory> [--name "Common Name"]
// Needs the openssl command (macOS, Linux, or Git for Windows).
// Writes helper-signing.p12, helper-signing.p12.base64 and
// helper-signing.password into the output directory; the private key never
// leaves that directory except through the commands it prints.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomBytes,X509Certificate} from 'node:crypto';

const args=process.argv.slice(2);
const output=args[0];
const nameAt=args.indexOf('--name');
const name=nameAt>0?args[nameAt+1]:'Antigravity Computer Use helper (shayann07)';
if(!output||output.startsWith('--')||(nameAt>0&&!name)){
  console.error('Usage: node scripts/make-mac-signing-cert.mjs <output-directory> [--name "Common Name"]');process.exit(2);
}
if(!/^[A-Za-z0-9 ()._-]{1,64}$/.test(name)){console.error('Use letters, digits, spaces and ()._- in the name.');process.exit(2);}
const dir=path.resolve(output);
fs.mkdirSync(dir,{recursive:true,mode:0o700});
const p12=path.join(dir,'helper-signing.p12');
if(fs.existsSync(p12)){console.error(`${p12} already exists. Keep using it; a new certificate makes every user grant permissions again.`);process.exit(1);}

const openssl=(argv,label)=>{
  const result=spawnSync('openssl',argv,{encoding:'utf8'});
  if(result.error||result.status!==0){console.error(`openssl ${label} failed: ${result.error?.message||result.stderr}`);process.exit(1);}
  return result;
};
const key=path.join(dir,'helper-signing.key.pem'),cert=path.join(dir,'helper-signing.cert.pem');
try{
  // 20 years: renewing means a new certificate, which resets every user's grants.
  openssl(['req','-x509','-newkey','rsa:3072','-nodes','-sha256','-days','7300','-keyout',key,'-out',cert,'-subj',`/CN=${name}`,
    '-addext','basicConstraints=critical,CA:FALSE','-addext','keyUsage=critical,digitalSignature','-addext','extendedKeyUsage=critical,codeSigning'],'certificate');
  const password=randomBytes(24).toString('hex');
  // macOS `security import` rejects PKCS#12 files using OpenSSL 3's default
  // AES/PBKDF2 protection, so use the 3DES/SHA-1 form it accepts.
  openssl(['pkcs12','-export','-inkey',key,'-in',cert,'-name',name,'-out',p12,'-passout',`pass:${password}`,
    '-keypbe','PBE-SHA1-3DES','-certpbe','PBE-SHA1-3DES','-macalg','sha1'],'PKCS#12 export');
  fs.writeFileSync(path.join(dir,'helper-signing.password'),password+'\n',{mode:0o600});
  fs.writeFileSync(path.join(dir,'helper-signing.p12.base64'),fs.readFileSync(p12).toString('base64')+'\n',{mode:0o600});
  fs.chmodSync(p12,0o600);
  const fingerprint=new X509Certificate(fs.readFileSync(cert)).fingerprint.replaceAll(':','');
  fs.writeFileSync(path.join(dir,'helper-signing.sha1'),fingerprint+'\n');
  console.log(JSON.stringify({ok:true,common_name:name,sha1:fingerprint,directory:dir,files:['helper-signing.p12','helper-signing.p12.base64','helper-signing.password','helper-signing.sha1']},null,1));
  console.log(`
Store the key only in the protected "release" environment, then keep an offline backup of the
.p12 and password. Losing them makes every user grant the Mac permissions again.

  gh secret set AGCU_MAC_HELPER_P12 --env release --repo shayann07/antigravity-computer-use < "${path.join(dir,'helper-signing.p12.base64')}"
  gh secret set AGCU_MAC_HELPER_P12_PASSWORD --env release --repo shayann07/antigravity-computer-use < "${path.join(dir,'helper-signing.password')}"
  gh variable set AGCU_MAC_HELPER_SHA1 --env release --repo shayann07/antigravity-computer-use --body ${fingerprint}
`);
}finally{fs.rmSync(key,{force:true});}
