import test from 'node:test';
import assert from 'node:assert/strict';
import {renameReplacing} from '../server/atomic-json.mjs';

const busy = code => Object.assign(Error(code), {code});
function fakeIo(failures) {
 let calls = 0;
 return {io: {renameSync() { calls++; if (failures.length) throw busy(failures.shift()); }}, calls: () => calls};
}
function clock() { let t = 0; return {now: () => t, sleep: ms => { t += ms; }}; }

test('Windows rename retries a briefly held destination, then succeeds', () => {
 const {io, calls} = fakeIo(['EPERM', 'EBUSY', 'EACCES']);const c = clock();
 renameReplacing(io, 'a.tmp', 'a', {platform: 'win32', ...c});
 assert.equal(calls(), 4);assert(c.now() <= 5000);
});

test('rename does not retry other errors or other platforms', () => {
 for (const [platform, code] of [['win32', 'ENOENT'], ['darwin', 'EPERM'], ['linux', 'EBUSY']]) {
  const {io, calls} = fakeIo([code]);
  assert.throws(() => renameReplacing(io, 'a.tmp', 'a', {platform, ...clock()}), error => error.code === code);
  assert.equal(calls(), 1, `${platform} ${code}`);
 }
});

test('a destination held for good fails within the retry budget with the original error', () => {
 const {io, calls} = fakeIo(Array(100).fill('EPERM'));const c = clock();
 assert.throws(() => renameReplacing(io, 'a.tmp', 'a', {platform: 'win32', ...c}), error => error.code === 'EPERM');
 assert(c.now() <= 5000, `slept ${c.now()} ms`);assert(calls() > 3 && calls() < 80);
});
