const mockResults: unknown[][] = [];
const mockExecute = jest.fn();
const mockSelect = jest.fn();
jest.mock("@/utils/db", () => {
  const chain: unknown = new Proxy(function () {}, {
    get: (_t, prop) => (prop === "then" ? (resolve: (rows: unknown[]) => void) => resolve(mockResults.shift() ?? []) : () => chain),
  });
  return {
    db: {
      select: (...args: unknown[]) => {
        mockSelect(...args);
        return chain;
      },
      transaction: (fn: (tx: unknown) => unknown) => fn({ execute: mockExecute }),
    },
  };
});
jest.mock("@/lib/logger/index", () => ({ createLogger: () => ({ warn: jest.fn(), error: jest.fn() }) }));
jest.mock("@/lib/sre/incident-lifecycle", () => ({ recoverableTrigger: jest.fn() }));
const mockGate = jest.fn();
jest.mock("@/sre/lib/feature-gates", () => ({ isSreBackgroundAlertTriageEnabled: () => mockGate() }));
const mockHandleRecovery = jest.fn();
const mockRecoveredSince = jest.fn();
const mockStartTriage = jest.fn();
jest.mock("@/sre/lib/background-alert-triage", () => ({
  handleSourceRecovery: (...a: unknown[]) => mockHandleRecovery(...a),
  sourceRecoveredSince: (...a: unknown[]) => mockRecoveredSince(...a),
  startAutomaticIncidentTriage: (...a: unknown[]) => mockStartTriage(...a),
}));
const mockFailStale = jest.fn();
jest.mock("@/sre/lib/stale-run-recovery", () => ({
  STALE_RUN_AFTER_MS: 5 * 60_000,
  failStaleSreInvestigationRunsForIncident: (...a: unknown[]) => mockFailStale(...a),
}));

import { reconcileRecoveries, retriageStaleRuns, shouldRetriage, sweepSreIncidents } from "./incident-sweep";

const now = new Date("2026-01-01T12:00:00Z");
const lastAlertAt = "2026-01-01T11:00:00.000Z";
const recoveredAt = new Date("2026-01-01T11:30:00Z");
const monitorRow = (over: Record<string, unknown> = {}) => ({
  organizationId: "org-1", projectId: "proj-1", sourceId: "mon-1", name: "API", alertConfig: null, lastAlertAt, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockResults.length = 0;
  mockGate.mockReturnValue(true);
  mockExecute.mockResolvedValue([{ locked: true }]);
  mockHandleRecovery.mockResolvedValue({ resolved: [{ id: "inc-1" }], recovered: [] });
  mockStartTriage.mockResolvedValue({ success: true, investigationRunId: "run-2" });
});

describe("reconcileRecoveries", () => {
  it("resolves a recovered source with the worker's arguments, scoped to the source row", async () => {
    mockResults.push([monitorRow()], []);
    mockRecoveredSince.mockResolvedValue(recoveredAt);
    expect(await reconcileRecoveries()).toBe(1);
    expect(mockRecoveredSince).toHaveBeenCalledWith("monitor", "mon-1", new Date(lastAlertAt));
    expect(mockHandleRecovery).toHaveBeenCalledWith({
      organizationId: "org-1", projectId: "proj-1", sourceType: "monitor", sourceId: "mon-1", targetName: "API",
      autoResolve: true, recoveredAt, discriminator: `monitor:mon-1:${recoveredAt.toISOString()}:sweep`,
    });
  });

  it("resolves job sources too, and keeps each tenant's scope apart", async () => {
    mockResults.push([monitorRow()], [monitorRow({ organizationId: "org-2", projectId: "proj-2", sourceId: "job-1", name: "Nightly" })]);
    mockRecoveredSince.mockResolvedValue(recoveredAt);
    await reconcileRecoveries();
    expect(mockHandleRecovery).toHaveBeenCalledTimes(2);
    expect(mockHandleRecovery.mock.calls[1][0]).toMatchObject({ organizationId: "org-2", projectId: "proj-2", sourceType: "job", sourceId: "job-1" });
  });

  it("leaves a source that is still down or has a newer failure alone", async () => {
    mockResults.push([monitorRow()], []);
    mockRecoveredSince.mockResolvedValue(null);
    expect(await reconcileRecoveries()).toBe(0);
    expect(mockHandleRecovery).not.toHaveBeenCalled();
  });

  it("counts nothing when the lifecycle refuses a stale recovery (newer failure alert)", async () => {
    mockResults.push([monitorRow()], []);
    mockRecoveredSince.mockResolvedValue(recoveredAt);
    mockHandleRecovery.mockResolvedValue({ resolved: [], recovered: [] });
    expect(await reconcileRecoveries()).toBe(0);
  });

  it("skips autoResolve off and a recovery threshold above 1 (worker signal only)", async () => {
    mockResults.push(
      [monitorRow({ alertConfig: { autoResolveIncident: false } }), monitorRow({ sourceId: "mon-2", alertConfig: { recoveryThreshold: 3 } })],
      [],
    );
    mockRecoveredSince.mockResolvedValue(recoveredAt);
    expect(await reconcileRecoveries()).toBe(0);
    expect(mockRecoveredSince).not.toHaveBeenCalled();
    expect(mockHandleRecovery).not.toHaveBeenCalled();
  });

  it("keeps going when one source fails", async () => {
    mockResults.push([monitorRow(), monitorRow({ sourceId: "mon-2" })], []);
    mockRecoveredSince.mockResolvedValue(recoveredAt);
    mockHandleRecovery.mockRejectedValueOnce(new Error("db")).mockResolvedValue({ resolved: [{ id: "i" }], recovered: [] });
    expect(await reconcileRecoveries()).toBe(1);
  });
});

describe("shouldRetriage", () => {
  const stale = { origin: "auto" as const, status: "failed", startedAt: new Date(now.getTime() - 3_600_000), errorCode: "stale_run" };
  it("retries once when the only automatic run failed as stale", () => {
    expect(shouldRetriage([stale], now)).toBe(true);
  });
  it("never retries twice: a second automatic run (the retry) blocks it", () => {
    expect(shouldRetriage([stale, { ...stale, errorCode: "provider_error" }], now)).toBe(false);
    expect(shouldRetriage([stale, { ...stale, status: "running", errorCode: null, startedAt: now }], now)).toBe(false);
  });
  it("ignores other failures, manual-only incidents and already triaged ones", () => {
    expect(shouldRetriage([{ ...stale, errorCode: "provider_error" }], now)).toBe(false);
    expect(shouldRetriage([{ ...stale, origin: "manual" }], now)).toBe(false);
    expect(shouldRetriage([stale, { origin: "manual", status: "completed", startedAt: now, errorCode: null }], now)).toBe(false);
    expect(shouldRetriage([stale, { origin: "manual", status: "running", startedAt: now, errorCode: null }], now)).toBe(false);
  });
});

describe("retriageStaleRuns", () => {
  const stale = { origin: "auto", status: "failed", startedAt: new Date(now.getTime() - 3_600_000), errorCode: "stale_run" };
  const incident = { id: "inc-1", organizationId: "org-1", projectId: "proj-1" };

  it("starts triage once through the shared gated path, with the incident's scope", async () => {
    mockResults.push([incident], [stale]);
    expect(await retriageStaleRuns(now)).toBe(1);
    expect(mockFailStale).toHaveBeenCalledWith({ organizationId: "org-1", projectId: "proj-1", incidentId: "inc-1" });
    expect(mockStartTriage).toHaveBeenCalledTimes(1);
    expect(mockStartTriage).toHaveBeenCalledWith({ organizationId: "org-1", projectId: "proj-1", incidentId: "inc-1" });
  });

  it("does not start again once the retry exists", async () => {
    mockResults.push([incident], [stale, { ...stale, status: "failed", errorCode: null }]);
    expect(await retriageStaleRuns(now)).toBe(0);
    expect(mockStartTriage).not.toHaveBeenCalled();
  });

  it("counts nothing when a gate refuses (flag, AI config, billing, org cap, policy)", async () => {
    mockResults.push([incident], [stale]);
    mockStartTriage.mockResolvedValue({ skipped: true, reason: "triage_billing" });
    expect(await retriageStaleRuns(now)).toBe(0);
  });
});

describe("sweepSreIncidents", () => {
  it("does nothing when SRE is off", async () => {
    mockGate.mockReturnValue(false);
    expect(await sweepSreIncidents(now)).toEqual({ skipped: "disabled" });
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("skips the tick when another replica holds the lock", async () => {
    mockExecute.mockResolvedValue([{ locked: false }]);
    expect(await sweepSreIncidents(now)).toEqual({ skipped: "locked" });
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("runs both branches under the lock", async () => {
    mockResults.push([monitorRow()], [], [{ id: "inc-1", organizationId: "org-1", projectId: "proj-1" }], [
      { origin: "auto", status: "failed", startedAt: new Date(0), errorCode: "stale_run" },
    ]);
    mockRecoveredSince.mockResolvedValue(recoveredAt);
    expect(await sweepSreIncidents(now)).toEqual({ reconciled: 1, retriaged: 1 });
  });
});
