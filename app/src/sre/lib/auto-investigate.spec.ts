/** @jest-environment node */
const policy = jest.fn();
jest.mock("@/lib/sre/notification-policy", () => ({ getNotificationPolicy: (...a: unknown[]) => policy(...a) }));
jest.mock("@/lib/logger/index", () => ({ createLogger: () => ({ error: jest.fn() }) }));
const validate = jest.fn();
jest.mock("@/lib/ai/ai-provider", () => ({ validateAIConfiguration: () => validate() }));
const assertCanStart = jest.fn();
jest.mock("@/lib/sre/investigation-billing", () => ({ assertCanStartSreInvestigation: (...a: unknown[]) => assertCanStart(...a) }));
const dailyLimit = jest.fn();
jest.mock("@/lib/sre/sre-daily-token-limit", () => ({ sreDailyTokenLimitResponse: (...a: unknown[]) => dailyLimit(...a) }));
const sreEnabled = jest.fn();
jest.mock("@/sre/lib/feature-gates", () => ({ isSreEnabled: () => sreEnabled() }));
const start = jest.fn();
const complete = jest.fn();
jest.mock("@/sre/lib/investigation-runner", () => ({
  startSreIncidentInvestigation: (...a: unknown[]) => start(...a),
  completeSreIncidentInvestigation: (...a: unknown[]) => complete(...a),
}));
const triage = jest.fn();
jest.mock("@/sre/lib/triage-runner", () => ({ runSreIncidentTriage: (...a: unknown[]) => triage(...a) }));
let incidentRows: unknown[] = [];
jest.mock("@/utils/db", () => ({
  db: { select: () => { const n: Record<string, unknown> = {}; for (const k of ["from", "where"]) n[k] = () => n; n.limit = () => Promise.resolve(incidentRows); return n; } },
}));

import { maybeAutoInvestigateOnOpen } from "./auto-investigate";

const input = { organizationId: "org-1", projectId: "p1", incidentId: "i1", userId: null };

beforeEach(() => {
  jest.clearAllMocks();
  sreEnabled.mockReturnValue(true);
  policy.mockResolvedValue({ autoInvestigateOnOpen: true });
  incidentRows = [{ severity: "sev1", status: "triggered" }];
  validate.mockReturnValue(undefined);
  dailyLimit.mockResolvedValue(null);
  assertCanStart.mockResolvedValue(undefined);
  start.mockResolvedValue({ success: true, investigationRunId: "run-1", incident: { id: "i1" } });
  complete.mockResolvedValue({ success: true });
  triage.mockResolvedValue({ success: true });
});

it("does nothing unless the project switched it on", async () => {
  policy.mockResolvedValue({ autoInvestigateOnOpen: false });
  expect(await maybeAutoInvestigateOnOpen(input)).toEqual({ handled: false, reason: "disabled" });
  expect(start).not.toHaveBeenCalled();
  expect(triage).not.toHaveBeenCalled();
});

it.each(["sev1", "sev2"])("starts a full investigation for %s through the billing and daily-limit gates", async (severity) => {
  incidentRows = [{ severity, status: "triggered" }];
  expect(await maybeAutoInvestigateOnOpen(input)).toEqual({ handled: true });
  expect(assertCanStart).toHaveBeenCalledWith("org-1");
  expect(dailyLimit).toHaveBeenCalledWith("org-1");
  expect(start).toHaveBeenCalledWith(expect.objectContaining({ incidentId: "i1", enableLiveConnectors: false }));
  expect(triage).not.toHaveBeenCalled();
});

it.each(["sev3", "sev4"])("runs only a triage for %s", async (severity) => {
  incidentRows = [{ severity, status: "triggered" }];
  expect(await maybeAutoInvestigateOnOpen(input)).toEqual({ handled: true });
  expect(triage).toHaveBeenCalledWith(input);
  expect(start).not.toHaveBeenCalled();
});

it("starts nothing when billing, the daily limit, the AI config or the incident state refuse", async () => {
  assertCanStart.mockRejectedValue(new Error("no plan"));
  expect(await maybeAutoInvestigateOnOpen(input)).toMatchObject({ handled: false, reason: "billing" });
  assertCanStart.mockResolvedValue(undefined);
  dailyLimit.mockResolvedValue({});
  expect(await maybeAutoInvestigateOnOpen(input)).toMatchObject({ handled: false, reason: "daily_limit" });
  dailyLimit.mockResolvedValue(null);
  validate.mockImplementation(() => { throw new Error("no key"); });
  expect(await maybeAutoInvestigateOnOpen(input)).toMatchObject({ handled: false, reason: "ai_not_configured" });
  validate.mockReturnValue(undefined);
  incidentRows = [{ severity: "sev1", status: "resolved" }];
  expect(await maybeAutoInvestigateOnOpen(input)).toMatchObject({ handled: false, reason: "not_open" });
  expect(start).not.toHaveBeenCalled();
});
