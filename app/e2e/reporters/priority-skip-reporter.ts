import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';

/**
 * Annotation for tests that need infrastructure the deployed full suite cannot provide
 * (a stub the remote worker must reach). Their skips are listed as warnings, never hidden.
 */
export const ENV_GATED = 'env-gated';

export default class PrioritySkipReporter implements Reporter {
  private readonly skipped: string[] = [];
  private readonly envGated: string[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    const title = test.titlePath().join(' › ');
    if (result.status === 'skipped' && /@(critical|high)\b/.test(title)) {
      (test.annotations.some((a) => a.type === ENV_GATED) ? this.envGated : this.skipped).push(title);
    }
  }

  async onEnd(_result: FullResult): Promise<void | { status?: FullResult['status'] }> {
    if (this.envGated.length > 0) {
      const details = this.envGated.map((title) => `  - ${title}`).join('\n');
      console.warn(
        `\nPriority coverage warning: ${this.envGated.length} critical/high test(s) skipped for missing test infrastructure (${ENV_GATED}):\n${details}\n`,
      );
    }
    if (this.skipped.length === 0) {
      return {};
    }

    const details = this.skipped.map((title) => `  - ${title}`).join('\n');
    console.error(
      `\nPriority coverage gate failed: ${this.skipped.length} critical/high test(s) skipped:\n${details}\n`,
    );
    return { status: 'failed' };
  }
}
