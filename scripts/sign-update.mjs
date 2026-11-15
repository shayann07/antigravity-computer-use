// Maintainer-only release preparation. Private keys never belong in the repository.
import fs from 'node:fs';import path from 'node:path';import {sign,createPublicKey} from 'node:crypto';
import {sha256} from '../server/update-core.mjs';
const [bundle,keyFile,sequence,minOS,output]=process.argv.slice(2);
if(!output||!/^\d+$/.test(sequence)||!/^\d+\.\d+\.\d+$/.test(minOS))throw Error('Usage: sign-update BUNDLE PRIVATE_KEY SEQUENCE MIN_KERNEL_VERSION NEW_OUTPUT_DIR');
const destination=path.resolve(output);if(fs.existsSync(destination))throw Error('Output must be new.');
const record=JSON.parse(fs.readFileSync(path.join(bundle,'bundle-manifest.json')));const files={};
const entries={...record.files,'bundle-manifest.json':sha256(fs.readFileSync(path.join(bundle,'bundle-manifest.json')))};
fs.mkdirSync(destination,{recursive:true});
for(const [name,hash]of Object.entries(entries)){
 if(name.split('/').some(p=>p==='..'||p==='.')||name.includes('\\')||path.isAbsolute(name))throw Error('Unsafe bundle path');
 const file=path.join(bundle,name),bytes=fs.readFileSync(file);if(sha256(bytes)!==hash)throw Error('Bundle inventory changed');
 const asset=hash+'-'+path.basename(name);fs.copyFileSync(file,path.join(destination,asset));
 files[name]={size:bytes.length,sha256:hash,url:`https://github.com/shayann07/antigravity-computer-use/releases/download/v${record.version}/${asset}`};
}
const manifest=Buffer.from(JSON.stringify({schema:1,version:record.version,build_id:record.build_id,sequence:Number(sequence),platform:record.platform,arch:record.arch,min_os:minOS,expires:new Date(Date.now()+365*86400000).toISOString(),files}));
const key=fs.readFileSync(keyFile==='-'?0:keyFile);const publicKey=createPublicKey(key).export({type:'spki',format:'pem'});
const pinned=fs.readFileSync(new URL('../release-public-key.pem',import.meta.url),'utf8');if(publicKey!==pinned)throw Error('Signing key does not match pinned public key.');
fs.writeFileSync(path.join(destination,`update-${record.platform}-${record.arch}.json`),JSON.stringify({manifest:manifest.toString('base64'),signature:sign(null,manifest,key).toString('base64')}));
console.log(JSON.stringify({prepared:true,assets:Object.keys(files).length+1,output:destination}));
