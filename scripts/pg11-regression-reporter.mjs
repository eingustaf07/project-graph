import { JsonReporter } from 'vitest/node';

export default class RegressionReporter extends JsonReporter {
  constructor() {
    super({ outputFile: 'regression-results.json' });
  }

  async onTestRunEnd(modules, errors, reason) {
    this.runReason = reason;
    this.suiteErrors = [];
    const visit = (task, path) => {
      if (task.type !== 'suite') return;
      for (const error of task.result?.errors ?? []) {
        this.suiteErrors.push({ path, name: error.name ?? '', message: error.message ?? '' });
      }
      for (const child of task.tasks ?? []) visit(child, [...path, child.name]);
    };
    for (const module of modules) visit(module.task, [module.moduleId]);
    this.unhandledErrors = errors.map(error => ({
      name: error.name ?? '',
      message: error.message ?? '',
      testFile: error.VITEST_TEST_PATH ?? '',
    }));
    await super.onTestRunEnd(modules);
  }

  async writeReport(serialized) {
    const report = JSON.parse(serialized);
    report.pgRegression = {
      version: 1,
      root: this.ctx.config.root,
      reason: this.runReason,
      unhandledErrors: this.unhandledErrors,
      suiteErrors: this.suiteErrors,
    };
    await super.writeReport(JSON.stringify(report, null, 2));
  }
}
