/** @jest-environment node */

const { findUnsafeStatements } = require("./check-migration-safety");

describe("migration safety check", () => {
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
