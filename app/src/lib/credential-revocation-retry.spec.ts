/** @jest-environment node */
const mockRetry = jest.fn();
jest.mock("@/utils/db", () => ({ db: {} }));
jest.mock("@/lib/feature-flags", () => ({ isPolarEnabled: () => false }));
jest.mock("@/lib/monitor-aggregation-service", () => ({ monitorAggregationService: {} }));
jest.mock("@/lib/security/password-reset-cleanup", () => ({
  retryPendingCredentialRevocations: (...args: unknown[]) => mockRetry(...args),
}));
import { CredentialRevocationRetryStrategy } from "./data-lifecycle-service";

const config = { entityType: "credential_revocation_retry", cronSchedule: "20 * * * *", enabled: true } as never;

describe("CredentialRevocationRetryStrategy", () => {
  beforeEach(() => mockRetry.mockReset());

  it("retries pending revocations on its own schedule, independent of webhook cleanup", async () => {
    mockRetry.mockResolvedValue(2);
    const result = await new CredentialRevocationRetryStrategy(config).execute();
    expect(result).toMatchObject({ success: true, details: { credentialRevocationsRetried: 2 } });
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
