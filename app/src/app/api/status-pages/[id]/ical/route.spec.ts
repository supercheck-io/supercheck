/** @jest-environment node */
const created = new Date("2030-01-01T10:00:00Z");
jest.mock("@/utils/db", () => ({
  db: {
    query: {
      statusPages: { findFirst: jest.fn(async () => ({ id: "p", name: "n", subdomain: "s", customDomain: null, customDomainVerified: false, status: "published", allowRssFeed: true, pageDescription: null })) },
      incidents: { findMany: jest.fn(async () => [{ id: "i", name: "Outage", impact: "major", status: "investigating", body: null, createdAt: created, resolvedAt: null, scheduledFor: null, scheduledUntil: null, affectedComponents: [] }]) },
    },
  },
}));
import { GET } from "./route";

const call = async () => {
  const res = await GET({} as never, { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) });
  expect(res.status).toBe(200);
  return (await res.text()).match(/DTEND:(\S+)/)?.[1];
};

it("keeps DTEND stable for an open incident", async () => {
  jest.useFakeTimers().setSystemTime(new Date("2030-01-01T11:00:00Z"));
  const first = await call();
  expect(first).toBe("20300101T110000Z");
  jest.setSystemTime(new Date("2030-01-01T12:30:00Z"));
  expect(await call()).toBe(first);
  jest.useRealTimers();
});

it("escapes bare carriage returns so incident text cannot start a new iCal line", async () => {
  const { db } = jest.requireMock("@/utils/db");
  db.query.incidents.findMany.mockResolvedValueOnce([{ id: "i", name: "x\rEND:VEVENT\rBEGIN:VEVENT", impact: "major", status: "investigating", body: "a\r\nb", createdAt: created, resolvedAt: null, scheduledFor: null, scheduledUntil: null, affectedComponents: [] }]);
  const res = await GET({} as never, { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) });
  const text = await res.text();
  expect(text.split("\r\n").some((line) => line.includes("\r"))).toBe(false);
  expect(text).toContain("x\\nEND:VEVENT\\nBEGIN:VEVENT");
});

describe("maintenance resolved before its planned end", () => {
  const event = async (resolvedAt: Date) => {
    const { db } = jest.requireMock("@/utils/db");
    db.query.incidents.findMany.mockResolvedValueOnce([{ id: "m", name: "Upgrade", impact: "none", status: "resolved", body: null, createdAt: created, resolvedAt, scheduledFor: new Date("2030-01-02T02:00:00Z"), scheduledUntil: new Date("2030-01-02T04:00:00Z"), affectedComponents: [] }]);
    const res = await GET({} as never, { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) });
    const text = await res.text();
    return { end: text.match(/DTEND:(\S+)/)?.[1], status: text.match(/STATUS:(\S+)/)?.[1] };
  };

  it("ends at the resolution when it finished early", async () => {
    expect(await event(new Date("2030-01-02T03:00:00Z"))).toEqual({ end: "20300102T030000Z", status: "CONFIRMED" });
  });

  it("is cancelled, with a valid end, when resolved before it began", async () => {
    expect(await event(new Date("2030-01-01T12:00:00Z"))).toEqual({ end: "20300102T040000Z", status: "CANCELLED" });
  });
});
