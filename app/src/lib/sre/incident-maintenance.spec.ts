/** @jest-environment node */
let mockRows: unknown[] = [];
const whereArgs: unknown[] = [];
const node: Record<string, unknown> = {};
for (const name of ["from", "innerJoin"]) node[name] = () => node;
node.where = (w: unknown) => { whereArgs.push(w); return node; };
node.limit = async () => mockRows;
jest.mock("@/utils/db", () => ({ db: { select: () => node } }));

import { PgDialect } from "drizzle-orm/pg-core";
import { incidentHeldForMaintenance } from "./incident-maintenance";

it("holds while an unresolved, in-window maintenance covers the incident's trigger monitor", async () => {
  const at = new Date("2026-11-14T10:00:00Z");
  mockRows = [{ id: "m1" }];
  expect(await incidentHeldForMaintenance("inc-1", at)).toBe(true);
  const query = new PgDialect().sqlToQuery(whereArgs[0] as never);
  expect(query.sql).toContain('"sre_incident_alerts"."role" = $');
  expect(query.sql).toContain('"incidents"."status" <> $');
  expect(query.sql).toContain('"incidents"."scheduled_for" <= $');
  expect(query.sql).toContain('"incidents"."scheduled_until" > $');
  expect(query.params).toEqual(expect.arrayContaining(["inc-1", "trigger", "monitor", "resolved"]));
  mockRows = [];
  expect(await incidentHeldForMaintenance("inc-1", at)).toBe(false);
});
