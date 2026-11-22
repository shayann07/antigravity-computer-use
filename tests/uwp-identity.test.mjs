// Packaged (UWP) apps must keep their own identity and tier. Their top-level
// window belongs to the shared ApplicationFrameHost; the native layer reports
// the hosted app, and a frame it cannot resolve stays blocked.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {classify} from '../server/policy.mjs';

test('Windows Security, Settings and an unresolved app frame keep their tiers',()=>{
 assert.equal(classify({process:'SecHealthUI',path:'C:\Windows\SystemApps\Microsoft.SecHealthUI_8wekyb3d8bbwe\SecHealthUI.exe'}).tier,'blocked');
 assert.equal(classify({process:'ApplicationFrameHost',path:'C:\Windows\System32\ApplicationFrameHost.exe',title:'Calculator'}).tier,'blocked');
 assert.equal(classify({process:'SystemSettings',path:'C:\Windows\ImmersiveControlPanel\SystemSettings.exe'}).tier,'sensitive');
 assert.equal(classify({process:'CalculatorApp',path:'C:\Program Files\WindowsApps\Microsoft.WindowsCalculator_11.2507.0.0_x64__8wekyb3d8bbwe\CalculatorApp.exe'}).tier,'standard');
});

test('native identity and app listing resolve the app hosted in a frame window',()=>{
 const guardian=fs.readFileSync(new URL('../server/native/Guardian.cs',import.meta.url),'utf8');
 const host=fs.readFileSync(new URL('../server/native/AxonHost.cs',import.meta.url),'utf8');
 assert.match(guardian,/internal static int WindowProcess\(IntPtr hwnd\)/);
 assert.match(guardian,/"ApplicationFrameWindow"[\s\S]{0,200}"Windows\.UI\.Core\.CoreWindow"/);
 assert.match(guardian,/Identity\(long hwnd\) \{\s*int pid = WindowProcess\(/);
 assert.doesNotMatch(host,/Native\.GetWindowThreadProcessId\(h, out wpid\)/,'every listing path uses the resolver');
 assert.match(host,/int ownerPid = ControlFence\.WindowProcess\(h\);/);
});
