/** @jest-environment node */
const assert = require("node:assert/strict");
const { isIgnorableMigrationStatementError } = require("./migration-errors");

test("duplicate customer data aborts DML and constraint migrations", () => {
  for (const statement of [
    'INSERT INTO member VALUES (...)',
    'ALTER TABLE member ADD CONSTRAINT member_unique UNIQUE (user_id, organization_id)',
    'CREATE UNIQUE INDEX member_unique ON member(user_id, organization_id)',
  ]) {
    assert.equal(isIgnorableMigrationStatementError(statement, 'duplicate key value violates unique constraint "member_unique"'), false);
  }
});
test("existing schema objects and explicitly dropped missing objects remain replayable", () => {
  assert.equal(isIgnorableMigrationStatementError('CREATE TYPE role AS ENUM (...)', 'type "role" already exists'), true);
  assert.equal(isIgnorableMigrationStatementError('ALTER TABLE member DROP COLUMN legacy', 'column "legacy" does not exist'), true);
  assert.equal(isIgnorableMigrationStatementError('UPDATE missing SET x=1', 'relation "missing" does not exist'), false);
});
