import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareReports } from './pg11-regression-gate.mjs';

function report(states = ['passed', 'failed']) {
  return {
    pgRegression: { version: 1, root: 'C:/checkout', reason: 'failed', unhandledErrors: [], suiteErrors: [] },
    numTotalTests: states.length,
    numPassedTests: states.filter(x => x === 'passed').length,
    numFailedTests: states.filter(x => x === 'failed').length,
    testResults: [{ name: 'C:/checkout/test.ts', status: states.includes('failed') ? 'failed' : 'passed', message: '', assertionResults: states.map((status, i) => ({ fullName: `case ${i}`, status })) }],
  };
}

test('identical existing failures are reported honestly', () => {
  assert.match(compareReports(report(), report()), /not a clean test pass/);
});
test('previously passing tests cannot fail or be skipped', () => {
  for (const state of ['failed', 'skipped', 'todo']) assert.throws(() => compareReports(report(), report([state, 'failed'])));
});
test('tests cannot disappear', () => assert.throws(() => compareReports(report(), report(['passed']))));
test('new failing tests block packaging', () => assert.throws(() => compareReports(report(), report(['passed', 'failed', 'failed']))));
test('fixed failures are allowed', () => assert.doesNotThrow(() => compareReports(report(), report(['passed', 'passed']))));
test('new and increased runtime errors block packaging', () => {
  const before = report();
  const after = report();
  const error = { name: 'Error', message: 'unexpected', testFile: 'C:/checkout/test.ts' };
  after.pgRegression.unhandledErrors.push(error);
  assert.throws(() => compareReports(before, after));
  before.pgRegression.unhandledErrors.push(error);
  assert.doesNotThrow(() => compareReports(before, after));
  after.pgRegression.unhandledErrors.push(error);
  assert.throws(() => compareReports(before, after));
});
test('suite collection errors block packaging', () => {
  const after = report();
  after.testResults[0].message = 'import failed';
  assert.throws(() => compareReports(report(), after));
});
test('additional nested suite errors block packaging', () => {
  const after = report();
  after.pgRegression.suiteErrors.push({ path: ['C:/checkout/test.ts', 'suite'], name: 'Error', message: 'hook failure' });
  assert.throws(() => compareReports(report(), after));
});
test('incomplete, interrupted and inconsistent reports block packaging', () => {
  assert.throws(() => compareReports({}, report()));
  const after = report();
  after.pgRegression.reason = 'interrupted';
  assert.throws(() => compareReports(report(), after));
  after.pgRegression.reason = 'failed';
  after.numTotalTests++;
  assert.throws(() => compareReports(report(), after));
});
test('checkout paths normalize but error messages remain distinct', () => {
  const after = report();
  after.pgRegression.root = 'D:\\other';
  after.testResults[0].name = 'D:\\other\\test.ts';
  assert.doesNotThrow(() => compareReports(report(), after));
});
