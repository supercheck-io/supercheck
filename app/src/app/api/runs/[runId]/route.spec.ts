/** @jest-environment node */
const rows: unknown[] = [];
const counts: unknown[] = [];
// Both queries end in limit() (run row) or where() (job test count); the chain resolves whichever is awaited last.
const chain = (result: () => unknown[]) => {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "leftJoin", "innerJoin"]) c[m] = () => c;
  c.where = () => Object.assign(Promise.resolve(result()), { limit: async () => result() });
  return c;
};
jest.mock("@/utils/db", () => ({
  db: { select: jest.fn((fields: Record<string, unknown>) => chain(() => ("count" in fields ? counts : rows))) },
}));
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn(async () => ({ organizationId: "org", project: { id: "p" } })),
  isAuthError: () => false,
}));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: () => true }));
jest.mock("@/lib/resource-deletion/run", () => ({ deleteRunWithContext: jest.fn() }));
import { GET } from "./route";

const get = () =>
  GET(new Request("http://localhost/api/runs/x"), { params: Promise.resolve({ runId: "019a0000-0000-7000-8000-000000000001" }) });

beforeEach(() => {
  rows.length = 0;
  counts.length = 0;
});

it("reports one test and a report url for a single-test run", async () => {
  rows.push({ id: "r", jobId: null, testId: "t1", reportUrl: "s3://x" });
  const body = await (await get()).json();
  expect(body.testCount).toBe(1);
  expect(body.reportUrl).toBe("/api/test-results/r/report/index.html");
});

it("counts the job's tests for a job run", async () => {
  rows.push({ id: "r", jobId: "j", testId: null, reportUrl: null });
  counts.push({ count: 3 });
  expect((await (await get()).json()).testCount).toBe(3);
});
