/** @jest-environment node */

import { NextRequest } from "next/server";

jest.mock("@/utils/db", () => ({
  db: {
    query: {
      monitors: {
        findFirst: jest.fn(),
      },
    },
    select: jest.fn(),
  },
}));

jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn(),
  isAuthError: jest.fn(),
}));

jest.mock("@/lib/rbac/middleware", () => ({
  checkPermissionWithContext: jest.fn(),
}));

jest.mock("@/lib/logger/index", () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

import { buildMonitorResultsDateRange, GET } from "./route";

const { db: mockDb } = jest.requireMock("@/utils/db") as {
  db: {
    query: {
      monitors: {
        findFirst: jest.Mock;
      };
    };
    select: jest.Mock;
  };
};

const {
  requireAuthContext: mockRequireAuthContext,
  isAuthError: mockIsAuthError,
} = jest.requireMock("@/lib/auth-context") as {
  requireAuthContext: jest.Mock;
  isAuthError: jest.Mock;
};

const { checkPermissionWithContext: mockCheckPermissionWithContext } =
  jest.requireMock("@/lib/rbac/middleware") as {
    checkPermissionWithContext: jest.Mock;
  };

describe("monitor results date filtering", () => {
  it("builds a UTC date range when no timezone offset is provided", () => {
    const range = buildMonitorResultsDateRange("2026-06-16");

    expect(range?.start.toISOString()).toBe("2026-06-16T00:00:00.000Z");
    expect(range?.end.toISOString()).toBe("2026-06-17T00:00:00.000Z");
  });

  it("builds a local calendar day range when timezone offset is provided", () => {
    const range = buildMonitorResultsDateRange("2026-06-16", -330);

    expect(range?.start.toISOString()).toBe("2026-06-15T18:30:00.000Z");
    expect(range?.end.toISOString()).toBe("2026-06-16T18:30:00.000Z");
  });

  it("rejects malformed or impossible dates", () => {
    expect(buildMonitorResultsDateRange("2026-6-16")).toBeNull();
    expect(buildMonitorResultsDateRange("2026-02-30")).toBeNull();
  });
});

describe("GET /api/monitors/[id]/results validation", () => {
  const routeContext = {
    params: Promise.resolve({ id: "monitor-1" }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAuthError.mockReturnValue(false);
    mockRequireAuthContext.mockResolvedValue({
      organizationId: "org-1",
      project: { id: "project-1" },
    });
    mockCheckPermissionWithContext.mockReturnValue(true);
    mockDb.query.monitors.findFirst.mockResolvedValue({
      id: "monitor-1",
      organizationId: "org-1",
      projectId: "project-1",
    });
  });

  it("rejects invalid date filters before querying the database", async () => {
    const request = new NextRequest(
      "http://localhost/api/monitors/monitor-1/results?date=2026-02-30"
    );

    const response = await GET(request, routeContext);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("Invalid date parameter");
    expect(mockRequireAuthContext).not.toHaveBeenCalled();
    expect(mockDb.query.monitors.findFirst).not.toHaveBeenCalled();
  });

  it("rejects non-integer pagination inputs", async () => {
    const request = new NextRequest(
      "http://localhost/api/monitors/monitor-1/results?page=1abc&limit=10"
    );

    const response = await GET(request, routeContext);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("Invalid pagination parameters");
    expect(mockRequireAuthContext).not.toHaveBeenCalled();
  });

  it("rejects out-of-range timezone offsets", async () => {
    const request = new NextRequest(
      "http://localhost/api/monitors/monitor-1/results?date=2026-06-16&timezoneOffset=9999"
    );

    const response = await GET(request, routeContext);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("Invalid timezoneOffset parameter");
    expect(mockRequireAuthContext).not.toHaveBeenCalled();
  });
});
