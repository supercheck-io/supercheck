const {
  RELEASE_ENVIRONMENT_REQUIREMENTS,
  SEEDED_LIVE_FIXTURES,
  buildSreEvalReleaseEnvTemplate,
  buildSreEvalReleaseRunbookMarkdown,
  fixtureIds,
  incidentMapForFixtures,
} = require("./sre-eval-release-seed-manifest");

describe("SRE eval release seed manifest", () => {
  it("keeps fixture IDs unique and release-ready", () => {
    const ids = fixtureIds();

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining([
        "connector-investigation-oss-lab-checkout-degradation",
        "connector-investigation-cloudwatch-alarm",
        "connector-investigation-tempo-trace-latency",
      ])
    );
    expect(SEEDED_LIVE_FIXTURES.every((fixture) => fixture.connectors.length > 0 && fixture.seedData.length > 0)).toBe(true);
  });

  it("prints an RC/stable-compatible env template without populated secrets", () => {
    const template = buildSreEvalReleaseEnvTemplate({
      channel: "stable",
      fixtureIds: ["connector-investigation-oss-lab-checkout-degradation"],
    });

    expect(template).toContain("SRE_EVAL_RELEASE_CHANNEL=stable");
    expect(template).toContain("SRE_EVAL_LIVE_ENABLED=true");
    expect(template).toContain("SRE_EVAL_MODEL_GRADE_ENABLED=true");
    expect(template).toContain("SRE_EVAL_AUTH_TOKEN=<release-eval-api-token>");
    expect(template).toContain("connector-investigation-oss-lab-checkout-degradation");
    expect(template).not.toContain("test-token");
  });

  it("maps selected fixture IDs to incident placeholders", () => {
    const mapping = incidentMapForFixtures([
      "connector-investigation-oss-lab-checkout-degradation",
      "connector-investigation-tempo-trace-latency",
    ]);

    expect(mapping).toEqual({
      "connector-investigation-oss-lab-checkout-degradation": "018f0000-0000-7000-8000-000000000001",
      "connector-investigation-tempo-trace-latency": "018f0000-0000-7000-8000-000000000002",
    });
  });

  it("documents required controls for release engineers", () => {
    const runbook = buildSreEvalReleaseRunbookMarkdown({
      fixtureIds: ["connector-investigation-cloudwatch-alarm"],
    });

    expect(RELEASE_ENVIRONMENT_REQUIREMENTS.map((item) => item.name)).toEqual(
      expect.arrayContaining(["SRE_EVAL_AUTH_TOKEN", "SRE_EVAL_INCIDENT_IDS", "SRE_EVAL_GRADER_MODEL_ID"])
    );
    expect(runbook).toContain("non-production SuperCheck tenant");
    expect(runbook).toContain("Never run seeded live evals against customer production tenants");
    expect(runbook).toContain("connector-investigation-cloudwatch-alarm");
  });
});
