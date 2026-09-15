/** @jest-environment node */
const assert = require("node:assert/strict");
const { getDatabaseSSLConfig } = require("./db-ssl");
test("scripts verify certificates in cloud and preserve local self-hosting", () => {
  const original = process.env.SELF_HOSTED;
  try {
    delete process.env.SELF_HOSTED;
    assert.equal(getDatabaseSSLConfig(), "verify-full");
    for (const value of ["false", "0", "invalid"]) {
      process.env.SELF_HOSTED = value;
      assert.equal(getDatabaseSSLConfig(), "verify-full");
    }
    for (const value of ["true", "TRUE", "1", " true "]) {
      process.env.SELF_HOSTED = value;
      assert.equal(getDatabaseSSLConfig(), undefined);
    }
  } finally {
    if (original === undefined) delete process.env.SELF_HOSTED;
    else process.env.SELF_HOSTED = original;
  }
});
