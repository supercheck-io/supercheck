const {
  buildSreEvalReleasePolicy,
  normalizeReleaseChannel,
  validateSreEvalReleasePolicy,
} = require("./sre-eval-release-policy");

describe("SRE eval release policy", () => {
  it("keeps local/default releases deterministic-only", () => {
    const policy = buildSreEvalReleasePolicy({});

    expect(policy).toMatchObject({
      channel: "local",
      deterministic: { enabled: true, required: true },
      live: { enabled: false, required: false, mode: "skipped" },
      modelGrade: { enabled: false, required: false, mode: "skipped" },
    });
  });

  it("normalizes release candidate aliases", () => {
    expect(normalizeReleaseChannel("rc")).toBe("release_candidate");
    expect(normalizeReleaseChannel("release-candidate")).toBe("release_candidate");
    expect(normalizeReleaseChannel("production")).toBe("stable");
  });

  it("requires live and model grading for release candidates", () => {
    const policy = buildSreEvalReleasePolicy({ SRE_EVAL_RELEASE_CHANNEL: "rc" });

    expect(policy.live).toMatchObject({ enabled: false, required: true, mode: "blocking" });
    expect(policy.modelGrade).toMatchObject({ enabled: false, required: true, mode: "blocking" });
    expect(() => validateSreEvalReleasePolicy(policy, { SRE_EVAL_RELEASE_CHANNEL: "rc" })).toThrow(
      "release_candidate SRE eval release policy requires SRE_EVAL_LIVE_ENABLED=true",
    );
  });

  it("validates stable release live and model-grade configuration", () => {
    const env = {
      SRE_EVAL_RELEASE_CHANNEL: "stable",
      SRE_EVAL_LIVE_ENABLED: "true",
      SRE_EVAL_BASE_URL: "https://supercheck.test",
      SRE_EVAL_AUTH_TOKEN: "test-token",
      SRE_EVAL_INCIDENT_IDS: '{"native-evidence-monitor-timeout":"018f0000-0000-7000-8000-000000000001"}',
      SRE_EVAL_MODEL_GRADE_ENABLED: "true",
      SRE_EVAL_EVALUATED_MODEL_ID: "investigator-model",
      SRE_EVAL_GRADER_MODEL_ID: "grader-model",
    };
    const policy = buildSreEvalReleasePolicy(env);

    expect(policy.live.mode).toBe("blocking");
    expect(policy.modelGrade.mode).toBe("blocking");
    expect(() => validateSreEvalReleasePolicy(policy, env)).not.toThrow();
  });

  it("does not allow model grading without live evals", () => {
    const env = {
      SRE_EVAL_MODEL_GRADE_ENABLED: "true",
      SRE_EVAL_EVALUATED_MODEL_ID: "investigator-model",
    };

    expect(() => validateSreEvalReleasePolicy(buildSreEvalReleasePolicy(env), env)).toThrow(
      "SRE_EVAL_MODEL_GRADE_ENABLED=true requires SRE_EVAL_LIVE_ENABLED=true",
    );
  });

  it("requires an independent grader model when both model IDs are provided", () => {
    const env = {
      SRE_EVAL_LIVE_ENABLED: "true",
      SRE_EVAL_BASE_URL: "https://supercheck.test",
      SRE_EVAL_AUTH_TOKEN: "test-token",
      SRE_EVAL_INCIDENT_IDS: '{"native-evidence-monitor-timeout":"018f0000-0000-7000-8000-000000000001"}',
      SRE_EVAL_MODEL_GRADE_ENABLED: "true",
      SRE_EVAL_EVALUATED_MODEL_ID: "same-model",
      SRE_EVAL_GRADER_MODEL_ID: "same-model",
    };

    expect(() => validateSreEvalReleasePolicy(buildSreEvalReleasePolicy(env), env)).toThrow(
      "Model-graded SRE eval release gate requires SRE_EVAL_GRADER_MODEL_ID to differ",
    );
  });
});
