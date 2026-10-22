const {
  acquireMigrationLock,
  releaseMigrationLock,
  withMigrationTimeouts,
} = require("./migration-lock.js");

function createFakePostgres(acquiredResults) {
  const queries = [];
  const client = (strings, ...values) => {
    const query = strings.reduce(
      (result, string, index) =>
        `${result}${string}${values[index] === undefined ? "" : values[index]}`,
      "",
    );
    queries.push(query.trim());

    if (query.includes("pg_try_advisory_xact_lock")) {
      return Promise.resolve([{ acquired: acquiredResults.shift() }]);
    }

    return Promise.resolve([]);
  };

  client.end = jest.fn(() => Promise.resolve());

  return { client, queries };
}

describe("migration advisory lock", () => {
  it("restores incoming timeouts before the next migration or seed", async () => {
    const client = jest.fn()
      .mockResolvedValueOnce([{ lock_timeout: "9s", statement_timeout: "2min" }])
      .mockResolvedValue([]);
    const migrate = jest.fn(async () => "applied");
    await expect(withMigrationTimeouts(client, migrate)).resolves.toBe("applied");
    expect(migrate).toHaveBeenCalledTimes(1);
    expect(client.mock.calls[1].slice(1)).toEqual(["9s", "2min"]);
  });

  it("preserves the migration error for transaction rollback", async () => {
    const client = jest.fn().mockResolvedValue([{ lock_timeout: "0", statement_timeout: "0" }]);
    const failure = new Error("migration failed");
    await expect(withMigrationTimeouts(client, async () => { throw failure; })).rejects.toBe(failure);
    expect(client).toHaveBeenCalledTimes(1);
  });
  it("keeps the transaction open while waiting, then commits cleanly", async () => {
    const fake = createFakePostgres([false, true]);
    const postgres = jest.fn(() => fake.client);
    const logSuccess = jest.fn();

    const lock = await acquireMigrationLock(postgres, "postgres://db", {
      timeoutMs: 100,
      retryDelayMs: 0,
      logSuccess,
    });

    expect(lock).toBe(fake.client);
    expect(fake.queries[0]).toBe("BEGIN");
    expect(fake.queries).toHaveLength(3);
    expect(logSuccess).toHaveBeenCalledWith(
      "Database migration advisory lock acquired",
    );

    await releaseMigrationLock(lock, { commit: true, logSuccess });

    expect(fake.queries.at(-1)).toBe("COMMIT");
    expect(fake.client.end).toHaveBeenCalledTimes(1);
    expect(logSuccess).toHaveBeenCalledWith(
      "Database migration transaction committed",
    );
    expect(fake.queries.join(" ")).not.toContain("pg_advisory_unlock");
  });

  it("rolls back and fails closed when the lock timeout expires", async () => {
    const fake = createFakePostgres([false]);
    const logError = jest.fn();

    const lock = await acquireMigrationLock(
      jest.fn(() => fake.client),
      "postgres://db",
      { timeoutMs: 1, retryDelayMs: 0, logError },
    );

    expect(lock).toBeNull();
    expect(fake.queries[0]).toBe("BEGIN");
    expect(fake.queries.at(-1)).toBe("ROLLBACK");
    expect(fake.client.end).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith(
      "Timed out waiting for the database migration advisory lock after 1ms",
    );
  });

  it("rolls back by default when the migration sequence does not complete", async () => {
    const fake = createFakePostgres([true]);
    const logSuccess = jest.fn();
    const lock = await acquireMigrationLock(
      jest.fn(() => fake.client),
      "postgres://db",
      { timeoutMs: 100, retryDelayMs: 0 },
    );

    await releaseMigrationLock(lock, { logSuccess });

    expect(fake.queries.at(-1)).toBe("ROLLBACK");
    expect(fake.queries).not.toContain("COMMIT");
    expect(logSuccess).toHaveBeenCalledWith(
      "Database migration transaction rolled back",
    );
  });
});
