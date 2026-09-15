/** @jest-environment node */
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as appSchema from "../src/db/schema";
import path from "node:path";

// Load the independently built worker at runtime. A static TS import would pull
// its separate Drizzle dependency graph into the app's production compilation.
const workerSchema: Record<string, unknown> = require(path.join(__dirname, "../../worker/src/db/schema"));

function tables(schema: Record<string, unknown>) {
  return new Map(Object.values(schema).filter((value): value is PgTable => is(value, PgTable))
    .map((table) => { const config = getTableConfig(table); return [config.name, config] as const; }));
}
const app = tables(appSchema);
const worker = tables(workerSchema);

describe("app/worker database contract", () => {
  it("includes the core execution, billing, and SRE tables", () => {
    for (const name of ["organization", "monitor_results", "usage_events", "sre_investigation_runs"]) {
      expect(app.has(name)).toBe(true);
      expect(worker.has(name)).toBe(true);
    }
  });
  it.each([...worker.entries()])("keeps shared column types and nullability compatible for %s", (name, workerTable) => {
    const appTable = app.get(name);
    expect(appTable).toBeDefined();
    for (const column of workerTable.columns) {
      const expected = appTable!.columns.find((candidate) => candidate.name === column.name);
      expect(expected).toBeDefined();
      expect({ name: column.name, type: column.getSQLType(), dataType: column.dataType, notNull: column.notNull, primary: column.primary })
        .toEqual({ name: expected!.name, type: expected!.getSQLType(), dataType: expected!.dataType, notNull: expected!.notNull, primary: expected!.primary });
    }
  });
});
