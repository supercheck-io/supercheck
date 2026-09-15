import {
  boundedStageWindowMinutes,
  parseStagedEvidenceToolName,
  validateStagedEvidenceQuery,
  validateStagedEvidenceTransition,
} from "./staged-evidence";

describe("staged connector evidence", () => {
  it("requires the immediately preceding stage", () => {
    expect(() => validateStagedEvidenceTransition({
      stage: "sample",
      completedStages: new Set(),
    })).toThrow("Complete the statistics evidence stage");

    expect(() => validateStagedEvidenceTransition({
      stage: "sample",
      completedStages: new Set(["statistics"]),
    })).not.toThrow();
  });

  it("allows statistics to start a staged investigation", () => {
    expect(() => validateStagedEvidenceTransition({
      stage: "statistics",
      completedStages: new Set(),
    })).not.toThrow();
  });

  it("bounds early windows and parses only known stage audit names", () => {
    expect(boundedStageWindowMinutes("statistics", 60)).toBe(15);
    expect(boundedStageWindowMinutes("correlation", 60)).toBe(60);
    expect(parseStagedEvidenceToolName("agent.connector.search.stage.signatures")).toBe("signatures");
    expect(parseStagedEvidenceToolName("agent.connector.search.stage.unknown")).toBeNull();
  });

  it("requires a real LogQL metric operation for the statistics stage", () => {
    expect(() => validateStagedEvidenceQuery({
      connectorType: "loki",
      stage: "statistics",
      query: '{service="checkout"}',
    })).toThrow("LogQL metric function");
    expect(() => validateStagedEvidenceQuery({
      connectorType: "loki",
      stage: "statistics",
      query: 'sum(count_over_time({service="checkout"}[5m]))',
    })).not.toThrow();
  });
});
