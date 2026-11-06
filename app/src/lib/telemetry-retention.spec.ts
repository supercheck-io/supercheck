import {
  TELEMETRY_RETENTION_RULES,
  buildPurgeBatchSql,
  resolveBatchSize,
  resolveSafetyLimit,
  purgeTelemetryTable,
  resolveRetentionDays,
} from "./telemetry-retention";

const rule = TELEMETRY_RETENTION_RULES[0];

describe("telemetry retention config", () => {
  it("uses the default for missing or invalid values and honours valid ones", () => {
    expect(resolveRetentionDays(rule, {})).toBe(rule.defaultDays);
    for (const bad of ["", "0", "-3", "1.5", "abc", "99999"])
      expect(resolveRetentionDays(rule, { [rule.envVar]: bad })).toBe(rule.defaultDays);
    expect(resolveRetentionDays(rule, { [rule.envVar]: "14" })).toBe(14);
  });

  it("rejects non-integer inputs in SQL building", () => {
    expect(() => buildPurgeBatchSql(rule, 7, 0)).toThrow();
    expect(() => buildPurgeBatchSql(rule, Number("1; DROP"), 10)).toThrow();
  });

  it("clamps batch size and safety limit", () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveBatchSize("50")).toBe(50);
    for (const bad of ["0", "-1", "abc", "10001"]) expect(resolveBatchSize(bad)).toBe(1000);
    expect(resolveSafetyLimit("5")).toBe(5);
    for (const bad of ["0", "-5", "x"]) expect(resolveSafetyLimit(bad)).toBe(200000);
  });

  it("pages by keyset and stops at the cap", async () => {
    const sqls: string[] = [];
    const run = jest.fn(async (s: string) => {
      sqls.push(s);
      const n = Number(/LIMIT (\d+) FOR/.exec(s)?.[1]);
      return [{ picked: n, deleted: n, last_time: "2020-01-01 00:00:00", last_id: "00000000-0000-0000-0000-00000000000" + sqls.length }];
    });
    const total = await purgeTelemetryTable(run, { ...rule, minSafetyLimit: undefined }, { days: 7, batchSize: 100, maxRecords: 250 });
    expect(total).toBe(250);
    expect(sqls.map((s) => /LIMIT (\d+) FOR/.exec(s)?.[1])).toEqual(["100", "100", "50"]);
    expect(sqls[0]).not.toContain("> ('");
    expect(sqls[1]).toContain("> ('2020-01-01 00:00:00'::timestamptz");
    expect(sqls[0]).toContain("FOR UPDATE SKIP LOCKED");
  });

  it("applies a per-rule floor to the safety limit", async () => {
    const run = jest.fn(async () => [{ picked: 1, deleted: 1, last_time: "2020-01-01", last_id: "00000000-0000-0000-0000-000000000001" }]);
    const small = { ...rule, minSafetyLimit: 3 };
    expect(await purgeTelemetryTable(run, small, { days: 7, batchSize: 1, maxRecords: 1 })).toBe(3);
  });
});

describe("private_agent_jobs retention", () => {
  it("only purges finished jobs and keeps each connector's newest", () => {
    const jobs = TELEMETRY_RETENTION_RULES.find((r) => r.table === "private_agent_jobs")!;
    const sql = buildPurgeBatchSql(jobs, resolveRetentionDays(jobs, {}), 100);
    expect(sql).toContain("status IN ('completed', 'failed', 'cancelled', 'timed_out')");
    expect(sql).not.toMatch(/'(queued|leased|running)'/);
    expect(sql).toContain("n.connector_id =");
  });
});
