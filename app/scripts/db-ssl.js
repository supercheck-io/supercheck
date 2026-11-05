// Migration and seed connections use the same TLS posture as app/worker (worker/src/db/db-ssl.ts).
// postgres.js ignores ?sslmode= when an ssl option is passed, so it is read here instead.
function readSslMode() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) return undefined;
  try {
    const url = new URL(connectionString.replace(/^postgres(ql)?:/i, "http:"));
    return url.searchParams.get("sslmode")?.trim().toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}

function getDatabaseSSLConfig() {
  const sslMode = readSslMode();
  if (sslMode === "disable") return undefined;
  // postgres.js reads an explicit ssl option instead of ?sslmode=, so keep opportunistic TLS here.
  if (["allow", "prefer"].includes(sslMode)) return "prefer";
  // verify-ca is verified as verify-full: postgres.js has no CA-only mode.
  if (["require", "verify-ca", "verify-full"].includes(sslMode)) return "verify-full";
  const selfHosted = ["true", "1"].includes(process.env.SELF_HOSTED?.trim().toLowerCase() ?? "");
  return selfHosted ? undefined : "verify-full";
}
module.exports = { getDatabaseSSLConfig };
