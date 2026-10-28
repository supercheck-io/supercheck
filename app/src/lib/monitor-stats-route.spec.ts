/** @jest-environment node */
import { NextRequest } from "next/server";
import { GET } from "@/app/api/monitors/[id]/stats/route";
const mockAggregates = jest.fn();
const mockRaw = jest.fn();
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
    select: () => ({ from: () => ({ where: mockRaw }) }),
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
    getAggregatedMetrics: (...args: unknown[]) => mockAggregates(...args),
  },
  calculatePercentile: jest.requireActual("@/lib/monitor-aggregation-service")
    .calculatePercentile,
}));
jest.mock("@/lib/logger/index", () => ({
  createLogger: () => ({ debug: jest.fn(), error: jest.fn() }),
}));

it("preserves historical 30d aggregates when the 24h window only has raw data", async () => {
  mockAggregates.mockImplementation((_id, period) =>
    Promise.resolve({
      totalChecks: period === "daily" ? 100 : 0,
      uptimePercentage: 90,
      avgResponseMs: 120,
      p95ResponseMs: 180,
    }),
  );
  // The first query is the unaggregated tail of the aggregated 30d window: nothing there.
  mockRaw.mockResolvedValueOnce([{ totalChecks: 0, upChecks: 0, avgResponseTime: null }]);
  mockRaw.mockResolvedValue([
    { totalChecks: 2, upChecks: 2, avgResponseTime: 50 },
  ]);
  const response = await GET(
    new NextRequest("http://localhost/api/monitors/00000000-0000-4000-8000-000000000099/stats"),
    { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000099" }) },
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.data.period24h.totalChecks).toBe(2);
  expect(body.data.period30d).toEqual({
    totalChecks: 100,
    upChecks: 90,
    uptimePercentage: 90,
    avgResponseTimeMs: 120,
    p95ResponseTimeMs: 180,
  });
  expect(body.meta.source).toBe("aggregates+raw");
});

it.each(["hourly", "daily"])(
  "uses raw P95 for a %s aggregate with no percentile in a mixed-window response",
  async (aggregatePeriod) => {
    mockAggregates.mockImplementation((_id, period) =>
      Promise.resolve({
        totalChecks: period === aggregatePeriod ? 100 : 0,
        uptimePercentage: 90,
        avgResponseMs: 120,
        p95ResponseMs: null,
      }),
    );
    mockRaw.mockReset();
    mockRaw
      .mockResolvedValueOnce([{ totalChecks: 0, upChecks: 0, avgResponseTime: null }])
      .mockResolvedValueOnce([
        { totalChecks: 5, upChecks: 5, avgResponseTime: 30 },
      ])
      .mockResolvedValueOnce([
        { totalChecks: 5, upChecks: 5, avgResponseTime: 30 },
      ])
      .mockResolvedValue(
        [10, 20, 30, 40, 50].map((responseTimeMs) => ({ responseTimeMs })),
      );
    const response = await GET(
      new NextRequest("http://localhost/api/monitors/00000000-0000-4000-8000-000000000099/stats"),
      { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000099" }) },
    );
    const body = await response.json();
    expect(
      body.data[aggregatePeriod === "hourly" ? "period24h" : "period30d"]
        .p95ResponseTimeMs,
    ).toBe(50);
    expect(body.meta.source).toBe("aggregates+raw");
  },
);

it("counts raw results outside the aggregated periods, so a fresh outage is not 100% (c13)", async () => {
  mockAggregates.mockResolvedValue({ uptimePercentage: 100, avgResponseMs: 100, p95ResponseMs: 120, totalChecks: 90 });
  mockRaw.mockReset();
  // Every tail query returns 10 failed checks from the in-progress hour/day.
  mockRaw.mockResolvedValue([{ totalChecks: 10, upChecks: 0, avgResponseTime: null }]);
  const response = await GET(
    new NextRequest("http://localhost/api/monitors/00000000-0000-4000-8000-000000000099/stats"),
    { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000099" }) },
  );
  const { data } = await response.json();
  expect(data.period24h.totalChecks).toBe(100);
  expect(data.period24h.uptimePercentage).toBeCloseTo(90);
  expect(data.period30d.totalChecks).toBe(100);
});
