/** @jest-environment node */
const mockRetry = jest.fn();
const mockCount = jest.fn();
jest.mock("@/utils/db", () => ({ db: {} }));
jest.mock("@/lib/feature-flags", () => ({ isPolarEnabled: () => false }));
jest.mock("@/lib/monitor-aggregation-service", () => ({ monitorAggregationService: {} }));
jest.mock("@/lib/security/password-reset-cleanup", () => ({
  retryPendingCredentialRevocations: (...args: unknown[]) => mockRetry(...args),
  countPendingCredentialRevocations: (...args: unknown[]) => mockCount(...args),
}));
import { CredentialRevocationRetryStrategy } from "./data-lifecycle-service";

const config = { entityType: "credential_revocation_retry", cronSchedule: "20 * * * *", enabled: true } as never;

describe("CredentialRevocationRetryStrategy", () => {
  beforeEach(() => {
    mockRetry.mockReset();
    mockCount.mockReset();
  });

  it("retries pending revocations on its own schedule, independent of webhook cleanup", async () => {
    mockRetry.mockResolvedValue({ done: 2, failed: 0 });
    const result = await new CredentialRevocationRetryStrategy(config).execute();
    expect(result).toMatchObject({
      success: true,
      details: { credentialRevocationsRetried: 2, credentialRevocationsFailed: 0 },
    });
  });

  it("reports failure while any revocation is still failing, so a live stolen credential is not a green run", async () => {
    mockRetry.mockResolvedValue({ done: 1, failed: 2 });
    jest.spyOn(console, "error").mockImplementation(() => {});
    const result = await new CredentialRevocationRetryStrategy(config).execute();
    expect(result.success).toBe(false);
    expect(result.errors).toEqual([expect.stringContaining("2 credential revocation(s) are still failing")]);
    expect(result.details).toMatchObject({ credentialRevocationsRetried: 1, credentialRevocationsFailed: 2 });
  });

  it("counts the pending revocations as the backlog", async () => {
    mockCount.mockResolvedValue(3);
    expect(await new CredentialRevocationRetryStrategy(config).getStats()).toEqual({ totalRecords: 3, oldRecords: 3 });
  });

  it("reports a failed sweep so it can be alerted on", async () => {
    mockRetry.mockRejectedValue(new Error("database unavailable"));
    jest.spyOn(console, "error").mockImplementation(() => {});
    const result = await new CredentialRevocationRetryStrategy(config).execute();
    expect(result.success).toBe(false);
    expect(result.errors).toEqual(["database unavailable"]);
  });

  it("does nothing on a dry run", async () => {
    await new CredentialRevocationRetryStrategy(config).execute(true);
    expect(mockRetry).not.toHaveBeenCalled();
  });
});
