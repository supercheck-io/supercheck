import {
  TELEMETRY_RETENTION_RULES,
  buildPurgeBatchSql,
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

  it("deletes in batches and stops at the safety limit", async () => {
    const sizes: number[] = [];
    const run = jest.fn(async (s: string) => {
      sizes.push(Number(/LIMIT (\d+)\)$/.exec(s)?.[1]));
      return sizes[sizes.length - 1];
    });
    const total = await purgeTelemetryTable(run, rule, { days: 7, batchSize: 100, maxRecords: 250 });
    expect(sizes).toEqual([100, 100, 50]);
    expect(total).toBe(250);
  });
});
