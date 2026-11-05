const { migrationFailureHint, onNotice, migrationWarnings, reportNotValidViolations, looksPooled, setStatementTimeout, hasNoTransactionMarker, concurrentIndexNames, concurrentIndexes, assertDeferredFileRerunnable } = require("./db-migrate.js");

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

describe("looksPooled", () => {
  it("detects a pooler by port, hostname, host parameter or pgbouncer flag", () => {
    for (const url of ["postgresql://u:p@db.example.com:6432/app", "postgresql://u:p@x-pgbouncer.internal/app", "postgresql://u:p@h/app?host=db-pooler.internal", "postgresql://u:p@db-pooler.example.com/app", "postgresql://u:p@db.example.com:5432/app?pgbouncer=true"]) {
      expect(looksPooled(url)).toBe(true);
    }
  });
  it("treats a direct URL as not pooled, ignoring unrelated parameters", () => {
    expect(looksPooled("postgresql://u:p@db.example.com:5432/app")).toBe(false);
    expect(looksPooled("postgresql://u:p@db.example.com:5432/app?application_name=pooler-maintenance")).toBe(false);
  });
});

describe("migration warnings and hints", () => {
  it("collects RAISE WARNING notices and ignores other notices", () => {
    migrationWarnings.length = 0;
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    onNotice({ severity: "NOTICE", message: "identifier will be truncated" });
    onNotice({ severity: "WARNING", message: "invitation_pending_org_email_unique_idx not created: duplicate rows exist" });
    log.mockRestore();
    expect(migrationWarnings).toEqual(["invitation_pending_org_email_unique_idx not created: duplicate rows exist"]);
  });

  it("explains how to get past the 0053 TimeZone guard, and only for that error", () => {
    const hint = migrationFailureHint(new Error("Migration 0053_timestamptz stopped: the database TimeZone is Asia/Kolkata (not UTC)"));
    expect(hint).toMatch(/ALTER DATABASE ".*" SET timezone TO 'UTC'/);
    expect(migrationFailureHint(new Error("something else"))).toBeNull();
  });

  it("counts the rows violating each CHECK left NOT VALID", async () => {
    const calls = [];
    const client = jest.fn().mockResolvedValue([{ table_name: "jobs", conname: "jobs_status_check", expr: "status = ANY (ARRAY['a'])" }]);
    const tx = jest.fn(async (strings) => { calls.push(strings.join("?")); return []; });
    tx.unsafe = jest.fn(async (sql) => { calls.push(sql); return [{ n: 3 }]; });
    client.begin = jest.fn(async (fn) => fn(tx));
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    await reportNotValidViolations(client);
    const output = log.mock.calls.map((c) => c[0]).join("\n");
    log.mockRestore();
    // The count runs in a transaction that first bounds lock and statement time.
    expect(calls[0]).toMatch(/set_config\('lock_timeout'.*set_config\('statement_timeout'/);
    expect(calls[1]).toBe("SELECT count(*)::int AS n FROM jobs WHERE NOT (status = ANY (ARRAY['a']))");
    expect(output).toMatch(/jobs_status_check on jobs is NOT VALID: 3 existing row\(s\)/);
  });
});

describe("db-migrate target safety", () => {
  const { spawnSync } = require("node:child_process");
  const run = (env) =>
    spawnSync(process.execPath, [require("node:path").join(__dirname, "db-migrate.js")], {
      env: { PATH: process.env.PATH, ...env },
      encoding: "utf8",
      timeout: 20000,
    });

  it("refuses to run without DATABASE_URL or DB_HOST instead of targeting localhost", () => {
    const result = run({});
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Refusing to run: neither DATABASE_URL nor DB_HOST is set/);
    expect(result.stdout).not.toMatch(/Waiting for/);
  });
  it("treats a blank DATABASE_URL as unset", () => {
    expect(run({ DATABASE_URL: "  " }).status).toBe(1);
  });
  it("falls back to the DB_* target when DATABASE_URL is blank but DB_HOST is set", () => {
    const result = run({ DATABASE_URL: "   ", DB_HOST: "db.invalid", DB_PORT: "1", DB_NAME: "app" });
    expect(result.stdout).toMatch(/Database URL: postgresql:\/\/postgres:\*\*\*@db\.invalid:1\/app/);
  });
});
