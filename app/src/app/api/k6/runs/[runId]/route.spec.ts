/** @jest-environment node */
const mockLimit = jest.fn();
jest.mock("@/utils/db", () => {
  const chain = { from: () => chain, leftJoin: () => chain, where: () => chain, limit: (...args: unknown[]) => mockLimit(...args) };
  return { db: { select: () => chain } };
});
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn(async () => ({ userId: "u1", organizationId: "org-1", project: { id: "p1" } })),
  isAuthError: () => false,
  authErrorStatus: () => 401,
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
    runLogsUrl: null,
  }]);
  const body = await (await get()).json();
  expect(JSON.stringify(body)).not.toContain("rustfs");
  expect(body).toMatchObject({
    reportS3Url: `/api/test-results/${runId}/report/report.html`,
    summaryS3Url: `/api/test-results/${runId}/summary.json`,
    consoleS3Url: null,
    runReportUrl: `/api/test-results/${runId}/report/report.html`,
    runLogsUrl: null,
  });
});

it("is 404 when the run is not in the caller's project", async () => {
  mockLimit.mockResolvedValue([]);
  expect((await get()).status).toBe(404);
});
