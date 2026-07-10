import {
  alertTextSimilarity,
  selectAlertCorrelationMatch,
  type AlertCorrelationCandidate,
  type AlertCorrelationInput,
} from "./alert-correlation";

const firedAt = new Date("2026-07-10T10:00:00.000Z");

function alert(overrides: Partial<AlertCorrelationInput> = {}): AlertCorrelationInput {
  return {
    fingerprintHash: "new-fingerprint",
    dedupKey: "checkout:latency",
    serviceId: "checkout",
    sourceType: "monitor",
    title: "Checkout API latency spike",
    description: "p95 latency exceeded the threshold",
    firedAt,
    ...overrides,
  };
}

function candidate(overrides: Partial<AlertCorrelationCandidate> = {}): AlertCorrelationCandidate {
  return {
    ...alert({ fingerprintHash: "existing-fingerprint" }),
    incidentId: "incident-1",
    incidentNumber: 42,
    incidentTitle: "Checkout degradation",
    firedAt: new Date(firedAt.getTime() - 4 * 60_000),
    ...overrides,
  };
}

describe("alert correlation", () => {
  it("selects a high-confidence same-service provider match", () => {
    const match = selectAlertCorrelationMatch({
      alert: alert(),
      candidates: [candidate()],
    });

    expect(match?.candidate.incidentId).toBe("incident-1");
    expect(match?.score).toBeGreaterThanOrEqual(0.75);
    expect(match?.signals).toEqual(expect.arrayContaining([
      "matching_provider_key",
      "same_service",
      "within_5_minutes",
    ]));
  });

  it("does not merge weak temporal or text-only matches", () => {
    const match = selectAlertCorrelationMatch({
      alert: alert({ dedupKey: "checkout:error-rate" }),
      candidates: [candidate({ dedupKey: "payments:latency", serviceId: "payments" })],
    });

    expect(match).toBeNull();
  });

  it("ignores candidates outside the bounded window", () => {
    const match = selectAlertCorrelationMatch({
      alert: alert(),
      candidates: [candidate({ firedAt: new Date(firedAt.getTime() - 31 * 60_000) })],
    });

    expect(match).toBeNull();
  });

  it("uses bounded token similarity without treating boilerplate as evidence", () => {
    expect(alertTextSimilarity("Checkout latency exceeded threshold", "checkout latency spike")).toBeGreaterThan(0.25);
    expect(alertTextSimilarity("Alert error from service", "Alert failure from service")).toBe(0);
  });
});
