/** @jest-environment node */
import { assertReadOnlyNrql, newRelicGraphqlUrl, nrqlStatisticsError, prepareNrql, searchNewRelic, validateNewRelic } from "./newrelic";
import { makeContext, mockHttp, params, WINDOW } from "./provider-test-utils";

const cred = { apiKey: "NRAK-secret", accountId: "1234567" };
const ok = (results: unknown[]) => ({ json: { data: { actor: { account: { nrql: { results } } } } } });

describe("new relic provider", () => {
  it("rejects non-NRQL, multi-statement and out-of-window queries", () => {
    expect(() => assertReadOnlyNrql("DROP TABLE x")).toThrow(/NRQL/);
    expect(() => assertReadOnlyNrql("SELECT 1 FROM Log; SELECT 2")).toThrow(/single statement/);
    expect(() => assertReadOnlyNrql("SELECT count(*) FROM Log COMPARE WITH 1 week ago")).toThrow(/COMPARE WITH/);
    expect(() => assertReadOnlyNrql("")).toThrow(/empty/);
    expect(() => assertReadOnlyNrql("FROM Log SELECT message")).not.toThrow();
  });

  it("replaces user SINCE/UNTIL with the investigation window and adds a limit", () => {
    const nrql = prepareNrql("SELECT count(*) FROM Transaction SINCE 3 days ago UNTIL now", WINDOW, 10);
    expect(nrql).toBe("SELECT count(*) FROM Transaction LIMIT 10 SINCE '2026-10-27T11:00:00+0000' UNTIL '2026-10-27T12:00:00+0000'");
    expect(prepareNrql("SELECT message FROM Log LIMIT 5 since '2020-01-01'", WINDOW, 10)).toBe("SELECT message FROM Log LIMIT 5 SINCE '2026-10-27T11:00:00+0000' UNTIL '2026-10-27T12:00:00+0000'");
  });

  it("requires aggregation for statistics", () => {
    expect(nrqlStatisticsError("SELECT message FROM Log")).toMatch(/aggregation/);
    expect(nrqlStatisticsError("SELECT count(*) FROM Log")).toBeNull();
  });

  it("selects the US or EU endpoint", () => {
    expect(newRelicGraphqlUrl({})).toBe("https://api.newrelic.com/graphql");
    expect(newRelicGraphqlUrl({ region: "EU" })).toBe("https://api.eu.newrelic.com/graphql");
  });

  it("sends the NerdGraph request with API-Key auth and a bound variable", async () => {
    const { http, calls } = mockHttp([ok([{ message: "boom error", timestamp: Date.parse("2026-10-27T11:10:00Z"), level: "ERROR" }])]);
    const result = await searchNewRelic(makeContext(http, { ...cred, region: "eu" }), params("SELECT message FROM Log WHERE level = 'ERROR'"));
    expect(calls[0].url).toBe("https://api.eu.newrelic.com/graphql");
    expect(calls[0].target).toBe("vendor");
    expect(calls[0].headers["API-Key"]).toBe("NRAK-secret");
    const body = JSON.parse(calls[0].body as string);
    expect(body.query).toContain("account(id: 1234567)");
    expect(body.query).toContain("timeout: 10");
    expect(body.variables.nrql).toContain("SINCE '2026-10-27T11:00:00+0000'");
    expect(body.query).not.toContain("SELECT");
    expect(result.records[0]).toMatchObject({ evidenceType: "log", severity: "error", observedAt: "2026-10-27T11:10:00.000Z" });
    expect(result.records[0].sourceUri).toContain("one.eu.newrelic.com");
  });

  it("truncates results to the row budget", async () => {
    const { http } = mockHttp([ok(Array.from({ length: 5 }, (_, i) => ({ "count": i })))]);
    const result = await searchNewRelic(makeContext(http, cred), params("SELECT count(*) FROM Transaction", { maxRows: 2 }));
    expect(result.records).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(result.records[0].evidenceType).toBe("metric");
  });

  it("maps GraphQL auth and query errors", async () => {
    const authFail = { json: { errors: [{ message: "Not authorized" }] } };
    await expect(searchNewRelic(makeContext(mockHttp([authFail]).http, cred), params("SELECT 1 FROM Log"))).rejects.toThrow(/credentials rejected/);
    const bad = { json: { errors: [{ message: "Syntax error near FROM" }] } };
    await expect(searchNewRelic(makeContext(mockHttp([bad]).http, cred), params("SELECT 1 FROM Log"))).rejects.toThrow(/rejected the query: Syntax error/);
    await expect(searchNewRelic(makeContext(mockHttp([{ status: 401 }]).http, cred), params("SELECT 1 FROM Log"))).rejects.toThrow(/HTTP 401/);
  });

  it("validates credentials and account access", async () => {
    await expect(validateNewRelic(makeContext(mockHttp([{}]).http, { apiKey: "k" }))).rejects.toThrow(/account ID/);
    await expect(validateNewRelic(makeContext(mockHttp([{}]).http, { accountId: "1" }))).rejects.toThrow(/User API key/);
    await expect(validateNewRelic(makeContext(mockHttp([{ json: { data: { actor: { account: null } } } }]).http, cred))).rejects.toThrow(/cannot read/);
    await expect(validateNewRelic(makeContext(mockHttp([{ json: { data: { actor: { account: { name: "A" } } } } }]).http, cred))).resolves.toBeUndefined();
  });
});
