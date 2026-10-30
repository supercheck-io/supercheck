/** @jest-environment node */
const assert = require("node:assert/strict");
const { getDatabaseSSLConfig } = require("./db-ssl");

function withEnv(env, fn) {
  const original = { SELF_HOSTED: process.env.SELF_HOSTED, DATABASE_URL: process.env.DATABASE_URL };
  try {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fn();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("scripts verify certificates in cloud and preserve local self-hosting", () => {
  withEnv({ SELF_HOSTED: undefined, DATABASE_URL: undefined }, () => {
    assert.equal(getDatabaseSSLConfig(), "verify-full");
    for (const value of ["false", "0", "invalid"]) {
      process.env.SELF_HOSTED = value;
      assert.equal(getDatabaseSSLConfig(), "verify-full");
    }
    for (const value of ["true", "TRUE", "1", " true "]) {
      process.env.SELF_HOSTED = value;
      assert.equal(getDatabaseSSLConfig(), undefined);
    }
  });
});

test("sslmode in DATABASE_URL overrides the hosting-mode default", () => {
  const base = "postgresql://user:pass@db.example.com:5432/supercheck";
  for (const mode of ["require", "verify-ca", "verify-full", "REQUIRE"]) {
    withEnv({ SELF_HOSTED: "true", DATABASE_URL: `${base}?sslmode=${mode}` }, () => {
      assert.equal(getDatabaseSSLConfig(), "verify-full");
    });
  }
  withEnv({ SELF_HOSTED: "false", DATABASE_URL: "postgres://user:pass@db/supercheck?sslmode=disable" }, () => {
    assert.equal(getDatabaseSSLConfig(), undefined);
  });
  for (const mode of ["allow", "prefer"]) {
    withEnv({ SELF_HOSTED: "false", DATABASE_URL: `postgres://user:pass@db/supercheck?sslmode=${mode}` }, () => {
      assert.equal(getDatabaseSSLConfig(), "prefer");
    });
  }
  for (const url of [base, `${base}?sslmode=`, "not a url"]) {
    withEnv({ SELF_HOSTED: "true", DATABASE_URL: url }, () => {
      assert.equal(getDatabaseSSLConfig(), undefined);
    });
  }
});
