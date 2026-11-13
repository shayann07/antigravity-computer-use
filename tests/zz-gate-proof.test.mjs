import test from 'node:test';import assert from 'node:assert/strict';
test('deliberate failure to prove the ci-ok gate (do not merge)',()=>assert.equal(1,2));
