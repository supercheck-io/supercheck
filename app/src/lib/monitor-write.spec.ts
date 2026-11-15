jest.mock("@/utils/db", () => ({ db: {} }));
import { PgDialect } from "drizzle-orm/pg-core";
import { monitors } from "@/db/schema";
import {
  AlertConfigConflictError,
  assertKeptProvidersValid,
  scheduleOutOfSync,
  frequencyMinutesError,
  InvalidNotificationProvidersError,
  mergePatch,
  preserveWorkerConfigKeys,
  WORKER_OWNED_CONFIG_KEYS,
  configKeepingWorkerKeys,
  configWithoutKeys,
  workerKeysDroppedByWrite,
  monitorAuditTarget,
  withMcpAlertDefaults,
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
  const legacy = { config: { timeoutSeconds: 600 }, frequencyMinutes: 5 };
  it("rejects a pair that is invalid on create and ignores a missing timeout", () => {
    expect(timeoutFrequencyError(null, { config: { timeoutSeconds: 61 }, frequencyMinutes: 1 })).toContain("cannot exceed");
    expect(timeoutFrequencyError(null, { config: { timeoutSeconds: 60 }, frequencyMinutes: 1 })).toBeNull();
    expect(timeoutFrequencyError(null, { config: {}, frequencyMinutes: 1 })).toBeNull();
    expect(timeoutFrequencyError(null, { config: null, frequencyMinutes: 1 })).toBeNull();
  });
  it("lets a stored invalid pair save unchanged, and any change that narrows the gap", () => {
    expect(timeoutFrequencyError(legacy, { config: { timeoutSeconds: 600 }, frequencyMinutes: 5 })).toBeNull();
    expect(timeoutFrequencyError(legacy, { config: { timeoutSeconds: 400 }, frequencyMinutes: 5 })).toBeNull();
    expect(timeoutFrequencyError(legacy, { config: { timeoutSeconds: 600 }, frequencyMinutes: 8 })).toBeNull();
  });
  it("rejects raising the timeout or lowering the interval into or further into invalid", () => {
    const valid = { config: { timeoutSeconds: 30 }, frequencyMinutes: 5 };
    expect(timeoutFrequencyError(valid, { config: { timeoutSeconds: 301 }, frequencyMinutes: 5 })).toContain("cannot exceed");
    expect(timeoutFrequencyError(valid, { config: { timeoutSeconds: 30 }, frequencyMinutes: 0.4 })).toContain("cannot exceed");
    expect(timeoutFrequencyError(legacy, { config: { timeoutSeconds: 700 }, frequencyMinutes: 5 })).toContain("cannot exceed");
    expect(timeoutFrequencyError(legacy, { config: { timeoutSeconds: 600 }, frequencyMinutes: 4 })).toContain("cannot exceed");
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
    sanitizeMonitorFields(body);
    expect(body.name).not.toContain("<script>");
    expect(body.target).toBe("https://example.com/x");
    expect((body.alertConfig as { customMessage: string }).customMessage).not.toContain("<script>");
    expect((body.config as { auth: unknown }).auth).toEqual({ type: "basic", username: "ab${x}", password: "p<b>w", token: "t$" });
  });
  it("leaves an omitted name or target omitted", () => {
    const body: Record<string, unknown> = { enabled: true };
    sanitizeMonitorFields(body);
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

  it("sanitizeMonitorFields trims the target and nothing else", () => {
    const body: Record<string, unknown> = { target: "  https://example.com/?t=ab${x}  " };
    sanitizeMonitorFields(body);
    expect(body.target).toBe("https://example.com/?t=ab${x}");
  });

  it("assertKeptProvidersValid refuses an enabled alert left with no channel and incidents off", () => {
    const config = { enabled: true, notificationProviders: ["a"], alertOnFailure: true, alertOnRecovery: true, alertOnSslExpiration: false, failureThreshold: 1, recoveryThreshold: 1, customMessage: "", incidentEnabled: false } as never;
    expect(() => assertKeptProvidersValid(config, [])).toThrow(AlertConfigConflictError);
    expect(() => assertKeptProvidersValid(config, ["a"])).not.toThrow();
  });

  it("sanitizeMonitorFields never rewrites the target, on any path", () => {
    for (const target of ["https://example.com/p?token=ab${x}&y=1", "2001:db8::1", "[2001:db8::1]"]) {
      const body: Record<string, unknown> = { target };
      sanitizeMonitorFields(body);
      expect(body.target).toBe(target);
    }
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

describe("aiEndpointState is worker-owned", () => {
  it("lists the key and keeps the stored value over a client-sent one", () => {
    expect(WORKER_OWNED_CONFIG_KEYS).toContain("aiEndpointState");
    const merged = preserveWorkerConfigKeys(
      { aiEndpointState: { lastServedModel: "stored" } },
      { aiEndpoint: { model: "m" }, aiEndpointState: { lastServedModel: "forged" } },
    );
    expect(merged).toEqual({ aiEndpoint: { model: "m" }, aiEndpointState: { lastServedModel: "stored" } });
  });
  it("drops a client-sent value when nothing is stored", () => {
    expect(preserveWorkerConfigKeys(null, { aiEndpointState: { lastServedModel: "forged" } })).toEqual({});
  });
});

describe("mcpState is worker-owned", () => {
  it("is never accepted from a client and is preserved on update", () => {
    expect(WORKER_OWNED_CONFIG_KEYS).toContain("mcpState");
    const stored = { mcpState: { detectedProtocol: "2026" as const, lastCycleKey: "c1" } };
    const merged = preserveWorkerConfigKeys(stored, { mcp: { auth: { type: "none" as const } }, mcpState: { detectedProtocol: "2025" as const } });
    expect(merged).toEqual({ mcp: { auth: { type: "none" } }, mcpState: { detectedProtocol: "2026", lastCycleKey: "c1" } });
    expect(preserveWorkerConfigKeys(null, { mcpState: { lastCycleKey: "forged" } })).toEqual({});
    expect(preserveWorkerConfigKeys({}, { mcpState: { lastCycleKey: "forged" } })).toEqual({});
  });
});

describe("withMcpAlertDefaults", () => {
  it("fills failureThreshold 2, sev2 and incident flags for mcp_server only when unset", () => {
    const value = (raw: Record<string, unknown>) => {
      const r = normalizeMonitorAlertConfig(withMcpAlertDefaults("mcp_server", raw));
      if (!r.ok) throw new Error(r.error);
      return r.value;
    };
    expect(value({ enabled: true })).toMatchObject({ failureThreshold: 2, incidentSeverity: "sev2", incidentEnabled: true, autoResolveIncident: true });
    expect(value({ failureThreshold: 4, incidentSeverity: "sev3", incidentEnabled: false, autoResolveIncident: false })).toMatchObject({
      failureThreshold: 4, incidentSeverity: "sev3", incidentEnabled: false, autoResolveIncident: false,
    });
    expect(value({ failureThreshold: null, incidentSeverity: "" })).toMatchObject({ failureThreshold: 2, incidentSeverity: "sev2" });
  });
  it("leaves other monitor types untouched", () => {
    const raw = { enabled: true };
    expect(withMcpAlertDefaults("http_request", raw)).toBe(raw);
  });
});

describe("monitorAuditTarget", () => {
  it("logs an MCP endpoint as its host only", () => {
    expect(monitorAuditTarget("mcp_server", "https://mcp.example.com:8443/t/abc123/mcp?x=1")).toBe("mcp.example.com:8443");
    expect(monitorAuditTarget("mcp_server", "not a url")).toBeNull();
    expect(monitorAuditTarget("mcp_server", undefined)).toBeUndefined();
    expect(monitorAuditTarget("http_request", "https://a.example.com/p")).toBe("https://a.example.com/p");
  });
});

describe("configKeepingWorkerKeys", () => {
  const render = (config: unknown, except: string[] = []) => new PgDialect().sqlToQuery(configKeepingWorkerKeys(config, monitors.config, except));
  it("strips every client-sent worker key and re-adds each one from the row's current config", () => {
    const { sql, params } = render({ method: "GET", mcpState: { lastCycleKey: "forged" } });
    expect(params).toEqual([JSON.stringify({ method: "GET", mcpState: { lastCycleKey: "forged" } })]);
    for (const key of WORKER_OWNED_CONFIG_KEYS) {
      expect(sql.match(new RegExp(`'${key}'`, "g"))).toHaveLength(2); // once in the strip list, once in the keep list
    }
    expect(sql).toContain('jsonb_each(coalesce("monitors"."config"');
    expect(sql).not.toContain("jsonb_strip_nulls");
  });
  it("does not restore a key this write deliberately deletes", () => {
    const { sql } = render({}, ["sslAlertState"]);
    expect(sql.match(/'sslAlertState'/g)).toHaveLength(1); // stripped only
  });
});

describe("workerKeysDroppedByWrite", () => {
  const stored = { target: "https://a.example.com/mcp", config: { mcpState: { lastCycleKey: "c" }, mcp: { auth: { type: "bearer", secretKey: "T" } } } };
  const mcpDropped = (s: Parameters<typeof workerKeysDroppedByWrite>[0], n: Parameters<typeof workerKeysDroppedByWrite>[1]) =>
    workerKeysDroppedByWrite(s, n).includes("mcpState");
  it("drops mcpState when the target changes, with or without a config", () => {
    expect(workerKeysDroppedByWrite(stored, { target: "https://b.example.com/mcp" })).toEqual(["mcpState"]);
    expect(mcpDropped(stored, { target: "https://b.example.com/mcp", config: stored.config })).toBe(true);
  });
  it.each([
    [{ type: "bearer", secretKey: "OTHER" }],
    [{ type: "header", secretKey: "T", headerName: "X-Key" }],
    [{ type: "none" }],
  ])("drops mcpState when the login changes to %j", (auth) => {
    expect(mcpDropped(stored, { config: { mcp: { auth } } })).toBe(true);
  });
  it("drops mcpState on a target change even when the earlier read had none (the worker may write it meanwhile)", () => {
    expect(mcpDropped({ target: "a", config: {} }, { target: "b" })).toBe(true);
  });
  it("keeps mcpState for other edits", () => {
    expect(mcpDropped(stored, { target: stored.target, config: { mcp: { auth: stored.config.mcp.auth, slowMs: 500 }, timeoutSeconds: 10 } })).toBe(false);
    expect(workerKeysDroppedByWrite(stored, {})).toEqual([]);
  });
  it("drops sslAlertState whenever the saved settings send no SSL alerts, even if the earlier read had none", () => {
    expect(workerKeysDroppedByWrite({ config: {} }, { config: { enableSslCheck: false } })).toEqual(["sslAlertState"]);
    expect(workerKeysDroppedByWrite({ config: {}, alertConfig: { enabled: true, alertOnSslExpiration: true } }, { config: { enableSslCheck: true } })).toEqual([]);
    expect(workerKeysDroppedByWrite({ config: {} }, { config: { enableSslCheck: true }, alertConfig: { enabled: true, alertOnSslExpiration: false } })).toEqual(["sslAlertState"]);
    // An explicit null clears alerts; only an omitted alertConfig falls back to the stored one.
    expect(workerKeysDroppedByWrite({ config: {}, alertConfig: { enabled: true, alertOnSslExpiration: true } }, { config: { enableSslCheck: true }, alertConfig: null })).toEqual(["sslAlertState"]);
  });
  it("renders a config write that removes the key", () => {
    expect(new PgDialect().sqlToQuery(configWithoutKeys(monitors.config, ["mcpState"])).sql).toContain("- ARRAY['mcpState']");
  });
});
