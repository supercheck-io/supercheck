import type { SreEvalFixture } from "./fixtures";
import { scoreSreEvalResult, type SreEvalAgentResult, type SreEvalScore } from "./scoring";

export type SreEvalRunner = (fixture: SreEvalFixture) => Promise<SreEvalAgentResult>;

export type SreEvalRunResult = {
  fixture: SreEvalFixture;
  agentResult: SreEvalAgentResult;
  score: SreEvalScore;
};

export async function runSreEvalFixture(fixture: SreEvalFixture, runner: SreEvalRunner): Promise<SreEvalRunResult> {
  const agentResult = await runner(fixture);

  return {
    fixture,
    agentResult,
    score: scoreSreEvalResult(fixture, agentResult),
  };
}

export async function runSreEvalSuite(fixtures: SreEvalFixture[], runner: SreEvalRunner) {
  const results: SreEvalRunResult[] = [];

  for (const fixture of fixtures) {
    results.push(await runSreEvalFixture(fixture, runner));
  }

  return results;
}

export function assertSreEvalGate(results: SreEvalRunResult[]) {
  const failures = results.filter((result) => !result.score.passed);
  if (failures.length === 0) {
    return;
  }

  const failureSummary = failures
    .map((failure) => {
      const findings = failure.score.findings.map((finding) => finding.message).join("; ");
      return `${failure.fixture.id} scored ${failure.score.score}: ${findings || "below score threshold"}`;
    })
    .join("\n");

  throw new Error(`SRE eval gate failed:\n${failureSummary}`);
}
