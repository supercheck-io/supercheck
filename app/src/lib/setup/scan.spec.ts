/** @jest-environment node */
const add = jest.fn();
const getJob = jest.fn();
const getWorkersCount = jest.fn();
jest.mock("bullmq", () => ({ Queue: jest.fn().mockImplementation(() => ({ add, getJob, getWorkersCount, on: jest.fn() })) }));
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

  it("keeps an ssl_invalid error with its reason", () => {
    const clean = sanitizeScanResult({ ...good, reachable: false, status: null, pages: [], error: "ssl_invalid", ssl: null, sslReason: "CERT_HAS_EXPIRED" });
    expect(clean).toMatchObject({ error: "ssl_invalid", ssl: null, sslReason: "CERT_HAS_EXPIRED" });
  });

  it("sanitizes: strips unknown keys (bodies, headers) and rejects malformed data", () => {
    const clean = sanitizeScanResult({ ...good, body: "<html>", headers: { a: 1 }, pages: [{ ...good.pages[0], html: "x" }] });
    expect(clean?.finalUrl).toBe("https://x.test/path");
    expect(JSON.stringify(clean)).not.toMatch(/html|headers|body/);
    expect(sanitizeScanResult({ ...good, pages: Array.from({ length: 21 }, () => good.pages[0]) })).toBeNull();
    expect(sanitizeScanResult(null)).toBeNull();
  });

  it("keeps good pages when one is out of range, and clamps odd status codes", () => {
    const pages = [
      good.pages[0],
      { ...good.pages[0], path: `/${"a".repeat(300)}` },
      { ...good.pages[0], title: "x".repeat(121) },
      { ...good.pages[0], path: "/linkedin", status: 999 },
      { ...good.pages[0], path: "/huge", status: 1500 },
    ];
    const clean = sanitizeScanResult({ ...good, status: 999, pages });
    expect(clean?.status).toBe(999);
    expect(clean?.pages.map((p) => [p.path, p.status])).toEqual([["/a", 200], ["/linkedin", 999], ["/huge", 999]]);
  });

  it("maps job states", async () => {
    const job = (state: string, extra: object = {}) => ({ getState: async () => state, timestamp: Date.now(), ...extra });
    getJob.mockResolvedValueOnce(null);
    expect(await readScan("a")).toBeNull();
    getJob.mockResolvedValueOnce(job("active"));
    expect(await readScan("a")).toEqual({ status: "running" });
    getJob.mockResolvedValueOnce(job("waiting"));
    expect(await readScan("a")).toEqual({ status: "queued" });
    const stale = { timestamp: Date.now() - SCAN_PICKUP_TIMEOUT_MS - 1 };
    getWorkersCount.mockResolvedValueOnce(0);
    getJob.mockResolvedValueOnce(job("waiting", stale));
    expect(await readScan("a")).toEqual({ status: "unavailable" });
    // A worker is consuming the queue but busy: still queued.
    getWorkersCount.mockResolvedValueOnce(2);
    getJob.mockResolvedValueOnce(job("waiting", stale));
    expect(await readScan("a")).toEqual({ status: "queued" });
    // Only "waiting" jobs can be unavailable.
    getJob.mockResolvedValueOnce(job("delayed", stale));
    expect(await readScan("a")).toEqual({ status: "queued" });
    getJob.mockResolvedValueOnce(job("failed"));
    expect(await readScan("a")).toEqual({ status: "failed" });
    getJob.mockResolvedValueOnce(job("completed", { returnvalue: good }));
    expect(await readScan("a")).toMatchObject({ status: "done", result: { reachable: true } });
    getJob.mockResolvedValueOnce(job("completed", { returnvalue: { nope: 1 } }));
    expect(await readScan("a")).toEqual({ status: "failed" });
    // The worker finished between getJob and getState: the first read has no return value, a reload does.
    getJob.mockResolvedValueOnce(job("completed", { returnvalue: null }));
    getJob.mockResolvedValueOnce(job("completed", { returnvalue: good, finishedOn: 4242 }));
    expect(await readScan("a")).toMatchObject({ status: "done", scannedAt: 4242 });
  });
});

describe("sanitizeScanResult redirect fields", () => {
  it("keeps redirected and finalPath on a page and drops other keys", () => {
    const base = { finalUrl: "https://a.com/", reachable: true, status: 200, redirects: 0, responseMs: 1, ssl: null };
    const out = sanitizeScanResult({ ...base, pages: [{ path: "/account", status: 200, ms: 1, title: null, redirected: true, finalPath: "/login", x: 1 }] });
    expect(out?.pages[0]).toEqual({ path: "/account", status: 200, ms: 1, title: null, redirected: true, finalPath: "/login" });
  });
});
