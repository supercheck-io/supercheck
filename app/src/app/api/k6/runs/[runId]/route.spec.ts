/** @jest-environment node */
const mockLimit = jest.fn();
const mockWhereCalls: unknown[] = [];
jest.mock("@/utils/db", () => {
  const chain = { from: () => chain, leftJoin: () => chain, where: (c: unknown) => { mockWhereCalls.push(c); return chain; }, limit: (...args: unknown[]) => mockLimit(...args) };
  return { db: { select: () => chain } };
});
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn(async () => ({ userId: "u1", organizationId: "org-1", project: { id: "p1" } })),
  isAuthError: () => false,
  authErrorStatus: () => 401,
}));
jest.mock("drizzle-orm", () => ({
  ...jest.requireActual("drizzle-orm"),
  eq: (_column: unknown, value: unknown) => ({ eq: value }),
  and: (...conditions: unknown[]) => ({ and: conditions }),
}));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn(() => true) }));

import { GET } from "./route";

const runId = "0c11ab1e-7460-5139-b3b8-920f69f95082";
const get = () => GET(new Request(`http://localhost/api/k6/runs/${runId}`), { params: Promise.resolve({ runId }) });

it("returns app routes instead of the stored storage URLs", async () => {
  mockLimit.mockResolvedValue([{
    runId,
    reportS3Url: "http://rustfs:9000/b/report.html",
    summaryS3Url: "http://rustfs:9000/b/summary.json",
    consoleS3Url: null,
    runReportUrl: "http://rustfs:9000/b/index.html",
    runLogsUrl: "http://rustfs:9000/b/console.log",
  }]);
  const body = await (await get()).json();
  expect(JSON.stringify(body)).not.toContain("rustfs");
  expect(body).toMatchObject({
    reportS3Url: `/api/test-results/${runId}/report/report.html`,
    summaryS3Url: `/api/test-results/${runId}/summary.json`,
    consoleS3Url: null,
    runReportUrl: `/api/test-results/${runId}/report/report.html`,
    runLogsUrl: `/api/test-results/${runId}/console.log`,
  });
});

it("is 404 when the run is not in the caller's project, and scopes the lookup to project and organization", async () => {
  mockLimit.mockResolvedValue([]);
  expect((await get()).status).toBe(404);
  const values = JSON.stringify(mockWhereCalls.at(-1));
  expect(values).toContain('"p1"');
  expect(values).toContain('"org-1"');
  expect(values).toContain(runId);
});
