/**
 * Validate constraints that migrations added NOT VALID.
 *
 * Runs after the migration transaction has committed. Each constraint gets its own short transaction:
 * VALIDATE CONSTRAINT takes SHARE UPDATE EXCLUSIVE, which does not block reads or writes, and a short
 * lock_timeout keeps it from queueing behind a long transaction. A constraint that cannot be validated
 * (existing violating rows, lock timeout) stays NOT VALID and is logged; this never fails the deploy.
 */
async function validatePendingConstraints(
  client,
  { lockTimeout = "5s", log = () => undefined, logWarning = () => undefined } = {},
) {
  const pending = await client`
    SELECT conrelid::regclass::text AS table_name, quote_ident(conname) AS constraint_name, conname
    FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace AND NOT convalidated
    ORDER BY 1, 2
  `;
  const result = { validated: [], left: [] };
  for (const { table_name: table, constraint_name: quoted, conname: name } of pending) {
    try {
      await client.begin(async (tx) => {
        await tx`SELECT set_config('lock_timeout', ${lockTimeout}, true), set_config('search_path', 'public', true)`;
        await tx.unsafe(`ALTER TABLE ${table} VALIDATE CONSTRAINT ${quoted}`);
      });
      result.validated.push(name);
      log(`Validated constraint ${name}`);
    } catch (error) {
      result.left.push(name);
      logWarning(`Constraint ${name} left NOT VALID: ${error.message}`);
    }
  }
  return result;
}

module.exports = { validatePendingConstraints };
