const { hasNoTransactionMarker, concurrentIndexNames } = require("./db-migrate.js");

describe("db-migrate no-transaction files", () => {
  it("detects the file-level marker only as its own comment line", () => {
    expect(hasNoTransactionMarker("-- supercheck:no-transaction\nCREATE INDEX CONCURRENTLY x ON t (c);")).toBe(true);
    expect(hasNoTransactionMarker("-- note\n--supercheck:no-transaction  \nSELECT 1;")).toBe(true);
    expect(hasNoTransactionMarker("SELECT 1; -- supercheck:no-transaction")).toBe(false);
    expect(hasNoTransactionMarker("CREATE INDEX x ON t (c);")).toBe(false);
  });

  it("finds the indexes a file builds concurrently", () => {
    const sql = `CREATE INDEX CONCURRENTLY IF NOT EXISTS runs_a_idx ON runs (a);
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY "runs_b_idx" ON runs (b);
CREATE INDEX plain_idx ON runs (c);`;
    expect(concurrentIndexNames(sql)).toEqual(["runs_a_idx", "runs_b_idx"]);
  });
});
