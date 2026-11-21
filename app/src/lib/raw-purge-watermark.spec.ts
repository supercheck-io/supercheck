/** @jest-environment node */
// The raw purge watermark statement. Its effect (forward only, dry runs untouched) runs against real PostgreSQL in
// monitor-results-cleanup.db.spec.ts.
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mockSet = jest.fn();
const mockWhere = jest.fn();
const mockUpdate = jest.fn();
jest.mock("@/utils/db", () => ({ db: { update: (...args: unknown[]) => mockUpdate(...args) } }));
jest.mock("@/lib/monitor-aggregation-service", () => ({ monitorAggregationService: {}, AGGREGATION_CONFIG: {} }));

import { monitors } from "@/db/schema";
import { advanceRawPurgeWatermark } from "./data-lifecycle-service";

it("moves the watermark to the cutoff in one statement that only ever moves it forward", async () => {
  mockWhere.mockResolvedValue(undefined);
  mockSet.mockReturnValue({ where: mockWhere });
  mockUpdate.mockReturnValue({ set: mockSet });
  const cutoff = new Date("2026-11-18T00:00:00Z");

  await advanceRawPurgeWatermark("monitor-1", cutoff);

  expect(mockUpdate).toHaveBeenCalledWith(monitors);
  expect(mockSet).toHaveBeenCalledWith({ rawPurgedBefore: cutoff });
  const where = new PgDialect().sqlToQuery(mockWhere.mock.calls[0][0] as SQL);
  expect(where.sql).toBe(
    '("monitors"."id" = $1 and ("monitors"."raw_purged_before" is null or "monitors"."raw_purged_before" < $2))',
  );
  expect(where.params).toEqual(["monitor-1", cutoff.toISOString()]);
});
