/** @jest-environment node */
jest.mock("@/utils/db", () => ({ db: {
  select: jest.fn(), query: { tests: { findFirst: jest.fn() }, runs: { findFirst: jest.fn() }, reports: { findFirst: jest.fn() } },
} }));
jest.mock("@/lib/auth-context", () => ({ requireAuthContext: jest.fn(), isAuthError: () => false }));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: () => true }));
jest.mock("@/lib/queue-event-hub", () => ({ getQueueEventHub: jest.fn() }));
jest.mock("@/lib/queue-stats", () => ({ getQueueStats: jest.fn().mockResolvedValue({ running: 0 }) }));
import { NextRequest } from "next/server";
import { db } from "@/utils/db";
import { requireAuthContext } from "@/lib/auth-context";
import { getQueueEventHub } from "@/lib/queue-event-hub";
import { GET as jobs } from "@/app/api/job-status/events/route";
import { GET as run } from "@/app/api/job-status/events/[runId]/route";
import { GET as test } from "@/app/api/test-status/events/[testId]/route";
import { GET as executions } from "@/app/api/executions/events/route";
import { GET as stats } from "@/app/api/queue-stats/sse/route";

const unsubscribe = jest.fn();
const subscribe = jest.fn(() => unsubscribe);
const ready = jest.fn();
const routes = [["jobs", jobs], ["run", run], ["test", test], ["executions", executions], ["stats", stats]] as const;
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  ready.mockResolvedValue(undefined);
  (getQueueEventHub as jest.Mock).mockReturnValue({ ready, subscribe });
  (requireAuthContext as jest.Mock).mockResolvedValue({ userId: "user", organizationId: "org", project: { id: "project", userRole: "org_admin" } });
  (db.query.tests.findFirst as jest.Mock).mockResolvedValue({ id: "test" });
  (db.query.runs.findFirst as jest.Mock).mockResolvedValue(null);
  (db.query.reports.findFirst as jest.Mock).mockResolvedValue(null);
  (db.select as jest.Mock).mockReturnValue({ from: () => ({ leftJoin: () => ({ where: () => ({ limit: async () => [{ runProjectId: "project", jobOrgId: "org" }] }) }) }) });
});
afterEach(() => { jest.useRealTimers(); });

describe.each(routes)("%s SSE cleanup", (_name, get) => {
  it.each(["cancel", "abort"])("releases subscriptions and timers on %s", async (mode) => {
    const abort = new AbortController();
    const request = new NextRequest("http://localhost/api/events/00000000-0000-4000-8000-000000000099", { signal: abort.signal });
    const removed = jest.spyOn(request.signal, "removeEventListener");
    const response = await get(request);
    const reader = response.body!.getReader();
    await reader.read();
    // Let async start finish after initial database reads.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBeGreaterThan(0);
    if (mode === "cancel") await reader.cancel();
    else abort.abort();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(removed).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(jest.getTimerCount()).toBe(0);
    abort.abort();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
  it("does not subscribe when aborted while the hub is starting", async () => {
    let resolve!: () => void;
    ready.mockReturnValue(new Promise<void>((done) => { resolve = done; }));
    const abort = new AbortController();
    const response = await get(new NextRequest("http://localhost/api/events/00000000-0000-4000-8000-000000000099", { signal: abort.signal }));
    abort.abort();
    resolve();
    await response.body!.getReader().read();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(subscribe).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe.each([["run", run], ["test", test]] as const)("%s startup query cleanup", (name, get) => {
  it.each(["cancel", "abort"])("unsubscribes during a pending query on %s", async (mode) => {
    let resolve!: (value: null) => void;
    const pending = new Promise<null>((done) => { resolve = done; });
    const query = name === "run" ? db.query.runs.findFirst : db.query.reports.findFirst;
    (query as jest.Mock).mockReturnValueOnce(pending);
    const abort = new AbortController();
    const response = await get(new NextRequest("http://localhost/api/events/00000000-0000-4000-8000-000000000099", { signal: abort.signal }));
    const reader = response.body!.getReader();
    await reader.read();
    expect(subscribe).toHaveBeenCalledTimes(1);
    const cancellation = mode === "cancel" ? reader.cancel() : Promise.resolve(abort.abort());
    // Cleanup must happen before the database promise resolves.
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    resolve(null);
    await cancellation;
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(jest.getTimerCount()).toBe(0);
  });
  it("unsubscribes when the initial query rejects", async () => {
    let reject!: (error: Error) => void;
    const pending = new Promise<never>((_done, fail) => { reject = fail; });
    const query = name === "run" ? db.query.runs.findFirst : db.query.reports.findFirst;
    (query as jest.Mock).mockReturnValueOnce(pending);
    const response = await get(new NextRequest("http://localhost/api/events/00000000-0000-4000-8000-000000000099"));
    const reader = response.body!.getReader();
    await reader.read();
    reject(new Error("database unavailable"));
    await reader.read();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});
