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
