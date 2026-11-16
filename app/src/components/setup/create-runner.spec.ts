import type { SetupDraft } from "@/lib/setup/draft-schema";
import { SETUP_FEATURES } from "@/lib/setup/features";
import { buildCreateItems, runAll, runItem, PROJECT_CHANGED_ERROR, type CreateItem, type ItemResult, type RunnerDeps } from "./create-runner";

const PROJECT = "p-1";
const PROVIDER = "00000000-0000-4000-8000-000000000001";
const features = { ...SETUP_FEATURES };
const ok = (data: unknown) => ({ ok: true, status: 200, data });

function makeDeps(overrides: Partial<RunnerDeps> = {}, existing: Array<Record<string, unknown>> = []) {
  const created: Record<string, string> = {};
  let seq = 0;
  const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
  const deps: RunnerDeps = {
    setupProjectId: PROJECT,
    fetchJson: jest.fn(async (url: string, init?: { method?: string; body?: unknown }) => {
      calls.push({ url, ...init });
      if (url === "/api/context") return ok({ project: { id: PROJECT } });
      if (url.startsWith("/api/monitors?")) return ok({ data: existing, pagination: { hasNextPage: false } });
      if (url === "/api/monitors" && init?.method === "POST") {
        const body = init.body as { type: string };
        return ok({ id: `m-${++seq}`, ...(body.type === "heartbeat" ? { heartbeat: { pingUrl: "https://ping.example/abc" } } : {}) });
      }
      return { ok: false, status: 404, data: {} };
    }),
    getStatusPages: jest.fn(async () => ({ success: true, statusPages: [] })),
    createStatusPage: jest.fn(async () => ({ success: true, statusPage: { id: "sp-1" } })),
    publishStatusPage: jest.fn(async () => ({ success: true })),
    createComponent: jest.fn(async () => ({ success: true, component: { id: "c-1" } })),
    getPolicy: jest.fn(async () => ({ success: true, data: { policy: { channelIds: ["x"], emailServiceOwnersOnSev12: true, renotifyUnackedMinutes: null, renotifyRepeatMinutes: null, renotifyMax: 4, escalateAfterMinutes: 30, escalateChannelId: null, escalateUserId: null, autoInvestigateOnOpen: false } } })),
    savePolicy: jest.fn(async () => ({ success: true })),
    recordCreated: jest.fn(async (key: string, id: string) => {
      created[key] = id;
    }),
    getCreated: () => created,
    ...overrides,
  };
  return { deps, created, calls };
}

const draft = (extra: Partial<SetupDraft> = {}): SetupDraft => ({
  alerts: { providerIds: [PROVIDER] },
  monitors: { pages: [{ url: "https://app.example.com/", name: "app.example.com" }, { url: "https://app.example.com/pricing", name: "pricing" }] },
  ...extra,
});
const build = (d: SetupDraft, over: Partial<Parameters<typeof buildCreateItems>[1]> = {}) =>
  buildCreateItems(d, { skipped: [], features, canUpdateProject: true, ...over });

describe("buildCreateItems", () => {
  it("wires the alert step's providers into every monitor and enables SSL on the homepage", () => {
    const items = build(draft());
    expect(items.map((i) => i.kind)).toEqual(["website", "http_request"]);
    expect(items[0].payload).toMatchObject({
      type: "website",
      target: "https://app.example.com/",
      config: { enableSslCheck: true },
      alertConfig: { enabled: true, notificationProviders: [PROVIDER], alertOnFailure: true, alertOnRecovery: true, alertOnSslExpiration: true },
    });
    expect(items[1].payload).not.toHaveProperty("config.enableSslCheck");
  });

  it("omits alertConfig when the alerts step is skipped or has no channels", () => {
    expect(build(draft(), { skipped: ["alerts"] })[0].payload).not.toHaveProperty("alertConfig");
    expect(build(draft({ alerts: { providerIds: [] } }))[0].payload).not.toHaveProperty("alertConfig");
  });

  it("builds heartbeat, AI endpoint and MCP monitors with warnings only for their kinds", () => {
    const d = draft({
      alerts: { providerIds: [PROVIDER], warnings: true },
      monitors: {
        pages: [],
        heartbeat: { name: "Nightly", frequencyMinutes: 60 },
        aiEndpoint: { name: "AI", url: "https://api.example.com/v1/chat/completions", model: "gpt-4o-mini", secretKey: "OPENAI_KEY" },
        mcpMonitor: { name: "MCP", url: "https://mcp.example.com/mcp", secretKey: "MCP_TOKEN" },
      },
    });
    const [hb, ai, mcp] = build(d);
    expect(hb.payload).toMatchObject({ type: "heartbeat", target: "", config: { heartbeat: { graceMinutes: 60 } }, alertConfig: { warnings: { heartbeat_late: true } } });
    expect(ai.payload).toMatchObject({ type: "http_request", config: { aiEndpoint: { model: "gpt-4o-mini", secretKey: "OPENAI_KEY" } } });
    expect((ai.payload as { alertConfig: { warnings: object } }).alertConfig.warnings).toEqual(expect.objectContaining({ ai_model_changed: true }));
    expect(mcp.payload).toMatchObject({ type: "mcp_server", config: { mcp: { auth: { type: "bearer", secretKey: "MCP_TOKEN" } } } });
    expect((mcp.payload as { alertConfig: { warnings: object } }).alertConfig.warnings).not.toHaveProperty("heartbeat_late");
  });

  it("uses no MCP auth without a secret and drops cards whose flag is off", () => {
    const d = draft({ monitors: { pages: [], mcpMonitor: { name: "MCP", url: "https://mcp.example.com/" }, heartbeat: { name: "hb", frequencyMinutes: 5 } } });
    expect(build(d, { features: { ...features, heartbeat: false } }).map((i) => i.kind)).toEqual(["mcp_server"]);
    expect(build(d)[1].payload).toMatchObject({ config: { mcp: { auth: { type: "none" } } } });
    expect(build(d, { features: { ...features, mcpMonitor: false, heartbeat: false } })).toEqual([]);
  });

  it("adds a status page with one component per monitor, unless opted out or skipped", () => {
    const d = draft({ statusPage: { name: "Acme status", publish: true } });
    expect(build(d).map((i) => i.kind)).toEqual(["website", "http_request", "status_page", "component", "component"]);
    expect(build({ ...d, statusPage: { name: "x", optOut: true } }).map((i) => i.kind)).toEqual(["website", "http_request"]);
    expect(build(d, { skipped: ["statusPage"] }).some((i) => i.kind === "status_page")).toBe(false);
  });

  it("adds the repeat item only for a project admin with the flag on", () => {
    const d = draft({ alerts: { providerIds: [PROVIDER], repeatUntilAck: { enabled: true, repeatMinutes: 15 } } });
    expect(build(d).some((i) => i.kind === "repeat")).toBe(true);
    expect(build(d, { canUpdateProject: false }).some((i) => i.kind === "repeat")).toBe(false);
    expect(build(d, { features: { ...features, repeatUntilAck: false } }).some((i) => i.kind === "repeat")).toBe(false);
  });
});

describe("runAll", () => {
  it("creates items one at a time, reports a result per item and records ids", async () => {
    const { deps, created } = makeDeps();
    const items = build(draft());
    const log: Array<[string, ItemResult["status"]]> = [];
    await runAll(items, deps, (key, r) => log.push([key, r.status]));
    expect(log.map(([, s]) => s)).toEqual(["running", "done", "running", "done"]);
    expect(Object.keys(created)).toEqual(items.map((i) => i.key));
    // sequential: the second POST happens after the first finished
    const posts = (deps.fetchJson as jest.Mock).mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(2);
  });

  it("checks the active project before each item and stops when it changed", async () => {
    let contextCalls = 0;
    const { deps } = makeDeps();
    const base = deps.fetchJson;
    deps.fetchJson = jest.fn(async (url, init) => {
      if (url === "/api/context") return ok({ project: { id: ++contextCalls === 1 ? PROJECT : "other" } });
      return base(url, init);
    });
    const results: Record<string, ItemResult> = {};
    await runAll(build(draft()), deps, (k, r) => (results[k] = r));
    const statuses = Object.values(results).map((r) => r.status);
    expect(statuses).toEqual(["done", "failed"]);
    expect(Object.values(results)[1].error).toBe(PROJECT_CHANGED_ERROR);
    expect((deps.fetchJson as jest.Mock).mock.calls.filter(([, i]) => i?.method === "POST")).toHaveLength(1);
  });

  it("stops without creating anything when the context call fails", async () => {
    const { deps } = makeDeps({ fetchJson: jest.fn().mockRejectedValue(new Error("offline")) });
    const [item] = build(draft());
    expect((await runItem(item, deps)).error).toBe(PROJECT_CHANGED_ERROR);
  });

  it("keeps going after a failed item, and Retry runs just that item", async () => {
    const { deps } = makeDeps();
    const base = deps.fetchJson;
    let fail = true;
    deps.fetchJson = jest.fn(async (url, init) => {
      if (url === "/api/monitors" && init?.method === "POST" && fail) {
        fail = false;
        return { ok: false, status: 400, data: { error: "Invalid", details: "bad target" } };
      }
      return base(url, init);
    });
    const items = build(draft());
    const results: Record<string, ItemResult> = {};
    await runAll(items, deps, (k, r) => (results[k] = r));
    expect(results[items[0].key]).toMatchObject({ status: "failed", error: "Invalid: bad target" });
    expect(results[items[1].key].status).toBe("done");
    expect((await runItem(items[0], deps)).status).toBe("done");
  });

  it("honours shouldRun", async () => {
    const { deps } = makeDeps();
    const items = build(draft());
    const seen: string[] = [];
    await runAll(items, deps, (k) => seen.push(k), (k) => k === items[1].key);
    expect(new Set(seen)).toEqual(new Set([items[1].key]));
  });
});

describe("adopt and never recreate", () => {
  it("adopts an existing monitor by type and target", async () => {
    const { deps, created } = makeDeps({}, [{ id: "m-old", type: "website", target: "https://app.example.com/", name: "x" }]);
    const [item] = build(draft());
    expect(await runItem(item, deps)).toMatchObject({ status: "adopted" });
    expect(created[item.key]).toBe("m-old");
    expect((deps.fetchJson as jest.Mock).mock.calls.some(([, i]) => i?.method === "POST")).toBe(false);
  });

  it("adopts a heartbeat by name", async () => {
    const { deps } = makeDeps({}, [{ id: "hb-1", type: "heartbeat", target: "", name: "Nightly" }]);
    const [item] = build(draft({ monitors: { pages: [], heartbeat: { name: "Nightly", frequencyMinutes: 5 } } }));
    expect((await runItem(item, deps)).status).toBe("adopted");
  });

  it("treats a recorded id whose row still exists as done, and one that is gone as skipped", async () => {
    const [item] = build(draft());
    const present = makeDeps({}, [{ id: "m-1", type: "website", target: "https://other/", name: "x" }]);
    present.created[item.key] = "m-1";
    expect((await runItem(item, present.deps)).status).toBe("adopted");
    const gone = makeDeps();
    gone.created[item.key] = "m-gone";
    const result = await runItem(item, gone.deps);
    expect(result.status).toBe("skipped");
    expect((gone.deps.fetchJson as jest.Mock).mock.calls.some(([, i]) => i?.method === "POST")).toBe(false);
  });

  it("reads every monitors page", async () => {
    const { deps } = makeDeps();
    const pages = [
      { data: [{ id: "a", type: "x", target: "t", name: "n" }], pagination: { hasNextPage: true } },
      { data: [{ id: "b", type: "website", target: "https://app.example.com/", name: "n" }], pagination: { hasNextPage: false } },
    ];
    const base = deps.fetchJson;
    deps.fetchJson = jest.fn(async (url, init) => (url.startsWith("/api/monitors?") ? ok(pages.shift()) : base(url, init)));
    expect((await runItem(build(draft())[0], deps)).status).toBe("adopted");
  });

  it("reports a failed monitors lookup", async () => {
    const { deps } = makeDeps();
    const base = deps.fetchJson;
    deps.fetchJson = jest.fn(async (url, init) => (url.startsWith("/api/monitors?") ? { ok: false, status: 500, data: {} } : base(url, init)));
    expect((await runItem(build(draft())[0], deps)).error).toBe("Could not read monitors");
  });
});

describe("heartbeat ping URL", () => {
  it("is returned in the result but never recorded", async () => {
    const { deps, created } = makeDeps();
    const [item] = build(draft({ monitors: { pages: [], heartbeat: { name: "Nightly", frequencyMinutes: 60 } } }));
    const result = await runItem(item, deps);
    expect(result).toMatchObject({ status: "done", pingUrl: "https://ping.example/abc" });
    expect(JSON.stringify(created)).not.toContain("ping.example");
    expect((deps.recordCreated as jest.Mock).mock.calls).toEqual([[item.key, "m-1"]]);
  });
});

describe("status page, components and repeat policy", () => {
  const spDraft = () => draft({ statusPage: { name: "Acme status", publish: true }, alerts: { providerIds: [PROVIDER], repeatUntilAck: { enabled: true, repeatMinutes: 10 } } });

  it("creates, publishes and adds a component per created monitor", async () => {
    const { deps, created } = makeDeps();
    const items = build(spDraft());
    await runAll(items, deps, () => undefined);
    expect(deps.createStatusPage).toHaveBeenCalledWith({ name: "Acme status" });
    expect(deps.publishStatusPage).toHaveBeenCalledWith("sp-1");
    expect(deps.createComponent).toHaveBeenCalledTimes(2);
    expect(deps.createComponent).toHaveBeenCalledWith({ statusPageId: "sp-1", name: "app.example.com", monitorIds: [created[items[0].key]] });
  });

  it("adopts a status page by name and skips the one that was deleted", async () => {
    const adopt = makeDeps({ getStatusPages: jest.fn(async () => ({ success: true, statusPages: [{ id: "sp-old", name: "Acme status" }] })) });
    const sp = build(spDraft()).find((i) => i.kind === "status_page") as CreateItem;
    expect((await runItem(sp, adopt.deps)).status).toBe("adopted");
    expect(adopt.created[sp.key]).toBe("sp-old");
    expect(adopt.deps.createStatusPage).not.toHaveBeenCalled();

    const existing = makeDeps({ getStatusPages: jest.fn(async () => ({ success: true, statusPages: [{ id: "sp-1", name: "x" }] })) });
    existing.created[sp.key] = "sp-1";
    expect((await runItem(sp, existing.deps)).status).toBe("adopted");
    const deleted = makeDeps();
    deleted.created[sp.key] = "sp-gone";
    expect((await runItem(sp, deleted.deps)).status).toBe("skipped");
  });

  it("reports status page failures and a draft left behind when publishing fails", async () => {
    const sp = build(spDraft()).find((i) => i.kind === "status_page") as CreateItem;
    const failed = makeDeps({ createStatusPage: jest.fn(async () => ({ success: false, message: "Limit reached" })) });
    expect(await runItem(sp, failed.deps)).toMatchObject({ status: "failed", error: "Limit reached" });
    const publish = makeDeps({ publishStatusPage: jest.fn(async () => ({ success: false, message: "nope" })) });
    expect((await runItem(sp, publish.deps)).error).toContain("Created as a draft");
    const unreadable = makeDeps({ getStatusPages: jest.fn(async () => ({ success: false, statusPages: [] })) });
    expect((await runItem(sp, unreadable.deps)).error).toBe("Could not read status pages");
  });

  it("skips components whose status page or monitor is missing, adopts recorded ones, reports failures", async () => {
    const items = build(spDraft());
    const comp = items.find((i) => i.kind === "component") as CreateItem;
    const none = makeDeps();
    expect((await runItem(comp, none.deps)).status).toBe("skipped");
    const noMonitor = makeDeps();
    noMonitor.created.statuspage = "sp-1";
    expect((await runItem(comp, noMonitor.deps)).note).toBe("The monitor was not created");
    const recorded = makeDeps();
    recorded.created[comp.key] = "c-9";
    expect((await runItem(comp, recorded.deps)).status).toBe("adopted");
    const bad = makeDeps({ createComponent: jest.fn(async () => ({ success: false, message: "Component failed" })) });
    bad.created.statuspage = "sp-1";
    bad.created[comp.monitorKey as string] = "m-1";
    expect(await runItem(comp, bad.deps)).toMatchObject({ status: "failed", error: "Component failed" });
  });

  it("merges only the reminder fields into the saved policy", async () => {
    const { deps, created } = makeDeps();
    const repeat = build(spDraft()).find((i) => i.kind === "repeat") as CreateItem;
    expect((await runItem(repeat, deps)).status).toBe("done");
    expect(deps.savePolicy).toHaveBeenCalledWith(PROJECT, expect.objectContaining({
      channelIds: ["x"], renotifyUnackedMinutes: 10, renotifyRepeatMinutes: 10, renotifyMax: 4, escalateAfterMinutes: 30, emailServiceOwnersOnSev12: true,
    }));
    expect(created["policy:repeat"]).toBe(PROJECT);
    expect((await runItem(repeat, deps)).status).toBe("adopted");
  });

  it("reports policy read and save failures", async () => {
    const repeat = build(spDraft()).find((i) => i.kind === "repeat") as CreateItem;
    const read = makeDeps({ getPolicy: jest.fn(async () => ({ success: false, error: "Insufficient permissions" })) });
    expect((await runItem(repeat, read.deps)).error).toBe("Insufficient permissions");
    const save = makeDeps({ savePolicy: jest.fn(async () => ({ success: false })) });
    expect((await runItem(repeat, save.deps)).error).toBe("Could not save the notification policy");
  });

  it("turns a thrown error into a failed item", async () => {
    const { deps } = makeDeps({ getPolicy: jest.fn().mockRejectedValue("boom") });
    const repeat = build(spDraft()).find((i) => i.kind === "repeat") as CreateItem;
    expect((await runItem(repeat, deps)).error).toBe("Something went wrong");
  });
});
