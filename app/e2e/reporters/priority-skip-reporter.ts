import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';

export default class PrioritySkipReporter implements Reporter {
  private readonly skipped: string[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    const title = test.titlePath().join(' › ');
    if (result.status === 'skipped' && /@(critical|high)\b/.test(title)) {
      this.skipped.push(title);
    }
  }

  async onEnd(_result: FullResult): Promise<void | { status?: FullResult['status'] }> {
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
