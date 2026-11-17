import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {classify,accessTier,resolveCallerHost,aiGroupOf,TIER} from '../server/policy.mjs';
import {Runtime} from '../server/runtime.mjs';

const hop=(pid,path)=>({pid,path,created:String(1000-pid)});
const cli=hop(1,'C:\\Apps\\cu\\cu-node.exe'),shell=hop(2,'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
const win=name=>({process:name,path:'C:\\Program Files\\'+name+'\\'+name+'.exe',title:name});

test('every AI app stays blocked without a resolved caller',()=>{
  for(const name of ['claude','ChatGPT','codex','Antigravity'])assert.equal(classify(win(name)).tier,TIER.BLOCKED,name);
  assert.equal(accessTier(win('ChatGPT')),null);
  assert.equal(classify(win('ChatGPT'),{}).tier,TIER.BLOCKED);
});

test('a Claude caller releases ChatGPT and Codex but keeps Claude blocked',()=>{
  const caller=resolveCallerHost([cli,shell,hop(3,'C:\\Users\\u\\AppData\\Local\\AnthropicClaude\\claude.exe')]);
  assert.equal(caller.host.name,'claude.exe');
  assert.deepEqual(caller.blocked_groups,['claude']);
  assert.deepEqual(caller.release.sort(),['antigravity','openai']);
  const policy={release:caller.release};
  assert.equal(classify(win('ChatGPT'),policy).tier,TIER.STANDARD);
  assert.equal(classify(win('codex'),policy).tier,TIER.STANDARD);
  assert.equal(classify(win('claude'),policy).tier,TIER.BLOCKED);
  assert.equal(accessTier(win('ChatGPT'),policy),'full');
});

test('a Codex caller blocks ChatGPT and Codex and releases Claude',()=>{
  const caller=resolveCallerHost([cli,shell,hop(3,'C:\\Program Files\\WindowsApps\\OpenAI.Codex\\codex.exe')]);
  const policy={release:caller.release};
  assert.equal(classify(win('claude'),policy).tier,TIER.STANDARD);
  assert.equal(classify(win('ChatGPT'),policy).tier,TIER.BLOCKED);
  assert.equal(classify(win('codex'),policy).tier,TIER.BLOCKED);
});

test('every AI app on the chain stays blocked, so a renamed helper cannot release its parent',()=>{
  const caller=resolveCallerHost([cli,hop(2,'C:\\Temp\\chatgpt.exe'),hop(3,'C:\\Program Files\\Antigravity\\Antigravity.exe')]);
  assert.deepEqual(caller.blocked_groups.sort(),['antigravity','openai']);
  assert.deepEqual(caller.release,['claude']);
  assert.equal(classify(win('Antigravity'),{release:caller.release}).tier,TIER.BLOCKED);
});

test('an unresolved chain releases nothing',()=>{
  assert.equal(resolveCallerHost(null),null);
  assert.equal(resolveCallerHost([]),null);
  assert.equal(resolveCallerHost([cli,shell]),null,'no AI app on the chain');
  assert.equal(resolveCallerHost([cli,{pid:2}]),null,'a hop without a path');
});

test('releasing AI apps never lifts the other protected entries',()=>{
  const policy={release:['claude','openai','antigravity']};
  for(const name of ['keepass','consent','logonui','lockapp','authenticator','securityhealthsystray'])assert.equal(classify(win(name),policy).tier,TIER.BLOCKED,name);
  assert.equal(aiGroupOf('/Applications/ChatGPT.app'),'openai');
  assert.equal(aiGroupOf('notepad.exe'),null);
});

test('the runtime binds the caller to the task and clears it on stop',async()=>{
  const chain=[cli,shell,hop(3,'C:\\x\\claude.exe')];
  const calls=[];
  const runtime=Object.create(Runtime.prototype);
  runtime.driver={call:async(op,args)=>{calls.push([op,args]);return op==='caller_gate_redeem'&&args.nonce==='a'.repeat(64)?{result:{resolved:true,chain}}:{result:{resolved:false,chain:[]}};}};
  if(process.platform!=='win32'&&process.platform!=='darwin'){assert.equal(await runtime.redeemCaller('a'.repeat(64)),null);return;}
  assert.equal((await runtime.redeemCaller('a'.repeat(64))).host.name,'claude.exe');
  assert.equal(runtime.callerReport().self_excluded_app,'claude.exe');
  assert.deepEqual(runtime.callerPolicy().release.sort(),['antigravity','openai']);
  assert.equal(await runtime.redeemCaller('b'.repeat(64)),null);
  assert.deepEqual(runtime.callerPolicy().release,[]);
  assert.equal(await runtime.redeemCaller('not-a-nonce'),null);
  assert.equal(calls.filter(([op])=>op==='caller_gate_redeem').length,2,'a malformed nonce never reaches native');
  assert.deepEqual(runtime.callerReport(),{self_excluded_app:null,released_ai_groups:[]});
  await runtime.redeemCaller('a'.repeat(64));
  runtime.stopping=Promise.resolve('already stopping');
  assert.equal(await runtime.stop(),'already stopping');
  assert.equal(runtime.callerHost,null,'stop clears the caller before anything else');
});

test('the native gate reports the kernel-verified client chain once',{skip:process.platform!=='win32'},async()=>{
  const {Driver}=await import('../server/driver.mjs');
  const driver=new Driver();
  try{
    await driver.start();
    const opened=(await driver.call('caller_gate_open',{})).result;
    assert.match(opened.pipe,/^\\\\\.\\pipe\\AGCU\.Gate\.[a-f0-9]{32}$/);
    const nonce=await new Promise((resolve,reject)=>{let buffer='';const socket=net.createConnection(opened.pipe);socket.setEncoding('utf8');socket.on('data',chunk=>{buffer+=chunk;if(buffer.includes('\n')){socket.destroy();resolve(buffer.trim());}});socket.on('error',reject);});
    assert.match(nonce,/^[a-f0-9]{64}$/);
    const first=(await driver.call('caller_gate_redeem',{nonce})).result;
    assert.equal(first.resolved,true);
    assert.equal(first.chain[0].pid,process.pid);
    assert.equal(first.chain[0].path.toLowerCase(),process.execPath.toLowerCase());
    for(let i=1;i<first.chain.length;i++)assert.ok(BigInt(first.chain[i].created)<BigInt(first.chain[i-1].created),'each parent is older than its child');
    assert.deepEqual((await driver.call('caller_gate_redeem',{nonce})).result,{resolved:false,chain:[]},'a nonce is redeemed once');
    assert.deepEqual((await driver.call('caller_gate_redeem',{nonce:'0'.repeat(64)})).result,{resolved:false,chain:[]});
    // The pipe accepts one client and is gone afterwards.
    await assert.rejects(new Promise((resolve,reject)=>{const socket=net.createConnection(opened.pipe);socket.on('connect',()=>{socket.destroy();resolve();});socket.on('error',reject);}));
  }finally{await driver.stop();}
});

test('macOS gate sockets are accepted only from a private agcu folder',async()=>{
  const {CALLER_GATE}=await import('../scripts/desktop.mjs');
  const hexName='a'.repeat(32);
  assert.ok(CALLER_GATE.test(`\\\\.\\pipe\\AGCU.Gate.${hexName}`));
  assert.ok(CALLER_GATE.test(`/var/folders/x9/q/T/agcu.Ab12Cd/gate.${hexName}`));
  for(const bad of [`/tmp/AGCU.Gate.${hexName}`,`/tmp/agcu-gate.Ab12Cd/AGCU.Gate.${'A'.repeat(32)}`,`/tmp/agcu-gate.Ab12Cd/AGCU.Gate.${hexName}\n`,'\\\\.\\pipe\\other',`relative/agcu.Ab12Cd/gate.${hexName}`])assert.equal(CALLER_GATE.test(bad),false,bad);
});

test('a Mac caller chain resolves by app bundle executables',()=>{
  const mac=(pid,p)=>({pid,path:p,created:String(1000-pid)});
  const chain=[mac(9,'/Users/u/Library/Application Support/AntigravityComputerUse/releases/r/node'),mac(8,'/bin/zsh'),mac(7,'/Applications/Antigravity.app/Contents/Frameworks/Antigravity Helper (Plugin).app/Contents/MacOS/Antigravity Helper (Plugin)'),mac(6,'/Applications/Antigravity.app/Contents/MacOS/Electron')];
  const r=resolveCallerHost(chain);
  assert.equal(r.host.group,'antigravity');assert.deepEqual(r.release.sort(),['claude','openai']);
  assert.equal(resolveCallerHost([mac(9,'/bin/zsh'),mac(8,'/Applications/Claude.app/Contents/MacOS/Claude')]).host.group,'claude');
  assert.equal(resolveCallerHost([mac(9,'/bin/zsh'),mac(8,'/usr/sbin/sshd')]),null,'no AI app on the chain releases nothing');
});

