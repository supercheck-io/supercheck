/** @jest-environment node */
import { NextRequest } from "next/server";

const mockFindFirst = jest.fn();
const mockSelects: unknown[][] = [];
const mockWheres: unknown[] = [];
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

  it("reflects an open incident when components look operational", async () => {
    mockSelects.push([{ status: "operational" }], [{ id: "i1" }]);
    expect(await call()).toContain("incident");
  });

  it("component outages take precedence over the incident lookup", async () => {
    mockSelects.push([{ status: "major_outage" }]);
    expect(await call()).toContain("major outage");
  });

  it("does not count a maintenance window as an incident", async () => {
    mockSelects.push([{ status: "operational" }], []);
    await call();
    const { sql } = new PgDialect().sqlToQuery(mockWheres[mockWheres.length - 1] as never);
    expect(sql).toMatch(/"scheduled_for" is null or "incidents"."scheduled_until" is null|"scheduled_for" is null or .*"scheduled_until" is null/);
  });
});
