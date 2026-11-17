// The Mac and Windows HUDs take their motion and prompt metrics from one file
// each. Both must carry the same values (docs/visual-design.md).
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const cs=read('server/native/DesktopVisuals.cs'),swift=read('server/native/macos/MacDesign.swift');
const csNumber=name=>{const m=new RegExp(`\\b${name}=([0-9.]+)f?\\b`).exec(cs);assert(m,`Windows token ${name}`);return Number(m[1]);};
const swiftNumber=name=>{const m=new RegExp(`\\b${name}(?::\\s*[A-Za-z]+)?\\s*=\\s*([0-9.]+)`).exec(swift);assert(m,`Mac token ${name}`);return Number(m[1]);};
const swiftPoints=name=>{const m=new RegExp(`${name}Points[^=]*=\\s*\\(([^)]*)\\)`).exec(swift);assert(m,`Mac curve ${name}`);return m[1].split(',').map(Number);};
const csCurve=name=>{const m=new RegExp(`${name}=Curve\\(([^)]*)\\)`).exec(cs);assert(m,`Windows curve ${name}`);return m[1].split(',').map(Number);};

test('Mac motion tokens equal the Windows tokens',()=>{
 for(const [mac,win,scale] of [['fast','Fast',1000],['normal','Normal',1000],['slow','Slow',1000],['fastLeave','FastLeave',1000],['normalLeave','NormalLeave',1000],['press','Press',1000]])
  assert.equal(Math.round(swiftNumber(mac)*scale),csNumber(win),mac);
 assert.equal(swiftNumber('pressScale'),csNumber('PressScale'));assert.equal(swiftNumber('menuFrom'),csNumber('MenuFrom'));
 assert.equal(swiftNumber('springSeconds'),csNumber('SpringSeconds'));assert.equal(swiftNumber('springBounce'),csNumber('SpringBounce'));
 assert.deepEqual(swiftPoints('easeOut'),csCurve('OutCurve'));assert.deepEqual(swiftPoints('easeInOut'),csCurve('InOutCurve'));
});
test('Mac access prompt metrics equal the Windows card',()=>{
 for(const [mac,win] of [['promptWidth','PromptWidth'],['promptBodyMost','PromptBodyMost'],['promptButtonWidth','PromptButtonWidth'],['promptButtonHeight','PromptButtonHeight'],['promptRing','PromptRing'],['promptTitle','PromptTitle']])
  assert.equal(swiftNumber(mac),csNumber(win),mac);
 assert.match(swift,/promptRadius: CGFloat = 18\b/);
 const note=/PromptNote="([^"]+)"/.exec(cs)[1];assert(swift.includes(`promptNote = "${note}"`));
});
test('Mac views take durations and easing from MacDesign only',()=>{
 for(const file of ['MacVisuals.swift','MacAccessPrompt.swift']){
  const source=read('server/native/macos/'+file);
  assert.doesNotMatch(source,/context\.duration\s*=\s*[0-9]/,file);
  assert.doesNotMatch(source,/CAMediaTimingFunction\(name:/,file);
  assert.doesNotMatch(source,/CAMediaTimingFunction\(controlPoints:/,file);
 }
});
