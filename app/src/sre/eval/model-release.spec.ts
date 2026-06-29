/** @jest-environment node */

import { sreEvalFixtures } from "./fixtures";
import { assertSreEvalGate, runSreEvalSuite } from "./harness";
import { createSreLiveApiEvalRunner, parseSreLiveEvalEnvironment, selectSreLiveEvalFixtures } from "./live-env";
import { gradeSreEvalResultWithModel } from "./model-grader";

const modelGradeEnabled = process.env.SRE_EVAL_MODEL_GRADE_ENABLED === "true";
const describeModelReleaseEval = modelGradeEnabled ? describe : describe.skip;

function parseMinimumModelGradeScore() {
  const raw = process.env.SRE_EVAL_MODEL_GRADE_MIN_SCORE?.trim() ?? "0.8";
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("SRE_EVAL_MODEL_GRADE_MIN_SCORE must be a number between 0 and 1");
  }

  return value;
}

describeModelReleaseEval("SRE model-graded live API eval", () => {
  it("grades seeded live investigation results with an independent model", async () => {
    const liveConfig = parseSreLiveEvalEnvironment();
    if (!liveConfig.enabled) {
      throw new Error("SRE_EVAL_MODEL_GRADE_ENABLED=true requires SRE_EVAL_LIVE_ENABLED=true");
    }

    const evaluatedModelId = process.env.SRE_EVAL_EVALUATED_MODEL_ID?.trim();
    if (!evaluatedModelId) {
      throw new Error("SRE_EVAL_EVALUATED_MODEL_ID is required for model-graded release evals");
    }

    const graderModelId = process.env.SRE_EVAL_GRADER_MODEL_ID?.trim();
    const allowSameModel = process.env.SRE_EVAL_MODEL_GRADE_ALLOW_SAME_MODEL === "true";
    const minimumScore = parseMinimumModelGradeScore();
    const results = await runSreEvalSuite(
      selectSreLiveEvalFixtures(liveConfig, sreEvalFixtures),
      createSreLiveApiEvalRunner(liveConfig),
    );

    assertSreEvalGate(results);

    const grades = [];
    for (const result of results) {
      grades.push({
        fixtureId: result.fixture.id,
        grade: await gradeSreEvalResultWithModel({
          fixture: result.fixture,
          agentResult: result.agentResult,
          deterministicScore: result.score,
          evaluatedModelId,
          graderModelId,
          allowSameModel,
        }),
      });
    }

    const failures = grades.filter(({ grade }) => !grade.passed || grade.score < minimumScore);
    if (failures.length > 0) {
      throw new Error(
        failures
          .map(
            ({ fixtureId, grade }) =>
              `${fixtureId} model grade failed: score=${grade.score}, passed=${grade.passed}, confidence=${grade.confidence}, findings=${grade.findings.join("; ")}`,
          )
          .join("\n"),
      );
    }
  }, 240_000);
});
