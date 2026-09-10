// Migration and seed connections use the same TLS posture as app/worker.
function getDatabaseSSLConfig() {
  const selfHosted = ["true", "1"].includes(process.env.SELF_HOSTED?.trim().toLowerCase() ?? "");
  return selfHosted ? undefined : "verify-full";
}
module.exports = { getDatabaseSSLConfig };
