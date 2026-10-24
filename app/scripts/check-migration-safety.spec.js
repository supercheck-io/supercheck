/** @jest-environment node */

const { findUnsafeStatements } = require("./check-migration-safety");

describe("migration safety check", () => {
  it.each(["lock_timeout", "statement_timeout"])("rejects a leaked %s", (setting) => {
    expect(findUnsafeStatements(`SET LOCAL ${setting} = '5s'; SELECT 1;`)).toEqual([
      { line: 1, operation: `SET LOCAL ${setting} without RESET` },
    ]);
    expect(findUnsafeStatements(`RESET ${setting}; SET LOCAL ${setting} = '5s';`)).toHaveLength(1);
    expect(findUnsafeStatements(`SET LOCAL ${setting} = '5s'; RESET ${setting};`)).toEqual([]);
    expect(findUnsafeStatements(`-- SET LOCAL ${setting} = '5s';\nSELECT 1;`)).toEqual([]);
  });
  it.each([
    ["SET statement_timeout = 0;", "statement_timeout"],
    ["SET SESSION lock_timeout = '1s';", "lock_timeout"],
    ["DO $$ BEGIN SET statement_timeout = 0; END $$;", "statement_timeout"],
    ["DO $$ BEGIN PERFORM set_config('lock_timeout', '0', false); END $$;", "lock_timeout"],
  ])("rejects a session-level change: %s", (sql, setting) => {
    expect(findUnsafeStatements(sql)).toEqual([
      { line: 1, operation: `session-level ${setting} change (use SET LOCAL or set_config(..., true))` },
    ]);
  });
  it.each([
    ["EXECUTE 'SET statement_timeout = 0'", "statement_timeout"],
    ["PERFORM set_config('statement_timeout', coalesce(previous, '1s'), false);", "statement_timeout"],
    ["PERFORM set_config('lock_timeout', current_setting('app.t'), 'false');", "lock_timeout"],
  ])("rejects a session-level change hidden in a DO block: %s", (statement, setting) => {
    expect(findUnsafeStatements(`DO $$ BEGIN ${statement} END $$;`)).toEqual([
      { line: 1, operation: `session-level ${setting} change (use SET LOCAL or set_config(..., true))` },
    ]);
  });
  it("reports the line of the SET itself, not the preceding statement", () => {
    expect(findUnsafeStatements("-- x\nSELECT 1;\n\nSET lock_timeout = '1s';")).toEqual([
      { line: 4, operation: "session-level lock_timeout change (use SET LOCAL or set_config(..., true))" },
    ]);
  });
  it("ignores timeout changes quoted in message text, even after a semicolon", () => {
    expect(findUnsafeStatements("DO $$ BEGIN RAISE NOTICE 'a; SET statement_timeout = 0'; END $$;")).toEqual([]);
    expect(findUnsafeStatements("SELECT 'x; SET lock_timeout = 0';")).toEqual([]);
  });
  it("allows the transaction-local restore pattern and ignores timeouts in comments or messages", () => {
    const sql = `
      -- SET statement_timeout = 0;
      DO $$ BEGIN
        PERFORM set_config('lock_timeout', '5s', true);
        PERFORM set_config('statement_timeout', previous_statement_timeout, true);
        RAISE NOTICE 'do not SET statement_timeout globally';
      END $$;
    `;
    expect(findUnsafeStatements(sql)).toEqual([]);
  });
  it.each([
    ['DROP TABLE "legacy";', "DROP TABLE"],
    ['ALTER TABLE "users" DROP COLUMN "legacy";', "DROP COLUMN"],
    ['DROP TYPE "legacy_status";', "DROP TYPE"],
    ['DROP INDEX "users_legacy_idx";', "DROP INDEX"],
    ['DROP SCHEMA "legacy";', "DROP SCHEMA"],
    ['DROP MATERIALIZED VIEW "legacy_rollup";', "DROP MATERIALIZED VIEW"],
    ['DROP VIEW "legacy_users";', "DROP VIEW"],
    ['TRUNCATE TABLE "usage_events";', "TRUNCATE"],
    ['ALTER TABLE "users" DROP CONSTRAINT "users_email_key";', "DROP CONSTRAINT"],
    ['ALTER TABLE "users" RENAME COLUMN "name" TO "display_name";', "RENAME TABLE OR COLUMN"],
    ['ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL;', "SET NOT NULL"],
    ['ALTER TABLE "users" ALTER "email" SET NOT NULL;', "SET NOT NULL"],
    ['ALTER TABLE "users" ALTER COLUMN "role" TYPE text;', "ALTER COLUMN TYPE"],
    ['ALTER TABLE "users" ALTER "role" TYPE text;', "ALTER COLUMN TYPE"],
    ['DELETE FROM "usage_events";', "DELETE FROM without WHERE"],
    [
      'ALTER TABLE "users" ADD COLUMN "email" text NOT NULL;',
      "ADD COLUMN NOT NULL without DEFAULT",
    ],
    [
      'ALTER TABLE "users" ADD "email" text NOT NULL;',
      "ADD COLUMN NOT NULL without DEFAULT",
    ],
  ])("rejects %s", (sql, operation) => {
    expect(findUnsafeStatements(sql)).toEqual([{ line: 1, operation }]);
  });

  it("allows additive migrations", () => {
    const sql = `
      CREATE TABLE "events" ("id" uuid PRIMARY KEY);
      ALTER TABLE "events" ADD COLUMN "kind" text;
      ALTER TABLE "events" ADD COLUMN "source" text NOT NULL DEFAULT 'api';
      DELETE FROM "events" WHERE "kind" = 'expired';
      CREATE INDEX "events_kind_idx" ON "events" ("kind");
    `;

    expect(findUnsafeStatements(sql)).toEqual([]);
  });

  it("checks DELETE predicates after the DELETE rather than inside a CTE", () => {
    const sql = `
      WITH expired AS (SELECT id FROM events WHERE created_at < now())
      DELETE FROM events;
    `;

    expect(findUnsafeStatements(sql)).toEqual([
      { line: 3, operation: "DELETE FROM without WHERE" },
    ]);
  });

  it("checks each top-level ADD COLUMN clause independently", () => {
    const sql = `
      ALTER TABLE events
        ADD COLUMN source text NOT NULL DEFAULT 'api',
        ADD COLUMN tenant_id uuid NOT NULL;
    `;

    expect(findUnsafeStatements(sql)).toEqual([
      { line: 4, operation: "ADD COLUMN NOT NULL without DEFAULT" },
    ]);
  });

  it("ignores keywords in comments, strings, and function bodies", () => {
    const sql = `
      -- DROP TABLE users;
      SELECT 'ALTER TABLE users DROP COLUMN email';
      CREATE FUNCTION explain_change() RETURNS text AS $$
      BEGIN
        RETURN 'DROP TYPE legacy';
      END;
      $$ LANGUAGE plpgsql;
    `;

    expect(findUnsafeStatements(sql)).toEqual([]);
  });

  it.each([
    "INSERT INTO logs (msg) VALUES ('prefix -- note'); ALTER TABLE users DROP COLUMN email;",
    "INSERT INTO logs (msg) VALUES ('prefix /* note */'); TRUNCATE users;",
    String.raw`INSERT INTO logs (msg) VALUES (E'prefix \' -- note'); DROP TABLE users;`,
  ])("does not treat comment markers inside strings as comments", (sql) => {
    expect(findUnsafeStatements(sql)).toHaveLength(1);
  });

  it("does not let strings inside comments change lexical state", () => {
    const sql = `
      /* an unmatched ' quote inside a comment */
      ALTER TABLE users DROP COLUMN email;
    `;

    expect(findUnsafeStatements(sql)).toEqual([{ line: 3, operation: "DROP COLUMN" }]);
  });

  it("supports nested PostgreSQL block comments", () => {
    const sql = `
      /* outer /* DROP TABLE hidden */ still outer */
      TRUNCATE users;
    `;

    expect(findUnsafeStatements(sql)).toEqual([{ line: 3, operation: "TRUNCATE" }]);
  });

  it("accepts a NOT NULL column when a string default contains a comment marker", () => {
    const sql = "ALTER TABLE t ADD descr text DEFAULT 'foo -- bar' NOT NULL;";

    expect(findUnsafeStatements(sql)).toEqual([]);
  });

  it("fails closed on unterminated SQL lexical constructs", () => {
    expect(() => findUnsafeStatements("SELECT 'unterminated")).toThrow(
      "Unterminated SQL single quote",
    );
    expect(() => findUnsafeStatements("SELECT /* unterminated")).toThrow(
      "Unterminated SQL block comment",
    );
  });

  it("does not mistake ADD CONSTRAINT for an added column", () => {
    const sql = "ALTER TABLE users ADD CONSTRAINT email_present CHECK (email IS NOT NULL);";

    expect(findUnsafeStatements(sql)).toEqual([]);
  });

  it("allows an intentional cleanup linked to a tracking issue", () => {
    const sql = `
      -- migration-safety: allow-destructive issue=#123
      ALTER TABLE "users" DROP COLUMN "legacy";
    `;

    expect(findUnsafeStatements(sql)).toEqual([]);
  });

  it("does not accept an untracked exception", () => {
    const sql = `
      -- migration-safety: allow-destructive
      DROP TABLE "legacy";
    `;

    expect(findUnsafeStatements(sql)).toEqual([{ line: 3, operation: "DROP TABLE" }]);
  });
});

describe("timeout changes that were previously missed", () => {
  const session = (setting) => [{ line: 1, operation: `session-level ${setting} change (use SET LOCAL or set_config(..., true))` }];
  it.each([
    ['SET "lock_timeout" = 0;', "lock_timeout"],
    ['SET SESSION "statement_timeout" = 0;', "statement_timeout"],
    ["SELECT set_config(E'lock_timeout', '0', false);", "lock_timeout"],
    ["SELECT set_config($q$lock_timeout$q$, '0', false);", "lock_timeout"],
    ["SELECT set_config('lock_timeout', '0', 'off');", "lock_timeout"],
    ["SELECT set_config('lock_timeout', '0', 'no');", "lock_timeout"],
    ["SELECT set_config('statement_timeout', '0', false::boolean);", "statement_timeout"],
    ["SELECT set_config('statement_timeout', '0', (false));", "statement_timeout"],
    ["SELECT set_config('lock_timeout', '0', 0);", "lock_timeout"],
  ])("rejects a session-level change: %s", (sql, setting) => {
    expect(findUnsafeStatements(sql)).toEqual(session(setting));
  });

  it.each([
    "EXECUTE $q$SET lock_timeout = 0$q$;",
    "EXECUTE E'SET lock_timeout = 0';",
    "EXECUTE 'SET ' || 'lock_timeout' || ' = 0';",
    "EXECUTE format('SET %I = 0', 'lock_timeout');",
    "EXECUTE 'SET \"lock_timeout\" = 0';",
    "EXECUTE 'SET SESSION lock_timeout = 0';",
    "EXECUTE 'SET SESSION ' || 'lock_' || 'timeout=0';",
  ])("rejects a session-level change built inside EXECUTE: %s", (statement) => {
    expect(findUnsafeStatements(`DO $$ BEGIN ${statement} END $$;`)).toEqual(session("lock_timeout"));
  });

  it("rejects a SET statement that is assembled apart from the EXECUTE", () => {
    expect(findUnsafeStatements("DO $$ DECLARE v text := 'SET lock_timeout = 0'; BEGIN EXECUTE v; END $$;")).toEqual(
      session("lock_timeout"),
    );
  });

  it("rejects a set_config whose setting name is computed and is not transaction-local", () => {
    const [finding] = findUnsafeStatements("SELECT set_config('lock_' || 'timeout', '0', false);");
    expect(finding).toMatchObject({ line: 1 });
    expect(finding.operation).toContain("computed setting name");
  });

  it.each([
    ["ALTER ROLE app SET lock_timeout = '1s';", "lock_timeout"],
    ['ALTER ROLE app IN DATABASE "x" SET "statement_timeout" = 0;', "statement_timeout"],
    ["ALTER DATABASE x SET statement_timeout = 0;", "statement_timeout"],
    ["ALTER SYSTEM SET lock_timeout = 0;", "lock_timeout"],
  ])("rejects a persistent change: %s", (sql, setting) => {
    expect(findUnsafeStatements(sql)).toEqual([
      { line: 1, operation: `persistent ${setting} change (ALTER ROLE/DATABASE/SYSTEM SET)` },
    ]);
  });

  it("still tracks a quoted-identifier SET LOCAL until it is reset", () => {
    expect(findUnsafeStatements(`SET LOCAL "lock_timeout" = '5s'; SELECT 1;`)).toEqual([
      { line: 1, operation: "SET LOCAL lock_timeout without RESET" },
    ]);
    expect(findUnsafeStatements(`SET LOCAL "lock_timeout" = '5s'; RESET "lock_timeout";`)).toEqual([]);
  });

  it.each([
    "SELECT set_config('lock_timeout', '5s', true);",
    "SELECT set_config('lock_timeout', '5s', 'true');",
    "SELECT set_config('lock_timeout', '5s', 'on');",
    "SELECT set_config('statement_timeout', '5s', true::boolean);",
    "SELECT set_config('lock_timeout', '0', (true));",
    "SELECT set_config('app.current_user', 'x', false);",
    "DO $$ BEGIN EXECUTE 'SET LOCAL lock_timeout = ''5s'''; END $$;",
    "DO $$ BEGIN EXECUTE 'RESET lock_timeout'; END $$;",
    "DO $$ BEGIN RAISE NOTICE 'do not SET lock_timeout globally'; END $$;",
    "ALTER TABLE users ADD COLUMN note text; -- ALTER ROLE app SET lock_timeout = 0;",
  ])("still allows: %s", (sql) => {
    expect(findUnsafeStatements(sql)).toEqual([]);
  });
});

describe("migration journal check", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { spawnSync } = require("node:child_process");
  const { checkJournal } = require("./check-migration-safety");

  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "journal-"));
    fs.mkdirSync(path.join(dir, "meta"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  // `entries` are [tag, when]; idx follows position unless overridden.
  const write = (entries, { files = entries.map(([tag]) => tag), idxs } = {}) => {
    fs.writeFileSync(
      path.join(dir, "meta", "_journal.json"),
      JSON.stringify({ entries: entries.map(([tag, when], position) => ({ idx: idxs ? idxs[position] : position, tag, when })) }),
    );
    for (const tag of files) fs.writeFileSync(path.join(dir, `${tag}.sql`), "SELECT 1;\n");
  };
  const messages = () => checkJournal(dir).map((violation) => violation.operation);
  const series = (count, start = 0) =>
    Array.from({ length: count }, (_, i) => [`${String(start + i).padStart(4, "0")}_m${start + i}`, 1_000 + (start + i)]);

  it("accepts a contiguous, ordered journal that matches the files", () => {
    write(series(12));
    expect(messages()).toEqual([]);
  });

  it("grandfathers the historic out-of-order entry at idx 9 but not later ones", () => {
    const entries = series(12);
    entries[9][1] = 1; // idx 9 earlier than idx 8
    write(entries);
    expect(messages()).toEqual([]);

    entries[11][1] = 1_005; // idx 11 earlier than idx 10
    write(entries);
    expect(messages()).toEqual([expect.stringContaining("journal idx 11")]);
  });

  it("rejects a gap in idx (a migration numbered past the next free slot)", () => {
    const entries = series(12);
    write([...entries.slice(0, 11), ["0012_late", 5_000]], { idxs: [...Array(11).keys(), 12] });
    expect(messages()).toEqual(expect.arrayContaining([expect.stringContaining("idx 12 is at position 11")]));
  });

  it("rejects a migration added with a timestamp earlier than one already in the journal", () => {
    // Two PRs each added the next migration; the one merged second carries the earlier `when`.
    const entries = series(12);
    entries.push(["0012_first", 9_000], ["0013_second", 8_000]);
    write(entries);
    expect(messages()).toEqual([expect.stringContaining("journal idx 13 (0013_second)")]);
  });

  it("rejects two migrations that share a number", () => {
    write(series(12), { files: [...series(12).map(([tag]) => tag), "0011_other"] });
    expect(messages()).toEqual(
      expect.arrayContaining([expect.stringContaining("0011_other.sql has no journal entry"), expect.stringContaining("share the number 0011")]),
    );
  });

  it("rejects a journal entry whose file is missing", () => {
    const entries = series(12);
    write(entries, { files: entries.slice(0, 11).map(([tag]) => tag) });
    expect(messages()).toEqual([expect.stringContaining("journal entry 0011_m11 has no 0011_m11.sql file")]);
  });

  it("rejects a tag whose number does not match its idx", () => {
    const entries = series(12);
    entries[11][0] = "0040_wrong";
    write(entries);
    expect(messages()).toEqual(expect.arrayContaining([expect.stringContaining("does not start with its idx 0011_")]));
  });

  it("reports an unreadable journal instead of throwing", () => {
    fs.writeFileSync(path.join(dir, "meta", "_journal.json"), "{");
    expect(messages()).toEqual([expect.stringContaining("migration journal is unreadable")]);
  });

  it("checks the journal beside any migration passed on the command line", () => {
    const entries = series(12);
    write([...entries, ["0013_gap", 5_000]], { idxs: [...Array(12).keys(), 13] });
    const script = path.join(__dirname, "check-migration-safety.js");
    const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });

    const added = run(path.join(dir, "0013_gap.sql"));
    expect(added.status).toBe(1);
    expect(added.stderr).toContain("idx 13 is at position 12");

    const explicit = run("--journal", dir);
    expect(explicit.status).toBe(1);

    fs.rmSync(path.join(dir, "0013_gap.sql"));
    write(entries);
    expect(run(path.join(dir, "0011_m11.sql")).status).toBe(0);
    expect(run("--journal", dir).status).toBe(0);
  });
});
