/** @jest-environment node */

jest.mock("@/utils/db", () => ({ db: { select: jest.fn(), update: jest.fn(), query: { member: { findFirst: jest.fn() } }, transaction: jest.fn() } }));
jest.mock("@/lib/rbac/super-admin", () => ({ isSuperAdmin: jest.fn() }));
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn().mockResolvedValue({ userId: "user-1" }),
  isAuthError: jest.fn(),
}));
jest.mock("@/lib/queue", () => ({ getQueues: jest.fn() }));
jest.mock("@/lib/cancellation-service", () => ({
  RUN_CANCELLATION_MARKER: "Cancellation requested by user",
  setCancellationSignal: jest.fn(),
}));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/capacity-manager", () => ({ getCapacityManager: jest.fn() }));
jest.mock("@/lib/rbac/middleware", () => ({ canCancelRunInProject: jest.fn() }));

import { NextRequest } from "next/server";
import { db } from "@/utils/db";
import { setCancellationSignal } from "@/lib/cancellation-service";
import { isSuperAdmin } from "@/lib/rbac/super-admin";
import { requireAuthContext } from "@/lib/auth-context";
import { canCancelRunInProject } from "@/lib/rbac/middleware";
import { getQueues } from "@/lib/queue";
import { logAuditEvent } from "@/lib/audit-logger";
import { getCapacityManager } from "@/lib/capacity-manager";
import { POST } from "./route";

describe("cancel run authorization", () => {
  it("returns 404 without signaling Redis when ownership cannot be established", async () => {
    (db.select as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue({
        leftJoin: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });

    const response = await POST(
      new NextRequest("http://localhost/api/runs/missing/cancel", {
        method: "POST",
      }),
      { params: Promise.resolve({ runId: "missing" }) },
    );

    expect(response.status).toBe(404);
    expect(setCancellationSignal).not.toHaveBeenCalled();
  });
});


it.each([false, true])("tenant membership gate respects super-admin=%s", async (superAdmin) => {
  jest.clearAllMocks();
  (isSuperAdmin as jest.Mock).mockResolvedValue(superAdmin);
  (canCancelRunInProject as jest.Mock).mockResolvedValue(true);
  (db.query.member.findFirst as jest.Mock).mockResolvedValue(null);
  (db.select as jest.Mock).mockReturnValue({ from: () => ({ leftJoin: () => ({ where: () => ({ limit: async () => [{ jobId: "job", jobOrganizationId: "org", jobProjectId: "project", runStatus: "passed" }] }) }) }) });
  const response = await POST(new NextRequest("http://localhost/api/runs/run/cancel", { method: "POST" }), { params: Promise.resolve({ runId: "run" }) });
  expect(response.status).toBe(superAdmin ? 400 : 403);
  // A super admin reaches the ordinary terminal-run status check, without signaling it.
  expect(setCancellationSignal).not.toHaveBeenCalled();
  if (superAdmin) expect(db.query.member.findFirst).not.toHaveBeenCalled();
});

it("denies a project-scoped CLI token for another project's run, even for a super admin", async () => {
  jest.clearAllMocks();
  (requireAuthContext as jest.Mock).mockResolvedValueOnce({ userId: "user-1", isCliAuth: true, project: { id: "other-project" } });
  (isSuperAdmin as jest.Mock).mockResolvedValue(true);
  (canCancelRunInProject as jest.Mock).mockResolvedValue(true);
  (db.select as jest.Mock).mockReturnValue({ from: () => ({ leftJoin: () => ({ where: () => ({ limit: async () => [{ jobId: "job", jobOrganizationId: "org", jobProjectId: "project", runStatus: "running" }] }) }) }) });
  const response = await POST(new NextRequest("http://localhost/api/runs/run/cancel", { method: "POST" }), { params: Promise.resolve({ runId: "run" }) });
  expect(response.status).toBe(403);
  expect(setCancellationSignal).not.toHaveBeenCalled();
});

describe("cancellation drain", () => {
  const run = { runId: "run", jobId: "job", jobOrganizationId: "org", jobProjectId: "project", runStatus: "running" };
  const set = jest.fn();
  const returning = jest.fn();
  const markerSet = jest.fn();
  const markerWhere = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    (requireAuthContext as jest.Mock).mockResolvedValue({ userId: "user-1" });
    (isSuperAdmin as jest.Mock).mockResolvedValue(true);
    (canCancelRunInProject as jest.Mock).mockResolvedValue(true);
    (db.select as jest.Mock).mockReturnValue({ from: () => ({ leftJoin: () => ({ where: () => ({ limit: async () => [run] }) }) }) });
    run.runStatus = "running";
    returning.mockResolvedValue([{ id: "run" }]);
    set.mockReturnValue({ where: jest.fn().mockReturnValue({ returning }) });
    (db.transaction as jest.Mock).mockImplementation(async callback => callback({ update: () => ({ set }) }));
    markerWhere.mockReset().mockResolvedValue(undefined);
    (db.update as jest.Mock).mockReturnValue({ set: markerSet.mockReturnValue({ where: markerWhere }) });
    (getCapacityManager as jest.Mock).mockResolvedValue({ removeFromQueuedSet: jest.fn().mockResolvedValue(false), releaseRunningSlot: jest.fn() });
  });
  async function cancel() {
    return POST(new NextRequest("http://localhost/api/runs/run/cancel", { method: "POST" }), { params: Promise.resolve({ runId: "run" }) });
  }
  it("keeps an active worker nonterminal until its final report writes drain", async () => {
    (getQueues as jest.Mock).mockResolvedValue({ playwrightQueues: { global: { getJob: async () => ({ id: "run", getState: async () => "waiting", remove: async () => { throw new Error("Job is locked"); } }) } }, k6Queues: {} });
    const response = await cancel();
    expect(response.status).toBe(200);
    expect(setCancellationSignal).toHaveBeenCalledWith("run");
    expect(set).toHaveBeenCalledWith({ errorDetails: "Cancellation requested by user" });
    expect(await response.json()).toMatchObject({ queueRemoved: false, message: "Cancellation requested; waiting for execution to stop" });
  });
  it("finalizes a run the app already marked running when its waiting job was never picked up", async () => {
    (getQueues as jest.Mock).mockResolvedValue({ playwrightQueues: { global: { getJob: async () => ({ id: "run", getState: async () => "waiting", remove: async () => undefined }) } }, k6Queues: {} });
    const response = await cancel();
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: "error", completedAt: expect.any(Date) }));
    expect(await response.json()).toMatchObject({ message: "Run cancelled successfully", queueRemoved: true });
  });
  it("finalizes a run still waiting in the capacity queue", async () => {
    (getQueues as jest.Mock).mockResolvedValue({ playwrightQueues: { global: { getJob: async () => null } }, k6Queues: {} });
    (getCapacityManager as jest.Mock).mockResolvedValue({ removeFromQueuedSet: jest.fn().mockResolvedValue(true), releaseRunningSlot: jest.fn() });
    const response = await cancel();
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: "error", completedAt: expect.any(Date) }));
    expect(await response.json()).toMatchObject({ message: "Run cancelled successfully", queueRemoved: true });
  });
  it("treats a repeated cancel of an already cancelled run as a no-op", async () => {
    Object.assign(run, { runStatus: "error", runErrorDetails: "Cancellation requested by user" });
    const response = await cancel();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, message: "Run cancelled successfully" });
    expect(setCancellationSignal).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
    delete (run as Record<string, unknown>).runErrorDetails;
  });
  it("persists the marker before touching the queue, and refuses (without removing anything) if it cannot", async () => {
    const remove = jest.fn();
    (getQueues as jest.Mock).mockResolvedValue({ playwrightQueues: { global: { getJob: async () => ({ id: "run", getState: async () => "waiting", remove }) } }, k6Queues: {} });
    markerWhere.mockRejectedValueOnce(new Error("db down"));
    const response = await cancel();
    expect(response.status).toBe(503);
    expect(remove).not.toHaveBeenCalled();
    expect(markerSet).toHaveBeenCalledWith({ errorDetails: "Cancellation requested by user" });
  });
  it("leaves a job a worker already handed back in the queue for the worker to finish", async () => {
    const remove = jest.fn();
    const releaseRunningSlot = jest.fn();
    (getQueues as jest.Mock).mockResolvedValue({ playwrightQueues: { global: { getJob: async () => ({ id: "run", getState: async () => "waiting", processedOn: Date.now(), remove }) } }, k6Queues: {} });
    (getCapacityManager as jest.Mock).mockResolvedValue({ removeFromQueuedSet: jest.fn().mockResolvedValue(false), releaseRunningSlot });
    const response = await cancel();
    expect(remove).not.toHaveBeenCalled();
    expect(releaseRunningSlot).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalledWith(expect.objectContaining({ status: "error" }));
    expect(await response.json()).toMatchObject({ queueRemoved: false, message: "Cancellation requested; waiting for execution to stop" });
  });
  it("rejects a cancellation when the worker signal cannot be persisted", async () => {
    (setCancellationSignal as jest.Mock).mockRejectedValueOnce(new Error("Redis unavailable"));
    const response = await cancel();
    expect(response.status).toBe(503);
    expect(set).not.toHaveBeenCalled();
    expect(getQueues).not.toHaveBeenCalled();
  });
  it("finalizes the first cancel of a run that no queue holds, since nothing will ever finish it", async () => {
    // The run is "running" in the database but its job is in neither BullMQ nor the capacity queue (it was
    // removed, finished, or never reached a queue). The stalled-run sweep would take about 80 minutes.
    (getQueues as jest.Mock).mockResolvedValue({ playwrightQueues: { global: { getJob: async () => null } }, k6Queues: {} });
    const response = await cancel();
    expect(response.status).toBe(200);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: "error", completedAt: expect.any(Date) }));
    expect(await response.json()).toMatchObject({ message: "Run cancelled successfully" });
  });
  it.each(["completed", "failed"])("treats a job that already %s in the queue as no job, and finalizes the run", async state => {
    const remove = jest.fn();
    (getQueues as jest.Mock).mockResolvedValue({ playwrightQueues: { global: { getJob: async () => ({ id: "run", processedOn: Date.now(), getState: async () => state, remove }) } }, k6Queues: {} });
    const response = await cancel();
    // BullMQ keeps finished jobs, with processedOn set. That must not read as "a worker is still on it".
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: "error", completedAt: expect.any(Date) }));
    expect(await response.json()).toMatchObject({ message: "Run cancelled successfully" });
    expect(remove).not.toHaveBeenCalled();
  });
  it("treats a finished k6 job the same way", async () => {
    (getQueues as jest.Mock).mockResolvedValue({
      playwrightQueues: { global: { getJob: async () => null } },
      k6Queues: { eu: { getJob: async () => ({ id: "run", processedOn: Date.now(), getState: async () => "failed", remove: jest.fn() }) } },
    });
    const response = await cancel();
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: "error" }));
    expect(await response.json()).toMatchObject({ message: "Run cancelled successfully" });
  });
  it("leaves an active job to its worker", async () => {
    const remove = jest.fn();
    (getQueues as jest.Mock).mockResolvedValue({ playwrightQueues: { global: { getJob: async () => ({ id: "run", processedOn: Date.now(), getState: async () => "active", remove }) } }, k6Queues: {} });
    const response = await cancel();
    expect(remove).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalledWith(expect.objectContaining({ status: "error" }));
    expect(await response.json()).toMatchObject({ message: "Cancellation requested; waiting for execution to stop" });
  });
  describe("when the queue cannot be inspected", () => {
    // The signal and marker are committed, so the run is being cancelled; but a live job may still exist,
    // so the run must not be finalized on a guess, and the caller must not be told the cancel failed.
    it("does not fail the request or finalize when the queues cannot be reached", async () => {
      (getQueues as jest.Mock).mockRejectedValue(new Error("redis down"));
      const response = await cancel();
      expect(response.status).toBe(200);
      expect(set).toHaveBeenCalledWith({ errorDetails: "Cancellation requested by user" });
      expect(set).not.toHaveBeenCalledWith(expect.objectContaining({ status: "error" }));
      expect(await response.json()).toMatchObject({ message: "Cancellation requested; waiting for execution to stop" });
    });
    it("does not finalize when the lookup of a job fails", async () => {
      (getQueues as jest.Mock).mockResolvedValue({ playwrightQueues: { global: { getJob: async () => { throw new Error("timeout"); } } }, k6Queues: {} });
      const response = await cancel();
      expect(response.status).toBe(200);
      expect(set).not.toHaveBeenCalledWith(expect.objectContaining({ status: "error" }));
    });
    it("does not finalize when the capacity queue cannot be checked", async () => {
      (getQueues as jest.Mock).mockResolvedValue({ playwrightQueues: { global: { getJob: async () => null } }, k6Queues: {} });
      (getCapacityManager as jest.Mock).mockResolvedValue({ removeFromQueuedSet: jest.fn().mockRejectedValue(new Error("redis down")), releaseRunningSlot: jest.fn() });
      const response = await cancel();
      expect(response.status).toBe(200);
      expect(set).not.toHaveBeenCalledWith(expect.objectContaining({ status: "error" }));
      expect(await response.json()).toMatchObject({ message: "Cancellation requested; waiting for execution to stop" });
    });
  });
  it("finalizes on retry when an earlier attempt removed the job and wrote the marker but did not finish", async () => {
    Object.assign(run, { runErrorDetails: "Cancellation requested by user" });
    (getQueues as jest.Mock).mockResolvedValue({ playwrightQueues: { global: { getJob: async () => null } }, k6Queues: {} });
    const response = await cancel();
    delete (run as Record<string, unknown>).runErrorDetails;
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: "error", completedAt: expect.any(Date) }));
    expect(await response.json()).toMatchObject({ message: "Run cancelled successfully" });
  });
  it("keeps a running callback protected when its unlocked queue entry was removed", async () => {
    (getQueues as jest.Mock).mockResolvedValue({ playwrightQueues: { global: { getJob: async () => ({ id: "run", getState: async () => "waiting", processedOn: Date.now(), remove: async () => undefined }) } }, k6Queues: {} });
    const response = await cancel();
    expect(set).toHaveBeenCalledWith({ errorDetails: "Cancellation requested by user" });
    expect(set).not.toHaveBeenCalledWith(expect.objectContaining({ status: "error" }));
    expect(await response.json()).toMatchObject({ message: "Cancellation requested; waiting for execution to stop" });
  });
  it("does not report completion when an execution claim wins the queued-state comparison", async () => {
    run.runStatus = "queued";
    returning.mockResolvedValue([]);
    (getQueues as jest.Mock).mockResolvedValue({ playwrightQueues: { global: { getJob: async () => ({ id: "run", getState: async () => "waiting", remove: async () => undefined }) } }, k6Queues: {} });
    const response = await cancel();
    expect(await response.json()).toMatchObject({ message: "Cancellation requested; waiting for execution to stop" });
  });
  it("completes cancellation when the queued job was removed", async () => {
    run.runStatus = "queued";
    (getQueues as jest.Mock).mockResolvedValue({ playwrightQueues: { global: { getJob: async () => ({ id: "run", getState: async () => "waiting", remove: async () => undefined }) } }, k6Queues: {} });
    const response = await cancel();
    expect(response.status).toBe(200);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: "error", completedAt: expect.any(Date) }));
    expect(await response.json()).toMatchObject({ queueRemoved: true });
  });
});
