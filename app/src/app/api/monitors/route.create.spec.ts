/** @jest-environment node */
import { NextRequest } from "next/server";

const dbSelect = jest.fn();
const dbDeleteWhere = jest.fn();
jest.mock("@/utils/db", () => ({
  db: { select: (...a: unknown[]) => dbSelect(...a), delete: () => ({ where: (...a: unknown[]) => dbDeleteWhere(...a) }), transaction: jest.fn() },
}));
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn(async () => ({ userId: "u", organizationId: "org-1", project: { id: "project-1", name: "P" }, isCliAuth: false })),
  isAuthError: jest.fn(() => false),
}));
jest.mock("@/lib/session-security", () => ({ checkMonitorApiRateLimit: jest.fn(async () => ({ allowed: true })) }));
jest.mock("@/lib/services/subscription-service", () => ({
  subscriptionService: { blockUntilSubscribed: jest.fn(), requireValidPolarCustomer: jest.fn() },
  SubscriptionAccessDeniedError: class extends Error {},
}));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn(() => true) }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
const monitorResumeBlockedResponse = jest.fn();
jest.mock("@/lib/execution/trial-interval-response", () => ({
  trialIntervalErrorResponse: jest.fn().mockResolvedValue(null),
  monitorResumeBlockedResponse: (...a: unknown[]) => monitorResumeBlockedResponse(...a),
}));
const insertWithinPlanLimit = jest.fn();
jest.mock("@/lib/middleware/plan-limit-lock", () => ({ insertWithinPlanLimit: (...a: unknown[]) => insertWithinPlanLimit(...a) }));
jest.mock("@/lib/middleware/plan-enforcement", () => ({ checkMonitorLimit: jest.fn(), ResumeRefusedError: class extends Error {}, resumeRefusalResponse: jest.fn() }));
jest.mock("@/lib/monitor-service", () => ({ insertMonitorRecord: jest.fn(), scheduleCreatedMonitor: jest.fn(), updateMonitorHandler: jest.fn() }));
jest.mock("@/lib/location-registry", () => ({
  getProjectAvailableLocationCodes: jest.fn().mockResolvedValue([]),
  getWorkloadCapableLocationCodes: jest.fn().mockResolvedValue([]),
  getAllEnabledLocationCodes: jest.fn(),
  getDefaultLocationCodes: jest.fn(),
  getFirstDefaultLocationCode: jest.fn(),
  hasProjectLocationRestrictions: jest.fn(),
  PROJECT_RESTRICTED_LOCATIONS_DISABLED_ERROR: "restricted",
}));
jest.mock("@/lib/worker-registry", () => ({ getActiveWorkerQueueNames: jest.fn() }));
const deleteScheduledMonitor = jest.fn(async (_id?: string) => true);
jest.mock("@/lib/monitor-scheduler", () => ({ deleteScheduledMonitor: (id: string) => deleteScheduledMonitor(id) }));
jest.mock("@/lib/creators", () => ({ loadCreators: jest.fn() }));

jest.mock("@/lib/sre/connectors/endpoint-policy", () => ({
  lookupBounded: jest.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));
import { GET, POST, PUT } from "./route";
import { MonitorScheduleError } from "@/lib/monitor-write";

const post = (alertConfig: object) =>
  POST(
    new NextRequest("http://localhost/api/monitors", {
      method: "POST",
      body: JSON.stringify({ name: "m", type: "http_request", target: "https://example.com", alertConfig }),
      headers: { "content-type": "application/json" },
    }),
  );

beforeEach(() => {
  jest.clearAllMocks();
  dbSelect.mockReturnValue({ from: () => ({ where: async () => [] }) });
});

it("returns 403 to a caller without monitor:create before rate limiting or billing checks", async () => {
  const { checkPermissionWithContext } = jest.requireMock("@/lib/rbac/middleware") as { checkPermissionWithContext: jest.Mock };
  const { checkMonitorApiRateLimit } = jest.requireMock("@/lib/session-security") as { checkMonitorApiRateLimit: jest.Mock };
  const { subscriptionService } = jest.requireMock("@/lib/services/subscription-service") as {
    subscriptionService: { blockUntilSubscribed: jest.Mock; requireValidPolarCustomer: jest.Mock };
  };
  checkPermissionWithContext.mockReturnValueOnce(false);
  const res = await post({ enabled: false, notificationProviders: [] });
  expect(res.status).toBe(403);
  expect(checkPermissionWithContext).toHaveBeenCalledWith("monitor", "create", expect.objectContaining({ organizationId: "org-1" }));
  expect(checkMonitorApiRateLimit).not.toHaveBeenCalled();
  expect(subscriptionService.blockUntilSubscribed).not.toHaveBeenCalled();
  expect(subscriptionService.requireValidPolarCustomer).not.toHaveBeenCalled();
});

it("rejects a private monitor target with 400 before inserting", async () => {
  const res = await POST(
    new NextRequest("http://localhost/api/monitors", {
      method: "POST",
      body: JSON.stringify({ name: "m", type: "http_request", target: "http://169.254.169.254/latest" }),
      headers: { "content-type": "application/json" },
    }),
  );
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("Invalid monitor target");
  expect(insertWithinPlanLimit).not.toHaveBeenCalled();
});

it("names the http(s) rule for an ftp:// website target instead of reporting it missing", async () => {
  const res = await POST(
    new NextRequest("http://localhost/api/monitors", {
      method: "POST",
      body: JSON.stringify({ name: "m", type: "website", target: "ftp://example.com" }),
      headers: { "content-type": "application/json" },
    }),
  );
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: "Invalid monitor target", details: "target must be a valid HTTP or HTTPS URL" });
});

it.each([
  [{ method: "FOO" }],
  [{ expectedStatusCodes: "abc" }],
])("rejects invalid http config %j before inserting", async (config) => {
  const res = await POST(
    new NextRequest("http://localhost/api/monitors", {
      method: "POST",
      body: JSON.stringify({ name: "m", type: "http_request", target: "https://example.com", config }),
      headers: { "content-type": "application/json" },
    }),
  );
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("Invalid monitor configuration");
  expect(insertWithinPlanLimit).not.toHaveBeenCalled();
});

it("rejects an unknown incidentSeverity instead of dropping it", async () => {
  const res = await post({ enabled: false, notificationProviders: [], incidentSeverity: "sev9" });
  expect(res.status).toBe(400);
  expect(insertWithinPlanLimit).not.toHaveBeenCalled();
});

it("lets an enabled alert have no channel while incidents are on, and rejects it when they are off", async () => {
  insertWithinPlanLimit.mockClear();
  const off = await post({ enabled: true, notificationProviders: [], alertOnFailure: true, incidentEnabled: false });
  expect(off.status).toBe(400);
  expect((await off.json()).error).toMatch(/notification channel/);
  const on = await post({ enabled: true, notificationProviders: [], alertOnFailure: true });
  // It passed the channel rule and reached the insert (mocked), so incident-only creation is accepted.
  expect(on.status).not.toBe(400);
  expect(insertWithinPlanLimit).toHaveBeenCalledTimes(1);
});

it("rejects a name over 255 characters with 400 before inserting", async () => {
  const res = await POST(
    new NextRequest("http://localhost/api/monitors", {
      method: "POST",
      body: JSON.stringify({ name: "n".repeat(256), type: "http_request", target: "https://example.com" }),
      headers: { "content-type": "application/json" },
    }),
  );
  expect(res.status).toBe(400);
  expect(insertWithinPlanLimit).not.toHaveBeenCalled();
});

it("rejects notification providers outside the project before inserting (c14)", async () => {
  const res = await post({ enabled: true, notificationProviders: ["00000000-0000-4000-8000-0000000000aa"], alertOnFailure: true });
  expect(res.status).toBe(400);
  expect(insertWithinPlanLimit).not.toHaveBeenCalled();
});

it.each([2.5, 0, -3, 101])("rejects failureThreshold %p (c16)", async (failureThreshold) => {
  const res = await post({ enabled: false, notificationProviders: [], failureThreshold });
  expect(res.status).toBe(400);
  expect(insertWithinPlanLimit).not.toHaveBeenCalled();
});

it("bulk PUT refuses to resume a paused monitor without a plan", async () => {
  dbSelect.mockReturnValue({
    from: () => ({ where: () => ({ limit: async () => [{ projectId: "project-1", organizationId: "org-1", status: "paused", type: "website", target: "https://example.com", config: {} }] }) }),
  });
  monitorResumeBlockedResponse.mockResolvedValue(Response.json({ error: "Active subscription required." }, { status: 402 }));
  const res = await PUT(
    new NextRequest("http://localhost/api/monitors", {
      method: "PUT",
      body: JSON.stringify({ id: "00000000-0000-4000-8000-000000000002", enabled: true }),
    }),
  );
  expect(res.status).toBe(402);
  expect(monitorResumeBlockedResponse).toHaveBeenCalledWith("org-1", "paused", expect.objectContaining({ enabled: true }));
});

it("removes the new monitor when it cannot be scheduled, so a retry does not duplicate it", async () => {
  const { scheduleCreatedMonitor } = jest.requireMock("@/lib/monitor-service") as { scheduleCreatedMonitor: jest.Mock };
  insertWithinPlanLimit.mockResolvedValue({ ok: true, row: { newMonitor: { id: "new-monitor" }, enabled: true } });
  scheduleCreatedMonitor.mockRejectedValue(new Error("redis down"));
  const res = await post({ enabled: false, notificationProviders: [] });
  expect(res.status).toBe(500);
  expect(dbDeleteWhere).toHaveBeenCalledTimes(1);
});

it("rejects a synthetic monitor that runs more often than every 5 minutes", async () => {
  const res = await POST(
    new NextRequest("http://localhost/api/monitors", {
      method: "POST",
      body: JSON.stringify({ name: "m", type: "synthetic_test", frequencyMinutes: 1, config: { testId: "00000000-0000-4000-8000-0000000000bb" } }),
      headers: { "content-type": "application/json" },
    }),
  );
  expect(res.status).toBe(400);
  expect(insertWithinPlanLimit).not.toHaveBeenCalled();
});

it("does not insert into a project deleted before the insert took its lock", async () => {
  const { insertMonitorRecord } = jest.requireMock("@/lib/monitor-service") as { insertMonitorRecord: jest.Mock };
  const forShare = jest.fn(async () => []);
  const executor = { select: () => ({ from: () => ({ where: () => ({ for: forShare }) }) }) };
  insertWithinPlanLimit.mockImplementation(async (opts: { insert: (e: unknown) => Promise<unknown> }) => ({ ok: true, row: await opts.insert(executor) }));
  const res = await post({ enabled: false, notificationProviders: [] });
  expect(forShare).toHaveBeenCalledWith("share");
  expect(insertMonitorRecord).not.toHaveBeenCalled();
  expect(res.status).toBe(404);
});

it("opens a transaction for the project lock when no plan limit applies (self-hosted)", async () => {
  const { db } = jest.requireMock("@/utils/db") as { db: { transaction: jest.Mock } };
  const { insertMonitorRecord } = jest.requireMock("@/lib/monitor-service") as { insertMonitorRecord: jest.Mock };
  const forShare = jest.fn(async () => []);
  db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb({ select: () => ({ from: () => ({ where: () => ({ for: forShare }) }) }) }));
  insertWithinPlanLimit.mockImplementation(async (opts: { insert: (e: unknown) => Promise<unknown> }) => ({ ok: true, row: await opts.insert(db) }));
  const res = await post({ enabled: false, notificationProviders: [] });
  expect(db.transaction).toHaveBeenCalled();
  expect(forShare).toHaveBeenCalledWith("share");
  expect(insertMonitorRecord).not.toHaveBeenCalled();
  expect(res.status).toBe(404);
});

it("drops the schedule when the project was deleted between the insert and scheduling", async () => {
  const { scheduleCreatedMonitor } = jest.requireMock("@/lib/monitor-service") as { scheduleCreatedMonitor: jest.Mock };
  insertWithinPlanLimit.mockResolvedValue({ ok: true, row: { newMonitor: { id: "new-monitor" }, enabled: true } });
  scheduleCreatedMonitor.mockResolvedValue({ id: "new-monitor" });
  dbSelect.mockReturnValue({ from: () => ({ innerJoin: () => ({ where: () => ({ limit: async () => [] }) }), where: async () => [] }) });
  const res = await post({ enabled: false, notificationProviders: [] });
  expect(deleteScheduledMonitor).toHaveBeenCalledWith("new-monitor");
  expect(res.status).toBe(404);
});

it("removes the schedule and the row when the post-scheduling check fails", async () => {
  const { scheduleCreatedMonitor } = jest.requireMock("@/lib/monitor-service") as { scheduleCreatedMonitor: jest.Mock };
  insertWithinPlanLimit.mockResolvedValue({ ok: true, row: { newMonitor: { id: "new-monitor" }, enabled: true } });
  scheduleCreatedMonitor.mockResolvedValue({ id: "new-monitor" });
  dbDeleteWhere.mockResolvedValue(undefined);
  dbSelect.mockReturnValue({ from: () => ({ innerJoin: () => ({ where: () => ({ limit: async () => { throw new Error("db down"); } }) }), where: async () => [] }) });
  const res = await post({ enabled: false, notificationProviders: [] });
  expect(res.status).toBe(500);
  expect(deleteScheduledMonitor).toHaveBeenCalledWith("new-monitor");
  expect(dbDeleteWhere).toHaveBeenCalledTimes(1);
});

it("drops worker-owned config keys a client sends on create, so a certificate cannot be forged", async () => {
  const { insertMonitorRecord } = jest.requireMock("@/lib/monitor-service") as { insertMonitorRecord: jest.Mock };
  const executor = { select: () => ({ from: () => ({ where: () => ({ for: async () => [{ id: "project-1" }] }) }) }) };
  insertWithinPlanLimit.mockImplementation(async (opts: { insert: (e: unknown) => Promise<unknown> }) => ({ ok: true, row: await opts.insert(executor) }));
  await POST(
    new NextRequest("http://localhost/api/monitors", {
      method: "POST",
      body: JSON.stringify({
        name: "m", type: "website", target: "https://example.com",
        config: { enableSslCheck: true, sslLastCheckedAt: "2026-01-01T00:00:00.000Z", sslCertificate: { valid: true, daysRemaining: 999 } },
        alertConfig: { enabled: false, notificationProviders: [] },
      }),
      headers: { "content-type": "application/json" },
    }),
  );
  const config = insertMonitorRecord.mock.calls[0][0].config;
  expect(config).toMatchObject({ enableSslCheck: true });
  expect(config).not.toHaveProperty("sslCertificate");
  expect(config).not.toHaveProperty("sslLastCheckedAt");
describe("collection write paths", () => {
  const MONITOR = "00000000-0000-4000-8000-000000000002";
  const { updateMonitorHandler, insertMonitorRecord } = jest.requireMock("@/lib/monitor-service") as {
    updateMonitorHandler: jest.Mock;
    insertMonitorRecord: jest.Mock;
  };
  const { checkPermissionWithContext } = jest.requireMock("@/lib/rbac/middleware") as { checkPermissionWithContext: jest.Mock };
  const stored = { projectId: "project-1", organizationId: "org-1", type: "http_request", frequencyMinutes: 5, status: "up", alertConfig: null, target: "https://example.com", config: {} };
  const put = (body: object) =>
    PUT(new NextRequest("http://localhost/api/monitors", { method: "PUT", body: JSON.stringify({ id: MONITOR, ...body }) }));
  const postBody = (body: object) =>
    POST(new NextRequest("http://localhost/api/monitors", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

  beforeEach(() => {
    dbSelect.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [stored] }) }) });
    updateMonitorHandler.mockResolvedValue({ id: MONITOR });
    monitorResumeBlockedResponse.mockResolvedValue(null);
  });

  it("PUT without alertConfig leaves alert settings and delivery rows alone (B1)", async () => {
    const res = await put({ name: "renamed" });
    expect(res.status).toBe(200);
    expect(updateMonitorHandler).toHaveBeenCalledWith(MONITOR, expect.objectContaining({ alertConfig: undefined }), {});
  });

  it("PUT with alertConfig null clears the config and the delivery rows together (B1, B2)", async () => {
    const res = await put({ alertConfig: null });
    expect(res.status).toBe(200);
    expect(updateMonitorHandler).toHaveBeenCalledWith(
      MONITOR,
      expect.objectContaining({ alertConfig: null }),
      { providerSync: { ids: [], organizationId: "org-1", projectId: "project-1" } },
    );
  });

  it("PUT validates provider ids even when alerts are disabled, then syncs the rows in the write (B2)", async () => {
    const id = "00000000-0000-4000-8000-0000000000aa";
    dbSelect
      .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: async () => [stored] }) }) })
      .mockReturnValueOnce({ from: () => ({ where: async () => [] }) });
    const res = await put({ alertConfig: { enabled: false, notificationProviders: [id] } });
    expect(res.status).toBe(400);
    expect(updateMonitorHandler).not.toHaveBeenCalled();
  });

  it("PUT passes the validated provider list to the write for a disabled config (B2)", async () => {
    const id = "00000000-0000-4000-8000-0000000000aa";
    dbSelect
      .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: async () => [stored] }) }) })
      .mockReturnValueOnce({ from: () => ({ where: async () => [{ id }] }) });
    const res = await put({ alertConfig: { enabled: false, notificationProviders: [id] } });
    expect(res.status).toBe(200);
    expect(updateMonitorHandler.mock.calls[0][2]).toEqual({ providerSync: { ids: [id], organizationId: "org-1", projectId: "project-1" } });
  });

  it("PUT leaves rows alone when alertConfig has no notificationProviders", async () => {
    const res = await put({ alertConfig: { failureThreshold: 3 } });
    expect(res.status).toBe(200);
    expect(updateMonitorHandler.mock.calls[0][2]).toEqual({});
  });

  it("PUT audits a saved change, then answers 503, when the schedule cannot be updated", async () => {
    const { logAuditEvent } = jest.requireMock("@/lib/audit-logger") as { logAuditEvent: jest.Mock };
    updateMonitorHandler.mockRejectedValue(new MonitorScheduleError(new Error("redis down"), { id: MONITOR } as never));
    const res = await put({ frequencyMinutes: 10 });
    expect(res.status).toBe(503);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "monitor_updated", resourceId: MONITOR }));
  });

  it("PUT checks permission before existence and with the update action (B8)", async () => {
    checkPermissionWithContext.mockReturnValueOnce(false);
    const res = await put({ name: "x" });
    expect(res.status).toBe(403);
    expect(dbSelect).not.toHaveBeenCalled();
    expect(checkPermissionWithContext).toHaveBeenCalledWith("monitor", "update", expect.anything());
  });

  it.each([1.5, 0, 1441, "5"])("PUT rejects frequencyMinutes %p (B5)", async (frequencyMinutes) => {
    expect((await put({ frequencyMinutes })).status).toBe(400);
    expect(updateMonitorHandler).not.toHaveBeenCalled();
  });

  it("PUT rejects raising the timeout above, or the interval below, the other; a legacy invalid row keeps saving with a full config (B7)", async () => {
    expect((await put({ config: { timeoutSeconds: 301 } })).status).toBe(400);
    expect((await put({ frequencyMinutes: 1, config: { timeoutSeconds: 90 } })).status).toBe(400);
    dbSelect.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [{ ...stored, config: { timeoutSeconds: 3000 } }] }) }) });
    expect((await put({ name: "legacy row still saves", config: { timeoutSeconds: 3000 } })).status).toBe(200);
    expect((await put({ config: { timeoutSeconds: 3500 } })).status).toBe(400);
  });

  it("PUT answers 503 when the schedule cannot be updated after the save", async () => {
    updateMonitorHandler.mockRejectedValue(new MonitorScheduleError(new Error("redis down")));
    const res = await put({ frequencyMinutes: 10 });
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: expect.stringContaining("Retry the request") });
  });

  it("PUT maps a thrown { statusCode } object to its status instead of a 500 (B5)", async () => {
    updateMonitorHandler.mockRejectedValue({ statusCode: 404, message: "Monitor not found" });
    expect((await put({ name: "x" })).status).toBe(404);
  });

  it("POST rejects a non-integer frequency with 400 (B5)", async () => {
    const res = await postBody({ name: "m", type: "http_request", target: "https://example.com", frequencyMinutes: 2.5 });
    expect(res.status).toBe(400);
    expect(insertWithinPlanLimit).not.toHaveBeenCalled();
  });

  it("POST maps the service's thrown validation object to 400 (B5)", async () => {
    insertWithinPlanLimit.mockRejectedValue({ statusCode: 400, message: "Invalid monitor data", errors: { fieldErrors: {} } });
    const res = await postBody({ name: "m", type: "http_request", target: "https://example.com" });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "Invalid monitor data" });
  });

  it("POST rejects a timeout longer than the interval (B7)", async () => {
    const res = await postBody({ name: "m", type: "http_request", target: "https://example.com", frequencyMinutes: 1, config: { timeoutSeconds: 61 } });
    expect(res.status).toBe(400);
    expect(insertWithinPlanLimit).not.toHaveBeenCalled();
  });

  it("POST stores credentials exactly as typed (B3)", async () => {
    const auth = { type: "basic", username: "ab${x}", password: "p<b>w$" };
    insertWithinPlanLimit.mockImplementation(async (opts: { insert: (tx: unknown) => Promise<unknown> }) => {
      const tx = { select: () => ({ from: () => ({ where: () => ({ for: async () => [{ id: "project-1" }] }) }) }) };
      await opts.insert(tx);
      return { ok: true, row: { newMonitor: { id: "new" }, enabled: true } };
    });
    await postBody({ name: "m", type: "http_request", target: "https://example.com", config: { auth } });
    expect(insertMonitorRecord).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ auth }) }), expect.anything());
  });

  it("POST links providers inside the insert transaction, and a failing link returns 400 with no monitor", async () => {
    const PID = "00000000-0000-4000-8000-0000000000aa";
    const values = jest.fn().mockReturnValue({ onConflictDoNothing: jest.fn() });
    const makeTx = (providers: { id: string }[]) => ({
      select: () => ({ from: () => ({ where: () => ({ for: async () => [{ id: "project-1" }], then: (r: (v: unknown) => void) => r(providers) }) }) }),
      delete: () => ({ where: jest.fn() }),
      insert: () => ({ values }),
    });
    insertMonitorRecord.mockResolvedValue({ newMonitor: { id: "new" }, enabled: true });
    // Outside-project check before the transaction passes (dbSelect), the in-transaction sync decides.
    dbSelect.mockReturnValue({ from: () => ({ where: async () => [{ id: PID }], innerJoin: () => ({ where: () => ({ limit: async () => [{ id: "new" }] }) }) }) });
    insertWithinPlanLimit.mockImplementation(async (opts: { insert: (tx: unknown) => Promise<unknown> }) => ({
      ok: true,
      row: await opts.insert(makeTx([{ id: PID }])),
    }));
    const { scheduleCreatedMonitor } = jest.requireMock("@/lib/monitor-service") as { scheduleCreatedMonitor: jest.Mock };
    scheduleCreatedMonitor.mockResolvedValue({ id: "new" });
    const ok = await postBody({ name: "m", type: "http_request", target: "https://example.com", alertConfig: { enabled: true, notificationProviders: [PID.toUpperCase()] } });
    expect(ok.status).toBe(201);
    expect(values).toHaveBeenCalledWith([{ monitorId: "new", notificationProviderId: PID }]);
    insertWithinPlanLimit.mockImplementation(async (opts: { insert: (tx: unknown) => Promise<unknown> }) => ({
      ok: true,
      row: await opts.insert(makeTx([])),
    }));
    const bad = await postBody({ name: "m", type: "http_request", target: "https://example.com", alertConfig: { enabled: true, notificationProviders: [PID] } });
    expect(bad.status).toBe(400);
  });

  it.each([
    ["http_request", "https://example.com/check?token=ab${x}&y=1"],
    ["ping_host", "2606:4700:4700::1111"],
    ["port_check", "2606:4700:4700::1111"],
  ])("POST keeps a %s target exactly as sent (%s)", async (type, target) => {
    insertWithinPlanLimit.mockImplementation(async (opts: { insert: (tx: unknown) => Promise<unknown> }) => {
      const tx = { select: () => ({ from: () => ({ where: () => ({ for: async () => [{ id: "project-1" }] }) }) }) };
      await opts.insert(tx);
      return { ok: true, row: { newMonitor: { id: "new" }, enabled: true } };
    });
    dbSelect.mockReturnValue({ from: () => ({ where: async () => [], innerJoin: () => ({ where: () => ({ limit: async () => [{ id: "new" }] }) }) }) });
    const { scheduleCreatedMonitor } = jest.requireMock("@/lib/monitor-service") as { scheduleCreatedMonitor: jest.Mock };
    scheduleCreatedMonitor.mockResolvedValue({ id: "new" });
    const config = type === "port_check" ? { port: 443, protocol: "tcp" } : {};
    const res = await postBody({ name: "m", type, target, config });
    expect(res.status).toBe(201);
    expect(insertMonitorRecord).toHaveBeenCalledWith(expect.objectContaining({ target }), expect.anything());
  });

  it("POST rejects a target longer than the column", async () => {
    const res = await postBody({ name: "m", type: "http_request", target: `https://example.com/${"a".repeat(2048)}` });
    expect(res.status).toBe(400);
    expect(insertWithinPlanLimit).not.toHaveBeenCalled();
  });

  it("GET rejects a non-numeric or fractional page or limit with 400 (B6)", async () => {
    for (const query of ["page=abc", "limit=x", "page=1.5", "page=0", "limit=0", "page=-1"]) {
      const res = await GET(new Request(`http://localhost/api/monitors?${query}`));
      expect(res.status).toBe(400);
    }
  });
});
