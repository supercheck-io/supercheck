/** @jest-environment node */
const add = jest.fn();
const getJob = jest.fn();
jest.mock("bullmq", () => ({ Queue: jest.fn().mockImplementation(() => ({ add, getJob, on: jest.fn() })) }));
jest.mock("@/lib/queue", () => ({
  assertExecutionQueueReady: jest.fn().mockResolvedValue(undefined),
  getRedisConnection: jest.fn().mockResolvedValue({}),
}));

import { SCAN_PICKUP_TIMEOUT_MS, enqueueScan, readScan, sanitizeScanResult } from "./scan";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const good = {
  finalUrl: "https://x.test/path?q=1",
  reachable: true,
  status: 200,
  redirects: 1,
  responseMs: 120,
  ssl: { validTo: "2027-01-01T00:00:00.000Z", daysRemaining: 40, issuer: "CA" },
  pages: [{ path: "/a", status: 200, ms: 50, title: "A" }],
};

describe("setup scan queue helpers", () => {
  beforeEach(() => jest.clearAllMocks());

  it("enqueues with a project-scoped job id, only the URL as payload", async () => {
    const id = await enqueueScan(PROJECT, "https://x.test/");
    expect(id).toMatch(new RegExp(`^setup-scan:${PROJECT}:[0-9a-f-]{36}$`));
    expect(add).toHaveBeenCalledWith("scan", { url: "https://x.test/" }, { jobId: id });
  });

  it("sanitizes: strips unknown keys (bodies, headers) and rejects malformed data", () => {
    const clean = sanitizeScanResult({ ...good, body: "<html>", headers: { a: 1 }, pages: [{ ...good.pages[0], html: "x" }] });
    expect(clean?.finalUrl).toBe("https://x.test/path");
    expect(JSON.stringify(clean)).not.toMatch(/html|headers|body/);
    expect(sanitizeScanResult({ ...good, pages: Array.from({ length: 21 }, () => good.pages[0]) })).toBeNull();
    expect(sanitizeScanResult({ ...good, pages: [{ ...good.pages[0], title: "x".repeat(121) }] })).toBeNull();
    expect(sanitizeScanResult(null)).toBeNull();
  });

  it("maps job states", async () => {
    const job = (state: string, extra: object = {}) => ({ getState: async () => state, timestamp: Date.now(), ...extra });
    getJob.mockResolvedValueOnce(null);
    expect(await readScan("a")).toBeNull();
    getJob.mockResolvedValueOnce(job("active"));
    expect(await readScan("a")).toEqual({ status: "running" });
    getJob.mockResolvedValueOnce(job("waiting"));
    expect(await readScan("a")).toEqual({ status: "queued" });
    getJob.mockResolvedValueOnce(job("waiting", { timestamp: Date.now() - SCAN_PICKUP_TIMEOUT_MS - 1 }));
    expect(await readScan("a")).toEqual({ status: "unavailable" });
    getJob.mockResolvedValueOnce(job("failed"));
    expect(await readScan("a")).toEqual({ status: "failed" });
    getJob.mockResolvedValueOnce(job("completed", { returnvalue: good }));
    expect(await readScan("a")).toMatchObject({ status: "done", result: { reachable: true } });
    getJob.mockResolvedValueOnce(job("completed", { returnvalue: { nope: 1 } }));
    expect(await readScan("a")).toEqual({ status: "failed" });
  });
});
