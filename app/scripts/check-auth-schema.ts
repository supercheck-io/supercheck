/**
 * Offline check that the Drizzle schema can hold everything Better Auth writes.
 *
 * Better Auth validates this on every request in every environment and fails
 * the request with a SchemaMismatchError when a table or column is missing.
 * jest mocks `better-auth` (jose is ESM-only), so this runs the real library
 * under tsx instead. It only introspects the Drizzle tables; it opens no
 * database connection.
 *
 * Run: npx tsx scripts/check-auth-schema.ts
 */
async function main(): Promise<void> {
  const { auth } = await import("../src/utils/auth");
  const context = await auth.$context;

  if (!context.explicitSchemaCheck) {
    throw new Error("Better Auth no longer exposes explicitSchemaCheck; update this script.");
  }
  await context.explicitSchemaCheck();
  console.log("Better Auth schema check passed");
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
    process.exit(1);
  },
);
