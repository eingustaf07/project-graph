import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

function indexReport(report) {
  const meta = report?.pgRegression;
  if (meta?.version !== 1 || typeof meta.root !== 'string' || !meta.root ||
      !['passed', 'failed'].includes(meta.reason) || !Array.isArray(meta.unhandledErrors) || !Array.isArray(meta.suiteErrors) ||
      !Array.isArray(report.testResults) || report.testResults.length === 0) {
    throw new Error('Missing, incomplete, or interrupted regression report');
  }
  const normalize = value => String(value).replaceAll('\\', '/').replaceAll(meta.root.replaceAll('\\', '/'), '<root>');
  const tests = new Map();
  const files = new Map();
  const errors = new Map();
  const addError = key => errors.set(key, (errors.get(key) ?? 0) + 1);
  for (const file of report.testResults) {
    if (typeof file.name !== 'string' || !['passed', 'failed'].includes(file.status) || !Array.isArray(file.assertionResults)) throw new Error('Invalid file result');
    const name = normalize(file.name);
    if (files.has(name)) throw new Error('Duplicate file result');
    files.set(name, file.status);
    if (file.message) addError(JSON.stringify(['suite', name, normalize(file.message)]));
    for (const test of file.assertionResults) {
      if (typeof test.fullName !== 'string' || !['passed', 'failed', 'skipped', 'todo', 'disabled'].includes(test.status)) throw new Error('Invalid or pending test result');
      const key = JSON.stringify([name, test.fullName]);
      if (tests.has(key)) throw new Error(`Ambiguous duplicate test: ${key}`);
      tests.set(key, test.status);
    }
  }
  if (tests.size === 0 || report.numTotalTests !== tests.size ||
      report.numPassedTests !== [...tests.values()].filter(x => x === 'passed').length ||
      report.numFailedTests !== [...tests.values()].filter(x => x === 'failed').length) throw new Error('Inconsistent test totals');
  for (const error of meta.unhandledErrors) {
    if (typeof error.name !== 'string' || typeof error.message !== 'string' || typeof error.testFile !== 'string') throw new Error('Invalid runtime error');
    addError(JSON.stringify(['runtime', error.name, normalize(error.message), normalize(error.testFile)]));
  }
  for (const error of meta.suiteErrors) {
    if (!Array.isArray(error.path) || error.path.some(x => typeof x !== 'string') || typeof error.name !== 'string' || typeof error.message !== 'string') throw new Error('Invalid suite error');
    addError(JSON.stringify(['suite-detail', error.path.map(normalize), error.name, normalize(error.message)]));
  }
  return { tests, files, errors };
}

export function compareReports(baseline, candidate) {
  const before = indexReport(baseline);
  const after = indexReport(candidate);
  const regressions = [];
  for (const [key, status] of before.tests) {
    const next = after.tests.get(key);
    if (!next || (status === 'passed' && next !== 'passed') || (status === 'failed' && !['passed', 'failed'].includes(next))) regressions.push(`Missing or degraded test: ${key}`);
  }
  for (const [key, status] of after.tests) {
    if (status === 'failed' && before.tests.get(key) !== 'failed') regressions.push(`New failed test: ${key}`);
  }
  for (const [key, status] of before.files) {
    if (!after.files.has(key) || (status === 'passed' && after.files.get(key) !== 'passed')) regressions.push(`Missing or degraded suite: ${key}`);
  }
  for (const [key, status] of after.files) {
    if (status === 'failed' && !before.files.has(key)) regressions.push(`New failed suite: ${key}`);
  }
  for (const [key, count] of after.errors) {
    if (count > (before.errors.get(key) ?? 0)) regressions.push(`New or increased suite/runtime error: ${key}`);
  }
  if (regressions.length) throw new Error(regressions.join('\n'));
  const caveat = candidate.numFailedTests || candidate.pgRegression.unhandledErrors.length || candidate.pgRegression.suiteErrors.length
    ? 'Known baseline failures remain unresolved; this is not a clean test pass.'
    : 'All candidate tests in this report passed.';
  return `No new regression detected in ${before.tests.size} baseline tests; candidate: ${candidate.numPassedTests} passed, ${candidate.numFailedTests} failed, ${candidate.pgRegression.unhandledErrors.length} unhandled errors. ${caveat}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4) throw new Error('Usage: node pg11-regression-gate.mjs baseline.json candidate.json');
  console.log(compareReports(...process.argv.slice(2).map(path => JSON.parse(readFileSync(path, 'utf8')))));
}
