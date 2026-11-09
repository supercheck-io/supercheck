/** @jest-environment node */
import { NextRequest } from "next/server";
import { GET } from "@/app/api/monitors/[id]/stats/route";
const mockWindow = jest.fn();
const mockRawP95 = jest.fn();
const mockHasLocation = jest.fn();
jest.mock("@/utils/db", () => ({
  db: {
    query: {
      monitors: {
        findFirst: async () => ({
          organizationId: "org",
          projectId: "project",
        }),
      },
    },
  },
}));
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: async () => ({
    organizationId: "org",
    project: { id: "project" },
  }),
  isAuthError: () => false,
}));
jest.mock("@/lib/rbac/middleware", () => ({
  checkPermissionWithContext: () => true,
}));
jest.mock("@/lib/monitor-aggregation-service", () => ({
  monitorAggregationService: {
    getWindowMetrics: (...args: unknown[]) => mockWindow(...args),
    getRawP95: (...args: unknown[]) => mockRawP95(...args),
    monitorHasLocation: (...args: unknown[]) => mockHasLocation(...args),
  },
}));
jest.mock("@/lib/logger/index", () => ({
  createLogger: () => ({ debug: jest.fn(), error: jest.fn() }),
}));

const call = (query = "") =>
  GET(
    new NextRequest(`http://localhost/api/monitors/00000000-0000-4000-8000-000000000099/stats${query}`),
    { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000099" }) },
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockHasLocation.mockResolvedValue(true);
});

it("reports exact up counts, the raw 24h p95 and the histogram 30d p95", async () => {
  mockWindow.mockImplementation((_id, period) =>
    Promise.resolve(
      period === "hourly"
        ? { totalChecks: 3, successfulChecks: 1, uptimePercentage: 100 / 3, avgResponseMs: 50, p95ResponseMs: 1 }
        : { totalChecks: 100000, successfulChecks: 99999, uptimePercentage: 99.999, avgResponseMs: 120, p95ResponseMs: 180 },
    ),
  );
  mockRawP95.mockResolvedValue(95);
  const { data, meta } = await (await call()).json();
  expect(data.period24h).toEqual({
    totalChecks: 3,
    upChecks: 1,
    uptimePercentage: 100 / 3,
    avgResponseTimeMs: 50,
    p95ResponseTimeMs: 95,
  });
  // Exact count: not rebuilt from the rounded percentage.
  expect(data.period30d).toMatchObject({ upChecks: 99999, p95ResponseTimeMs: 180 });
  expect(meta.source).toBe("aggregates+raw");
});

it("returns an empty window as null uptime", async () => {
  mockWindow.mockResolvedValue({ totalChecks: 0, successfulChecks: 0, uptimePercentage: null, avgResponseMs: null, p95ResponseMs: null });
  mockRawP95.mockResolvedValue(null);
  const { data } = await (await call()).json();
  expect(data.period24h).toMatchObject({ totalChecks: 0, uptimePercentage: null, p95ResponseTimeMs: null });
});

it("answers 400 for an unknown location and passes a known one to every query", async () => {
  mockHasLocation.mockResolvedValueOnce(false);
  const rejected = await call("?location=nowhere");
  expect(rejected.status).toBe(400);
  expect(mockWindow).not.toHaveBeenCalled();

  mockWindow.mockResolvedValue({ totalChecks: 0, successfulChecks: 0, uptimePercentage: null, avgResponseMs: null, p95ResponseMs: null });
  mockRawP95.mockResolvedValue(null);
  expect((await call("?location=eu")).status).toBe(200);
  expect(mockWindow).toHaveBeenCalledWith(expect.any(String), "hourly", expect.any(Date), expect.any(Date), "eu");
  expect(mockRawP95).toHaveBeenCalledWith(expect.any(String), expect.any(Date), "eu");
});
