import { getSreEvalFixture } from "./fixtures";
import { buildSreLiveEvalRequest, parseSreLiveEvalEnvironment, selectSreLiveEvalFixtures } from "./live-env";

describe("SRE live eval environment", () => {
  it("stays disabled without requiring live eval secrets", () => {
    const config = parseSreLiveEvalEnvironment({});

    expect(config).toEqual({ enabled: false, incidentIdsByFixtureId: {}, fixtureIds: [] });
  });

  it("parses required live eval settings", () => {
    const config = parseSreLiveEvalEnvironment({
      SRE_EVAL_LIVE_ENABLED: "true",
      SRE_EVAL_BASE_URL: "https://supercheck.test",
      SRE_EVAL_AUTH_TOKEN: "test-token",
      SRE_EVAL_FIXTURE_IDS: "connector-investigation-prometheus-kubernetes-restarts",
      SRE_EVAL_INCIDENT_IDS: JSON.stringify({
        "connector-investigation-prometheus-kubernetes-restarts": "018f0000-0000-7000-8000-000000000001",
      }),
    });

    expect(config).toMatchObject({
      enabled: true,
      baseUrl: "https://supercheck.test",
      authToken: "test-token",
      incidentIdsByFixtureId: {
        "connector-investigation-prometheus-kubernetes-restarts": "018f0000-0000-7000-8000-000000000001",
      },
      fixtureIds: ["connector-investigation-prometheus-kubernetes-restarts"],
    });
  });

  it("fails closed when enabled without required settings", () => {
    expect(() => parseSreLiveEvalEnvironment({ SRE_EVAL_LIVE_ENABLED: "true" })).toThrow(
      "SRE_EVAL_BASE_URL is required"
    );
  });

  it("builds fixture-specific API requests with connector mode", () => {
    const fixture = getSreEvalFixture("connector-investigation-prometheus-kubernetes-restarts");
    const request = buildSreLiveEvalRequest(
      {
        enabled: true,
        baseUrl: "https://supercheck.test",
        authToken: "test-token",
      incidentIdsByFixtureId: {
        [fixture.id]: "018f0000-0000-7000-8000-000000000001",
      },
      fixtureIds: [],
    },
      fixture
    );

    expect(request).toEqual({
      incidentId: "018f0000-0000-7000-8000-000000000001",
      useLiveConnectors: true,
      headers: { authorization: "Bearer test-token" },
    });
  });

  it("selects an explicit fixture subset for seeded live runs", () => {
    const selected = selectSreLiveEvalFixtures({
      enabled: true,
      baseUrl: "https://supercheck.test",
      authToken: "test-token",
      incidentIdsByFixtureId: {
        "connector-investigation-tempo-trace-latency": "018f0000-0000-7000-8000-000000000001",
      },
      fixtureIds: ["connector-investigation-tempo-trace-latency"],
    });

    expect(selected.map((fixture) => fixture.id)).toEqual(["connector-investigation-tempo-trace-latency"]);
  });

  it("rejects unknown explicit fixture IDs", () => {
    expect(() =>
      parseSreLiveEvalEnvironment({
        SRE_EVAL_LIVE_ENABLED: "true",
        SRE_EVAL_BASE_URL: "https://supercheck.test",
        SRE_EVAL_AUTH_TOKEN: "test-token",
        SRE_EVAL_FIXTURE_IDS: "unknown-fixture",
        SRE_EVAL_INCIDENT_IDS: JSON.stringify({
          "connector-investigation-prometheus-kubernetes-restarts": "018f0000-0000-7000-8000-000000000001",
        }),
      })
    ).toThrow("SRE_EVAL_FIXTURE_IDS contains unknown fixture IDs: unknown-fixture");
  });
});
