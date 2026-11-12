const load = (env: Record<string, string>) => {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    let mod!: typeof import("./config");
    jest.isolateModules(() => { mod = require("./config"); });
    return { mod, warn };
  } finally {
    process.env = saved;
  }
};

describe("deletion config", () => {
  afterEach(() => jest.restoreAllMocks());

  it("uses defaults when unset", () => {
    const { mod, warn } = load({});
    expect([mod.MAX_ATTEMPTS, mod.GLOBAL_CONCURRENCY, mod.PURGE_BATCH, mod.BATCH_PAUSE_MS]).toEqual([8, 2, 500, 100]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("falls back with a warning instead of letting NaN disable a cap", () => {
    const { mod, warn } = load({
      DELETION_MAX_ATTEMPTS: "abc", DELETION_PURGE_CONCURRENCY: "NaN", DELETION_BATCH_SIZE: "abc", DELETION_BATCH_PAUSE_MS: "x", DELETION_MAX_TOTAL_STEPS: "abc",
    });
    expect([mod.MAX_ATTEMPTS, mod.GLOBAL_CONCURRENCY, mod.PURGE_BATCH, mod.BATCH_PAUSE_MS, mod.MAX_TOTAL_STEPS]).toEqual([8, 2, 500, 100, 100_000]);
    expect(warn).toHaveBeenCalledTimes(5);
  });

  it("rejects out-of-range values and accepts valid ones", () => {
    const { mod } = load({ DELETION_MAX_ATTEMPTS: "0", DELETION_PURGE_CONCURRENCY: "-3", DELETION_BATCH_SIZE: "5000", DELETION_BATCH_PAUSE_MS: "0" });
    expect([mod.MAX_ATTEMPTS, mod.GLOBAL_CONCURRENCY, mod.PURGE_BATCH, mod.BATCH_PAUSE_MS]).toEqual([8, 2, 500, 0]);
    const valid = load({ DELETION_MAX_ATTEMPTS: "3", DELETION_PURGE_CONCURRENCY: "4", DELETION_BATCH_SIZE: "1000" }).mod;
    expect([valid.MAX_ATTEMPTS, valid.GLOBAL_CONCURRENCY, valid.PURGE_BATCH]).toEqual([3, 4, 1000]);
    expect(load({ DELETION_BATCH_SIZE: "100" }).mod.PURGE_BATCH).toBe(100);
  });
});
