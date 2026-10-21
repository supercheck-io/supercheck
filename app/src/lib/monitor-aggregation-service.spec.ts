/** @jest-environment node */
import { monitorAggregationService } from "./monitor-aggregation-service";
import type { SQL } from "drizzle-orm";

const mockOrderBy = jest.fn();
const mockWhere = jest.fn<{ orderBy: typeof mockOrderBy }, [SQL]>(() => ({
  orderBy: mockOrderBy,
}));
jest.mock("@/utils/db", () => ({
  db: {
    select: jest.fn(() => ({ from: jest.fn(() => ({ where: mockWhere })) })),
  },
}));

const periodStart = new Date("2026-10-01T00:00:00Z");
function row(
  location: string | null,
  totalChecks = 10,
  successfulChecks = totalChecks,
  day = 1,
) {
  return {
    location,
    periodStart: new Date(`2026-10-${String(day).padStart(2, "0")}T00:00:00Z`),
    totalChecks,
    successfulChecks,
    totalResponseMs: totalChecks * 100,
    avgResponseMs: 100,
    p95ResponseMs: 150,
    updatedAt: periodStart,
  };
}
const read = (location?: "eu-central" | null) =>
  monitorAggregationService.getAggregatedMetrics(
    "monitor-id",
    "daily",
    periodStart,
    new Date("2026-10-03T00:00:00Z"),
    location,
  );

describe("aggregate period precedence", () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([null, undefined])(
    "uses combined rows once and legacy location rows for other periods (%s)",
    async (location) => {
      mockOrderBy.mockResolvedValue([
        row(null, 20),
        row("eu-central"),
        row("us-east"),
        row("eu-central", 10, 8, 2),
        row("us-east", 10, 10, 2),
      ]);
      expect(await read(location)).toEqual({
        uptimePercentage: 95,
        avgResponseMs: 100,
        p95ResponseMs: 150,
        totalChecks: 40,
      });
    },
  );

  it("does not filter all-locations reads to combined rows", async () => {
    mockOrderBy.mockResolvedValue([row("eu-central")]);
    const result = await read(null);
    expect(result.totalChecks).toBe(10);
    // Execute the WHERE SQL against the real table metadata, rather than inspect mock call counts.
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const query = new PgDialect().sqlToQuery(mockWhere.mock.calls[0][0]);
    expect(query.sql).not.toContain('"location" IS NULL');
  });

  it("preserves explicit location filtering", async () => {
    mockOrderBy.mockResolvedValue([row("eu-central", 10, 8)]);
    expect((await read("eu-central")).uptimePercentage).toBe(80);
    const { PgDialect } = await import("drizzle-orm/pg-core");
    expect(
      new PgDialect().sqlToQuery(mockWhere.mock.calls[0][0]).params,
    ).toContain("eu-central");
  });
});
