/** @jest-environment node */
const mockExecute = jest.fn();
const mockSuppressed = jest.fn();
jest.mock("@/utils/db", () => ({ db: { execute: (...a: unknown[]) => mockExecute(...a) } }));
jest.mock("@/lib/maintenance/predicate", () => ({ isIncidentPagingSuppressed: (...a: unknown[]) => mockSuppressed(...a) }));

import { PgDialect } from "drizzle-orm/pg-core";
import { incidentHeldForMaintenance } from "./incident-maintenance";

const at = new Date("2026-11-14T10:00:00Z");
beforeEach(() => jest.clearAllMocks());

it("is not held, and writes nothing, when no maintenance covers the incident", async () => {
  mockSuppressed.mockResolvedValue(false);
  expect(await incidentHeldForMaintenance("inc-1", at)).toBe(false);
  expect(mockSuppressed).toHaveBeenCalledWith("inc-1", at);
  expect(mockExecute).not.toHaveBeenCalled();
});

it("holds and notes the suppression once since the last page", async () => {
  mockSuppressed.mockResolvedValue(true);
  mockExecute.mockResolvedValue([]);
  expect(await incidentHeldForMaintenance("inc-1", at)).toBe(true);
  const query = new PgDialect().sqlToQuery(mockExecute.mock.calls[0][0]);
  expect(query.sql).toContain("paging_suppressed_maintenance");
  expect(query.sql).toContain("NOT EXISTS");
  expect(query.params).toEqual(expect.arrayContaining(["inc-1", at.toISOString()]));
});

it("still holds when the note cannot be written", async () => {
  mockSuppressed.mockResolvedValue(true);
  mockExecute.mockRejectedValue(new Error("db"));
  expect(await incidentHeldForMaintenance("inc-1", at)).toBe(true);
});
