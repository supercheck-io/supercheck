/** @jest-environment node */
import { NextRequest } from "next/server";

const mockFindFirst = jest.fn();
const mockSelects: unknown[][] = [];
const mockWheres: unknown[] = [];
const mockStale = jest.fn(async (_ids: string[]): Promise<Set<string>> => new Set());
jest.mock("@/lib/status-pages/component-freshness", () => ({
  loadStaleComponentIds: (ids: string[]) => mockStale(ids),
}));
jest.mock("@/utils/db", () => ({
  db: {
    query: { statusPages: { findFirst: (...a: unknown[]) => mockFindFirst(...a) } },
    select: () => {
      const rows = mockSelects.shift() ?? [];
      const chain: Record<string, unknown> = {
        from: () => chain,
        where: (cond: unknown) => (mockWheres.push(cond), chain),
        limit: () => Promise.resolve(rows),
        then: (res: (v: unknown) => unknown) => Promise.resolve(rows).then(res),
      };
      return chain;
    },
  },
}));

import { PgDialect } from "drizzle-orm/pg-core";
import { GET } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";
const call = async () => {
  const res = await GET(new NextRequest(`http://x/api/status-pages/${ID}/badge`), {
    params: Promise.resolve({ id: ID }),
  });
  return res.text();
};

beforeEach(() => {
  mockSelects.length = 0;
  mockWheres.length = 0;
  mockFindFirst.mockResolvedValue({ id: ID, name: "p", cssGreens: "#0f0" });
});

describe("status badge", () => {
  it("shows operational with the custom colour expanded from #rgb", async () => {
    mockSelects.push([{ status: "operational" }], []);
    const svg = await call();
    expect(svg).toContain("operational");
    expect(svg).toContain('fill="#00ff00"');
  });

  it.each([
    ["critical", "major outage"],
    ["major", "partial outage"],
    ["minor", "degraded"],
  ])("maps an open %s incident like the public banner (%s)", async (impact, message) => {
    mockSelects.push([{ status: "operational" }], [{ impact }]);
    expect(await call()).toContain(message);
  });

  it("takes the worst impact across open incidents", async () => {
    mockSelects.push([{ status: "operational" }], [{ impact: "minor" }, { impact: "critical" }, { impact: "none" }]);
    expect(await call()).toContain("major outage");
  });

  it("an impact of none does not change the badge", async () => {
    mockSelects.push([{ status: "operational" }], [{ impact: "none" }]);
    expect(await call()).toContain("operational");
  });

  it("a critical incident outranks a degraded component", async () => {
    mockSelects.push([{ status: "degraded_performance" }], [{ impact: "critical" }]);
    expect(await call()).toContain("major outage");
  });

  it("ignores components whose monitors stopped reporting, like the public page", async () => {
    mockStale.mockResolvedValueOnce(new Set(["stale"]));
    mockSelects.push([{ id: "stale", status: "major_outage" }, { id: "live", status: "operational" }], []);
    expect(await call()).toContain("operational");
    expect(mockStale).toHaveBeenLastCalledWith(["stale", "live"]);
  });

  it("keeps a live outage when another component is stale", async () => {
    mockStale.mockResolvedValueOnce(new Set(["stale"]));
    mockSelects.push([{ id: "stale", status: "operational" }, { id: "live", status: "major_outage" }], []);
    expect(await call()).toContain("major outage");
  });

  it("filters incidents to this page, open statuses and non-maintenance", async () => {
    mockSelects.push([{ status: "operational" }], []);
    await call();
    const { sql, params } = new PgDialect().sqlToQuery(mockWheres[mockWheres.length - 1] as never);
    expect(sql).toBe(
      '("incidents"."status_page_id" = $1 and "incidents"."status" in ($2, $3, $4) and ("incidents"."scheduled_for" is null or "incidents"."scheduled_until" is null))'
    );
    expect(params).toEqual([ID, "investigating", "identified", "monitoring"]);
    expect(sql).not.toMatch(/\bnot\b/);
  });
});
