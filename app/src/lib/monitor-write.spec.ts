jest.mock("@/utils/db", () => ({ db: {} }));
import {
  AlertConfigConflictError,
  scheduleOutOfSync,
  frequencyMinutesError,
  InvalidNotificationProvidersError,
  mergePatch,
  mirrorProviderRowsToAlertConfig,
  monitorNameError,
  normalizeMonitorAlertConfig,
  sanitizeMonitorFields,
  syncMonitorProviderRows,
  thrownStatusResponse,
  timeoutFrequencyError,
} from "./monitor-write";

describe("monitorNameError", () => {
  it("allows an omitted name and rejects a blank, non-string or over-long one", () => {
    expect(monitorNameError(undefined)).toBeNull();
    expect(monitorNameError("API")).toBeNull();
    for (const bad of ["", "   ", null, 5, "x".repeat(256)]) {
      expect(monitorNameError(bad)).toBe("name must be 1-255 characters");
    }
  });
});

describe("normalizeMonitorAlertConfig incidentSeverity", () => {
  it("rejects an unknown severity instead of silently dropping it", () => {
    expect(normalizeMonitorAlertConfig({ incidentSeverity: "sev9" })).toEqual({
      ok: false,
      error: "incidentSeverity must be one of sev1, sev2, sev3, sev4",
    });
  });
  it("keeps a valid severity and tolerates null or empty", () => {
    expect(normalizeMonitorAlertConfig({ incidentSeverity: "sev2" })).toMatchObject({ ok: true, value: { incidentSeverity: "sev2" } });
    expect(normalizeMonitorAlertConfig({ incidentSeverity: null })).toMatchObject({ ok: true });
    expect(normalizeMonitorAlertConfig({ incidentSeverity: "" })).toMatchObject({ ok: true });
  });
});

describe("mergePatch", () => {
  it("merges objects, replaces arrays and scalars, and deletes null keys", () => {
    const target = { a: 1, o: { x: 1, y: 2, deep: { k: 1 } }, list: [1, 2], gone: "x" };
    const out = mergePatch(target, { a: 2, o: { y: null, deep: { z: 3 } }, list: [9], gone: null, fresh: { n: null } });
    expect(out).toEqual({ a: 2, o: { x: 1, deep: { k: 1, z: 3 } }, list: [9], fresh: {} });
    expect(target.o.y).toBe(2); // inputs are not mutated
  });
  it("replaces a scalar with an object patch", () => {
    expect(mergePatch({ o: "s" }, { o: { a: 1 } })).toEqual({ o: { a: 1 } });
  });
});

describe("frequencyMinutesError", () => {
  it("accepts whole minutes from 1 to 1440 only", () => {
    for (const ok of [1, 5, 1440]) expect(frequencyMinutesError(ok)).toBeNull();
    for (const bad of [0, 1441, 1.5, NaN, Infinity, "5", null, undefined]) expect(frequencyMinutesError(bad)).toContain("whole number");
  });
});

describe("timeoutFrequencyError", () => {
  it("rejects a timeout longer than the interval and ignores a missing value", () => {
    expect(timeoutFrequencyError({ timeoutSeconds: 61 }, 1)).toContain("cannot exceed");
    expect(timeoutFrequencyError({ timeoutSeconds: 60 }, 1)).toBeNull();
    expect(timeoutFrequencyError({}, 1)).toBeNull();
    expect(timeoutFrequencyError(null, 1)).toBeNull();
  });
});

describe("sanitizeMonitorFields", () => {
  it("cleans name, target and customMessage the same way for any caller, and never touches credentials", () => {
    const auth = { type: "basic", username: "ab${x}", password: "p<b>w", token: "t$" };
    const body: Record<string, unknown> = {
      name: "My <script>alert(1)</script>monitor",
      target: "https://example.com/x",
      config: { auth },
      alertConfig: { customMessage: "hi <script>x</script>" },
    };
    sanitizeMonitorFields(body, "http_request");
    expect(body.name).not.toContain("<script>");
    expect(body.target).toBe("https://example.com/x");
    expect((body.alertConfig as { customMessage: string }).customMessage).not.toContain("<script>");
    expect((body.config as { auth: unknown }).auth).toEqual({ type: "basic", username: "ab${x}", password: "p<b>w", token: "t$" });
  });
  it("leaves an omitted name or target omitted", () => {
    const body: Record<string, unknown> = { enabled: true };
    sanitizeMonitorFields(body, "website");
    expect(body).toEqual({ enabled: true });
  });
});

describe("thrownStatusResponse", () => {
  it("maps a plain { statusCode } object and ignores real errors", async () => {
    const res = thrownStatusResponse({ statusCode: 400, message: "Invalid monitor data", errors: { a: 1 } });
    expect(res?.status).toBe(400);
    await expect(res?.json()).resolves.toEqual({ error: "Invalid monitor data", details: { a: 1 } });
    expect(thrownStatusResponse(new Error("boom"))).toBeNull();
    expect(thrownStatusResponse({ statusCode: 200 })).toBeNull();
    expect(thrownStatusResponse(null)).toBeNull();
  });
});

describe("provider rows and alertConfig stay one source of truth", () => {
  const ID = "00000000-0000-4000-8000-0000000000aa";
  const fakeTx = (providerRows: { id: string }[]) => {
    const deleteWhere = jest.fn().mockResolvedValue(undefined);
    const values = jest.fn().mockReturnValue({ onConflictDoNothing: jest.fn() });
    return {
      deleteWhere,
      values,
      tx: {
        select: () => ({ from: () => ({ where: async () => providerRows }) }),
        delete: () => ({ where: deleteWhere }),
        insert: () => ({ values }),
      } as never,
    };
  };

  it("syncMonitorProviderRows replaces the rows with the de-duplicated list", async () => {
    const { tx, deleteWhere, values } = fakeTx([{ id: ID }]);
    await syncMonitorProviderRows(tx, "m1", [ID, ID], "org", "proj");
    expect(deleteWhere).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith([{ monitorId: "m1", notificationProviderId: ID }]);
  });

  it("syncMonitorProviderRows clears the rows for an empty list", async () => {
    const { tx, deleteWhere, values } = fakeTx([]);
    await syncMonitorProviderRows(tx, "m1", [], "org", "proj");
    expect(deleteWhere).toHaveBeenCalledTimes(1);
    expect(values).not.toHaveBeenCalled();
  });

  it("syncMonitorProviderRows throws and writes nothing when an id is outside the project", async () => {
    const { tx, deleteWhere } = fakeTx([]);
    await expect(syncMonitorProviderRows(tx, "m1", [ID], "org", "proj")).rejects.toBeInstanceOf(InvalidNotificationProvidersError);
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it("mirrorProviderRowsToAlertConfig writes the row ids into alertConfig, keeping its other settings", async () => {
    const set = jest.fn().mockReturnValue({ where: jest.fn() });
    const reads = [[{ id: ID }], [{ alertConfig: { enabled: true, notificationProviders: [], alertOnFailure: false } }]];
    const tx = {
      select: () => ({ from: () => ({ where: async () => reads.shift() }) }),
      update: () => ({ set }),
    } as never;
    await mirrorProviderRowsToAlertConfig(tx, "m1");
    expect(set).toHaveBeenCalledWith({
      alertConfig: expect.objectContaining({ enabled: true, alertOnFailure: false, notificationProviders: [ID] }),
    });
  });

  it("mirrorProviderRowsToAlertConfig gives a monitor with no alertConfig the defaults", async () => {
    const set = jest.fn().mockReturnValue({ where: jest.fn() });
    const reads = [[{ id: ID }], [{ alertConfig: null }]];
    const tx = {
      select: () => ({ from: () => ({ where: async () => reads.shift() }) }),
      update: () => ({ set }),
    } as never;
    await mirrorProviderRowsToAlertConfig(tx, "m1");
    expect(set).toHaveBeenCalledWith({ alertConfig: expect.objectContaining({ enabled: false, notificationProviders: [ID] }) });
  });
});

describe("review fixes in monitor-write", () => {
  const A = "00000000-0000-4000-8000-0000000000AA";
  it("canonicalizes and de-duplicates provider ids", () => {
    const r = normalizeMonitorAlertConfig({ notificationProviders: [A, A.toLowerCase()] });
    expect(r).toMatchObject({ ok: true, value: { notificationProviders: [A.toLowerCase()] } });
  });

  it("scheduleOutOfSync flags an active monitor without a job and an inactive one with a job", () => {
    const row = { enabled: true, status: "up", frequencyMinutes: 5, scheduledJobId: "j" };
    expect(scheduleOutOfSync(row)).toBe(false);
    expect(scheduleOutOfSync({ ...row, scheduledJobId: null })).toBe(true);
    expect(scheduleOutOfSync({ ...row, status: "paused" })).toBe(true);
    expect(scheduleOutOfSync({ ...row, status: "paused", scheduledJobId: null })).toBe(false);
  });

  it("sanitizeMonitorFields leaves the target alone on updates but cleans it on create", () => {
    const url = "https://example.com/p?token=ab${x}&y=1";
    const update: Record<string, unknown> = { target: url };
    sanitizeMonitorFields(update, "website");
    expect(update.target).toBe(url);
    const v6: Record<string, unknown> = { target: "[2001:db8::1]" };
    sanitizeMonitorFields(v6, "ping_host", { target: true });
    expect(v6.target).toBe("2001:db8::1");
    const bare: Record<string, unknown> = { target: "2001:db8::1" };
    sanitizeMonitorFields(bare, "port_check", { target: true });
    expect(bare.target).toBe("2001:db8::1");
  });

  it("syncMonitorProviderRows drops a stored provider that was deleted, but rejects a new unknown one", async () => {
    const GONE = "00000000-0000-4000-8000-0000000000bb";
    const OK = "00000000-0000-4000-8000-0000000000cc";
    const make = () => {
      const values = jest.fn().mockReturnValue({ onConflictDoNothing: jest.fn() });
      return { values, tx: { select: () => ({ from: () => ({ where: async () => [{ id: OK }] }) }), delete: () => ({ where: jest.fn() }), insert: () => ({ values }) } as never };
    };
    const a = make();
    await expect(syncMonitorProviderRows(a.tx, "m", [OK, GONE], "o", "p", [GONE])).resolves.toEqual([OK]);
    expect(a.values).toHaveBeenCalledWith([{ monitorId: "m", notificationProviderId: OK }]);
    const b = make();
    await expect(syncMonitorProviderRows(b.tx, "m", [OK, GONE], "o", "p")).rejects.toBeInstanceOf(InvalidNotificationProvidersError);
  });

  it("mirrorProviderRowsToAlertConfig refuses to leave an enabled alert with no channel and no incidents", async () => {
    const reads = [[], [{ alertConfig: { enabled: true, notificationProviders: ["x"], alertOnFailure: true, incidentEnabled: false } }]];
    const tx = { select: () => ({ from: () => ({ where: async () => reads.shift() }) }), update: jest.fn() } as never;
    await expect(mirrorProviderRowsToAlertConfig(tx, "m")).rejects.toBeInstanceOf(AlertConfigConflictError);
  });
});
