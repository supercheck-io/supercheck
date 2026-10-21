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
  const { isMcpServerEnabled } = await import("../src/lib/mcp/config");
  const context = await auth.$context;

  if (!context.explicitSchemaCheck) {
    throw new Error("Better Auth no longer exposes explicitSchemaCheck; update this script.");
  }
  await context.explicitSchemaCheck();

  // The check only proves the tables we declared can hold what the registered plugins write.
  // A plugin dropped from the config would pass it silently, so require the ones the app relies on.
  const registered = new Set((auth.options.plugins ?? []).map((plugin) => plugin.id));
  const required = ["admin", "organization", "api-key"];
  if (isMcpServerEnabled()) {
    // jwt signs the access tokens, oauth-provider is mcp() (it registers under the provider's id), and
    // cimd accepts Client ID Metadata Documents. Without them the OAuth tables would go unchecked.
    required.push("jwt", "oauth-provider", "cimd");
  }
  const missing = required.filter((id) => !registered.has(id));
  if (missing.length) {
    throw new Error(`Better Auth plugins missing from the app configuration: ${missing.join(", ")}`);
  }

  console.log("Better Auth schema check passed");
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
    process.exit(1);
  },
);
