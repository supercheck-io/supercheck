const { setStatementTimeout, hasNoTransactionMarker, concurrentIndexNames, concurrentIndexes, assertDeferredFileRerunnable } = require("./db-migrate.js");

describe("db-migrate no-transaction files", () => {
  it("detects the file-level marker only as its own comment line", () => {
    expect(hasNoTransactionMarker("-- supercheck:no-transaction\nCREATE INDEX CONCURRENTLY x ON t (c);")).toBe(true);
    expect(hasNoTransactionMarker("-- note\n--supercheck:no-transaction  \nSELECT 1;")).toBe(true);
    expect(hasNoTransactionMarker("SELECT 1; -- supercheck:no-transaction")).toBe(false);
    expect(hasNoTransactionMarker("CREATE INDEX x ON t (c);")).toBe(false);
  });

  it("matches the marker only in the leading comment block", () => {
    expect(hasNoTransactionMarker("\n-- a\n\n-- supercheck:no-transaction")).toBe(true);
    expect(hasNoTransactionMarker("CREATE TABLE t (c int);\n-- supercheck:no-transaction\nSELECT 1;")).toBe(false);
  });

  it("finds the indexes a file builds concurrently", () => {
    const sql = `CREATE INDEX CONCURRENTLY IF NOT EXISTS runs_a_idx ON runs (a);
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY "runs_b_idx" ON runs (b);
CREATE INDEX plain_idx ON runs (c);`;
    expect(concurrentIndexNames(sql)).toEqual(["runs_a_idx", "runs_b_idx"]);
  });
  it("captures the table each concurrent index is built on", () => {
    expect(concurrentIndexes('CREATE INDEX CONCURRENTLY IF NOT EXISTS a_idx ON app.runs (a);')[0]).toEqual({
      name: "a_idx", table: "app.runs", ifNotExists: true,
    });
  });
  it("rejects a no-transaction file with a plain CREATE INDEX CONCURRENTLY", () => {
    const ok = "CREATE INDEX CONCURRENTLY IF NOT EXISTS a_idx ON t (a);\n--> statement-breakpoint\nCREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS b_idx ON t (b);";
    expect(() => assertDeferredFileRerunnable("0099.sql", ok)).not.toThrow();
    const bad = `${ok}\n-- CREATE INDEX CONCURRENTLY ignored_in_comment ON t (c);\nCREATE INDEX CONCURRENTLY c_idx ON t (c);`;
    expect(() => assertDeferredFileRerunnable("0099.sql", bad)).toThrow(/0099\.sql.*IF NOT EXISTS.*c_idx/);
  });
  it("ignores block comments and string literals when checking for plain CONCURRENTLY builds", () => {
    const sql = `/* CREATE INDEX CONCURRENTLY commented_idx ON t (a); */
SELECT 'CREATE INDEX CONCURRENTLY quoted_idx ON t (a); -- x';
CREATE INDEX CONCURRENTLY IF NOT EXISTS real_idx ON t (b);`;
    expect(concurrentIndexNames(sql)).toEqual(["real_idx"]);
    expect(() => assertDeferredFileRerunnable("0099.sql", sql)).not.toThrow();
  });
});

describe("setStatementTimeout", () => {
  it("sets the timeout with a session SET, not a startup parameter", async () => {
    const unsafe = jest.fn().mockResolvedValue([]);
    await setStatementTimeout({ unsafe }, 90000);
    expect(unsafe).toHaveBeenCalledWith("SET statement_timeout = 90000");
  });
});
