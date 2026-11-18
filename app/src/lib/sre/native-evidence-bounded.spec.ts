/** @jest-environment node */
jest.mock("@/utils/db", () => ({ db: {} }));
jest.mock("@/lib/sre/evidence-brief-orchestrator", () => ({ persistNativeEvidence: jest.fn() }));

import { persistNativeEvidence } from "@/lib/sre/evidence-brief-orchestrator";
import { persistNativeEvidenceWithin } from "./native-evidence-bounded";

const input = { organizationId: "o", projectId: "p", incidentId: "i", userId: null, investigationRunId: "r" };

describe("persistNativeEvidenceWithin", () => {
  afterEach(() => jest.useRealTimers());

  it("resolves when collection finishes in time", async () => {
    (persistNativeEvidence as jest.Mock).mockResolvedValue({ createdCount: 1 });
    await expect(persistNativeEvidenceWithin(input, 1000)).resolves.toBeUndefined();
    expect(persistNativeEvidence).toHaveBeenCalledWith(expect.objectContaining({ incidentId: "i", signal: expect.any(AbortSignal) }));
  });

  it("aborts and rejects on timeout", async () => {
    jest.useFakeTimers();
    let signal: AbortSignal | undefined;
    (persistNativeEvidence as jest.Mock).mockImplementation((arg: { signal: AbortSignal }) => { signal = arg.signal; return new Promise(() => undefined); });
    const pending = expect(persistNativeEvidenceWithin(input, 15_000)).rejects.toThrow("timed out");
    await jest.advanceTimersByTimeAsync(15_001);
    await pending;
    expect(signal?.aborted).toBe(true);
  });
});
