/** @jest-environment node */

const ctx = {
  userId: "018f0000-0000-7000-8000-00000000000c",
  organizationId: "018f0000-0000-7000-8000-00000000000a",
  project: { id: "018f0000-0000-7000-8000-00000000000b" },
};
jest.mock("@/lib/project-context", () => ({ requireProjectContext: jest.fn(async () => ctx) }));
const checkPermissionWithContext = jest.fn();
jest.mock("@/lib/rbac/middleware", () => ({
  checkPermissionWithContext: (...a: unknown[]) => checkPermissionWithContext(...a),
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/logger/index", () => ({ createLogger: () => ({ error: jest.fn() }) }));
const rateLimit = jest.fn();
jest.mock("@/lib/sre/sre-rate-limiter", () => ({ checkSreFeedbackRateLimit: (...a: unknown[]) => rateLimit(...a) }));
const submit = jest.fn();
jest.mock("@/lib/sre/investigation-feedback", () => ({
  MAX_FEEDBACK_NOTE_LENGTH: 500,
  submitInvestigationFeedback: (...a: unknown[]) => submit(...a),
}));

import { submitSreInvestigationFeedback } from "./sre-investigation-feedback";

const runId = "018f0000-0000-7000-8000-0000000000d1";

beforeEach(() => {
  jest.clearAllMocks();
  checkPermissionWithContext.mockReturnValue(true);
  rateLimit.mockResolvedValue({ allowed: true, remaining: 19 });
  submit.mockResolvedValue({ ok: true });
});

describe("submitSreInvestigationFeedback", () => {
  it("rejects malformed input before touching auth, limits or data", async () => {
    for (const bad of [
      { investigationRunId: "nope", verdict: "right" },
      { investigationRunId: runId, verdict: "maybe" },
      { investigationRunId: runId, verdict: "right", hypothesisKey: "../x" },
      { investigationRunId: runId, verdict: "right", note: "x".repeat(1001) },
    ] as never[]) {
      expect(await submitSreInvestigationFeedback(bad)).toEqual({ success: false, error: "Invalid feedback" });
    }
    expect(submit).not.toHaveBeenCalled();
  });

  it("requires the sre_incident update permission (viewers are denied)", async () => {
    checkPermissionWithContext.mockReturnValue(false);
    const result = await submitSreInvestigationFeedback({ investigationRunId: runId, verdict: "right" });
    expect(result).toEqual({ success: false, error: expect.stringContaining("Insufficient permissions") });
    expect(checkPermissionWithContext).toHaveBeenCalledWith("sre_incident", "update", expect.anything());
    expect(rateLimit).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("rate limits per user and run, with a distinct message when the limiter is down", async () => {
    rateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0 });
    expect(await submitSreInvestigationFeedback({ investigationRunId: runId, verdict: "wrong" })).toEqual({
      success: false,
      error: expect.stringContaining("Too much feedback"),
    });
    rateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, unavailable: true });
    expect(await submitSreInvestigationFeedback({ investigationRunId: runId, verdict: "wrong" })).toEqual({
      success: false,
      error: expect.stringContaining("temporarily unavailable"),
    });
    expect(rateLimit).toHaveBeenCalledWith(ctx.userId, runId);
    expect(submit).not.toHaveBeenCalled();
  });

  it("passes the caller's tenancy to the data layer and returns its tenancy failures", async () => {
    await submitSreInvestigationFeedback({ investigationRunId: runId, hypothesisKey: "h2", verdict: "wrong", note: "n" });
    expect(submit).toHaveBeenCalledWith(
      { userId: ctx.userId, organizationId: ctx.organizationId, projectId: ctx.project.id },
      { investigationRunId: runId, hypothesisKey: "h2", verdict: "wrong", note: "n" },
    );
    submit.mockResolvedValueOnce({ ok: false, error: "Investigation not found" });
    expect(await submitSreInvestigationFeedback({ investigationRunId: runId, verdict: "right" })).toEqual({
      success: false,
      error: "Investigation not found",
    });
  });
});
