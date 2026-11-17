// Native integration in an already isolated test installation. Production uses
// identical storage, installer, service, signature and rollback paths; only the
// release transport and public test key are substituted. No desktop input.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';import {pathToFileURL} from 'node:url';
export async function qualifySignedUpdate({target,bundle,directory}){
 const installed=JSON.parse(fs.readFileSync(path.join(target,'installation.json')));
 const {update}=await import(pathToFileURL(path.join(installed.release,'scripts/update.mjs')).href);
 const candidate=path.join(directory,'signed-candidate');fs.cpSync(bundle,candidate,{recursive:true});
 const skill=path.join(candidate,'skills/computer-use/SKILL.md');fs.appendFileSync(skill,'\nNative updater qualification candidate.\n');
 const sha=b=>createHash('sha256').update(b).digest('hex');
 const metadataFile=path.join(candidate,'bundle-manifest.json'),metadata=JSON.parse(fs.readFileSync(metadataFile));
 const versionParts=metadata.version.split('-')[0].split('.').map(Number);metadata.version=`${versionParts[0]}.${versionParts[1]}.${versionParts[2]+1}${metadata.version.includes('-')?'-ci.1':''}`;metadata.files['skills/computer-use/SKILL.md']=sha(fs.readFileSync(skill));metadata.build_id=sha(JSON.stringify(metadata.files));fs.writeFileSync(metadataFile,JSON.stringify(metadata));
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');const keyFile=path.join(directory,'qualification-public.pem');fs.writeFileSync(keyFile,publicKey.export({type:'spki',format:'pem'}));
 const files={},payloads=new Map();for(const name of [...Object.keys(metadata.files),'bundle-manifest.json']){
  const bytes=fs.readFileSync(path.join(candidate,name)),hash=sha(bytes),url=`https://github.com/shayann07/antigravity-computer-use/releases/download/v${metadata.version}/${hash}-${path.basename(name)}`;
  files[name]={sha256:hash,size:bytes.length,url};payloads.set(url,path.join(candidate,name));
 }
 const bytes=Buffer.from(JSON.stringify({schema:1,version:metadata.version,build_id:metadata.build_id,sequence:1,platform:process.platform,arch:process.arch,min_os:'0.0.0',expires:'2099-01-01',files}));
 const envelope={manifest:bytes.toString('base64'),signature:sign(null,bytes,privateKey).toString('base64')};
 const fetcher=async url=>{
  if(url.startsWith('https://api.github.com/'))return {ok:true,json:async()=>[{draft:false,assets:[{name:`update-${process.platform}-${process.arch}.json`,browser_download_url:'https://github.com/shayann07/antigravity-computer-use/releases/download/v0.3.1-ci.1/test-metadata.json'}]}]};
  if(url.endsWith('/test-metadata.json'))return {ok:true,text:async()=>JSON.stringify(envelope)};
  if(!payloads.has(url))throw Error('Unexpected qualification download');return {ok:true,body:fs.createReadStream(payloads.get(url))};
 };
 const options={fetcher,adapters:{keyFile}};
 assert((await update(target,'check',options)).available);
 assert((await update(target,'apply',options)).applied);
 const upgraded=JSON.parse(fs.readFileSync(path.join(target,'installation.json')));
 assert.equal(JSON.parse(fs.readFileSync(path.join(upgraded.release,'bundle-manifest.json'))).build_id,metadata.build_id);
 assert(fs.existsSync(path.join(target,'data/emergency.stop')));
 assert.equal((await update(target,'status',options)).settings.channel,'beta');
 const {update:updatedClient}=await import(pathToFileURL(path.join(upgraded.release,'scripts/update.mjs')).href);
 const rollbackResult=await updatedClient(target,'rollback',options);
 assert(rollbackResult.rolled_back,JSON.stringify(rollbackResult));
 assert.equal(JSON.parse(fs.readFileSync(path.join(target,'installation.json'))).release,installed.release);
 assert(fs.existsSync(path.join(target,'data/emergency.stop')));
 return {signed_native_update:true,native_rollback:true,stop_preserved:true,desktop_input_sent:false,production_release_transport_tested:false};
}
