/** @jest-environment node */

jest.mock("@/utils/db", () => ({
  db: { select: jest.fn() },
}));

jest.mock("@/lib/s3-proxy", () => ({ fetchFromS3: jest.fn() }));
jest.mock("@/lib/rbac/middleware", () => ({ hasPermissionForUser: jest.fn() }));
jest.mock("@/lib/auth-context", () => ({
  requireUserAuthContext: jest.fn(),
  isAuthError: jest.fn(),
}));
jest.mock("@/lib/report-results-utils", () => ({
  buildTimeoutResponse: jest.fn(),
  isCancellationError: jest.fn(),
  resolveExecutionErrorDetails: jest.fn(),
}));

import { db } from "@/utils/db";
import { getReportCacheControl, resolveAccessContext } from "@/lib/test-results-access";

function selectResult(rows: unknown[]) {
  return {
    from: jest.fn().mockReturnValue({
      leftJoin: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue(rows),
        }),
      }),
    }),
  };
}

describe("test result authorization", () => {
  it("resolves a modern playground report through its persisted run", async () => {
    (db.select as jest.Mock).mockReturnValueOnce(
      selectResult([{ organizationId: "org-owner", projectId: "project-owner" }]),
    );

    await expect(resolveAccessContext("test", "run-id")).resolves.toEqual({
      organizationId: "org-owner",
      projectId: "project-owner",
    });
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it("marks authorization-gated report assets as non-cacheable", () => {
    expect(getReportCacheControl()).toBe(
      "private, no-store, no-cache, must-revalidate",
    );
  });
});
