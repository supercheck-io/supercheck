/** @jest-environment node */
import { PgDialect } from "drizzle-orm/pg-core";

const ORG = "018f0000-0000-7000-8000-00000000000a";
const PROJECT = "018f0000-0000-7000-8000-00000000000b";
const CURRENT = "018f0000-0000-7000-8000-0000000000c1";
const SERVICE = "018f0000-0000-7000-8000-0000000000e1";

// Each select() consumes the next queued result and records its where() clause.
const queue: unknown[][] = [];
const whereClauses: unknown[] = [];
function chain(result: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const name of ["from", "innerJoin", "leftJoin", "orderBy"]) c[name] = () => c;
  c.where = (clause: unknown) => {
    whereClauses.push(clause);
    return c;
  };
  c.limit = () => Promise.resolve(result);
  c.then = (resolve: (value: unknown[]) => unknown) => Promise.resolve(result).then(resolve);
  return c;
}
jest.mock("@/utils/db", () => ({
  db: {
    select: () => chain(queue.shift() ?? []),
    selectDistinct: () => chain(queue.shift() ?? []),
  },
}));

import { findSimilarIncidents, scoreCandidate, similarIncidentPromptLines, tokenizeTitle } from "./similar-incidents";

const dialect = new PgDialect();
const render = (clause: unknown) => dialect.sqlToQuery(clause as never);

beforeEach(() => {
  queue.length = 0;
  whereClauses.length = 0;
});

describe("tokenizeTitle", () => {
  it("drops stopwords, short and numeric tokens and dedupes", () => {
    expect(tokenizeTitle("Checkout API error 500 - checkout latency high")).toEqual(["checkout", "api", "latency"]);
  });
});

describe("scoreCandidate", () => {
  const ctx = { serviceId: SERVICE, tokens: ["checkout", "latency"], signatureIds: new Set(["sig"]) };
  it("adds service, alert and title signals", () => {
    const all = scoreCandidate({ id: "sig", title: "Checkout latency", resolvedAt: null, primaryServiceId: SERVICE }, ctx);
    expect(all.matchedOn).toEqual(["service", "alert", "title"]);
    expect(all.score).toBe(3 + 3 + 2);
    expect(scoreCandidate({ id: "x", title: "Billing outage", resolvedAt: null, primaryServiceId: "other" }, ctx).score).toBe(0);
  });
});

describe("findSimilarIncidents", () => {
  it("returns nothing when the incident is not in the caller's tenancy", async () => {
    queue.push([]);
    await expect(findSimilarIncidents({ organizationId: ORG, projectId: PROJECT, incidentId: CURRENT })).resolves.toEqual([]);
    const sql = render(whereClauses[0]);
    expect(sql.params).toEqual(expect.arrayContaining([CURRENT, ORG, PROJECT]));
  });

  it("scopes every query by organization and project, resolved status and the 180 day window", async () => {
    queue.push([{ title: "Checkout latency spike", primaryServiceId: SERVICE }]);
    queue.push([{ sourceId: "mon-1", dedupKey: null }]);
    queue.push([{ incidentId: "018f0000-0000-7000-8000-0000000000c2" }]);
    queue.push([
      {
        id: "018f0000-0000-7000-8000-0000000000c2",
        incidentNumber: 7,
        title: "Checkout latency earlier",
        severity: "sev2",
        primaryServiceId: SERVICE,
        serviceName: "checkout",
        resolvedAt: new Date("2026-09-01"),
        rootCauseSummary: "x".repeat(500),
        resolutionSummary: "rolled back",
      },
      {
        id: "018f0000-0000-7000-8000-0000000000c3",
        incidentNumber: 8,
        title: "Unrelated",
        severity: "sev3",
        primaryServiceId: null,
        serviceName: null,
        resolvedAt: new Date("2026-09-02"),
        rootCauseSummary: null,
        resolutionSummary: null,
      },
    ]);

    const result = await findSimilarIncidents({ organizationId: ORG, projectId: PROJECT, incidentId: CURRENT });

    expect(result).toHaveLength(1);
    expect(result[0].matchedOn).toEqual(["service", "alert", "title"]);
    expect(result[0].rootCauseSummary?.length).toBeLessThanOrEqual(300);
    // where[0]=current incident, [1]=alerts, [2]=signature matches, [3]=candidates
    for (const clause of whereClauses.slice(0, 4)) {
      expect(render(clause).params).toEqual(expect.arrayContaining([ORG, PROJECT]));
    }
    const candidateSql = render(whereClauses[3]);
    expect(candidateSql.params).toEqual(expect.arrayContaining(["resolved", CURRENT]));
    expect(candidateSql.sql).toContain("ILIKE");
    expect(candidateSql.sql).toContain('"resolved_at" >=');
  });

  it("formats bounded prompt lines", () => {
    const lines = similarIncidentPromptLines([
      {
        id: "a", incidentNumber: 1, title: "T", severity: "sev1", serviceName: "svc", resolvedAt: null,
        rootCauseSummary: "cause", resolutionSummary: null, matchedOn: ["service"], score: 3,
      },
    ]);
    expect(lines[0]).toBe('#1 "T"; service=svc; matched=service; root cause: cause');
  });
});
