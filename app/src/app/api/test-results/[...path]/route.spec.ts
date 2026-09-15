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
import {
  getReportCacheControl,
  resolveAccessContext,
} from "@/lib/test-results-access";

function selectResult(rows: unknown[]) {
  const limit = jest.fn().mockResolvedValue(rows);
  const where = jest.fn().mockReturnValue({
    limit,
    orderBy: jest.fn().mockReturnValue({ limit }),
  });

  return {
    from: jest.fn().mockReturnValue({
      leftJoin: jest.fn().mockReturnValue({ where }),
      where,
    }),
  };
}

describe("test result authorization", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("resolves a modern playground report through its persisted run id", async () => {
    (db.select as jest.Mock).mockReturnValueOnce(
      selectResult([{ organizationId: "org-owner", projectId: "project-owner" }]),
    );

    await expect(resolveAccessContext("test", "run-id")).resolves.toEqual({
      organizationId: "org-owner",
      projectId: "project-owner",
    });
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it("resolves an ephemeral playground testId through runs.metadata.testId", async () => {
    (db.select as jest.Mock)
      .mockReturnValueOnce(selectResult([]))
      .mockReturnValueOnce(
        selectResult([
          { organizationId: "org-play", projectId: "project-play" },
        ]),
      );

    await expect(
      resolveAccessContext("test", "ephemeral-test-id"),
    ).resolves.toEqual({
      organizationId: "org-play",
      projectId: "project-play",
    });
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it("falls back to the saved tests table for legacy test-id reports", async () => {
    (db.select as jest.Mock)
      .mockReturnValueOnce(selectResult([]))
      .mockReturnValueOnce(selectResult([]))
      .mockReturnValueOnce(
        selectResult([
          { organizationId: "org-saved", projectId: "project-saved" },
        ]),
      );

    await expect(resolveAccessContext("test", "saved-test-id")).resolves.toEqual(
      {
        organizationId: "org-saved",
        projectId: "project-saved",
      },
    );
    expect(db.select).toHaveBeenCalledTimes(3);
  });

  it("marks authorization-gated report assets as non-cacheable", () => {
    expect(getReportCacheControl()).toBe(
      "private, no-store, no-cache, must-revalidate",
    );
  });
});
