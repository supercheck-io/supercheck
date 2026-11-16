import type { SetupDraft } from "@/lib/setup/draft-schema";
import { SETUP_FEATURES } from "@/lib/setup/features";
import { buildCreateItems, runAll, runItem, retryWithDependents, PROJECT_CHANGED_ERROR, PROJECT_HEADER, TAKEN_OVER_ERROR, type CreateItem, type ItemResult, type RunnerDeps } from "./create-runner";

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
    getComponents: jest.fn(async () => ({ success: true, components: [] })),
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

  it("sends the setup project with every REST call so the server can refuse a switched project", async () => {
    const { deps, calls } = makeDeps();
    await runAll(build(draft()), deps, () => undefined);
    const rest = calls.filter((c) => c.url.startsWith("/api/monitors"));
    expect(rest.length).toBeGreaterThan(0);
    for (const call of rest) expect((call as { headers?: Record<string, string> }).headers).toEqual({ [PROJECT_HEADER]: PROJECT });
  });

  it("re-claims the lock before each item and stops when another person took over", async () => {
    const heartbeat = jest.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
    const { deps } = makeDeps({ heartbeat });
    const results: Record<string, ItemResult> = {};
    await runAll(build(draft()), deps, (k, r) => (results[k] = r));
    expect(heartbeat).toHaveBeenCalledTimes(2);
    expect(Object.values(results).map((r) => r.status)).toEqual(["done", "failed"]);
    expect(Object.values(results)[1].error).toBe(TAKEN_OVER_ERROR);
    expect((deps.fetchJson as jest.Mock).mock.calls.filter(([, i]) => i?.method === "POST")).toHaveLength(1);
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
    existing.created["statuspage:publish"] = "sp-1";
    expect((await runItem(sp, existing.deps)).status).toBe("adopted");
    expect(existing.deps.publishStatusPage).not.toHaveBeenCalled();
    const deleted = makeDeps();
    deleted.created[sp.key] = "sp-gone";
    expect((await runItem(sp, deleted.deps)).status).toBe("skipped");
  });

  it("retries a failed publish on the next run, then records it so it is not published twice", async () => {
    const sp = build(spDraft()).find((i) => i.kind === "status_page") as CreateItem;
    const publish = jest.fn().mockResolvedValueOnce({ success: false, message: "nope" }).mockResolvedValue({ success: true });
    const pages: Array<{ id: string; name: string }> = [];
    const run = makeDeps({
      publishStatusPage: publish,
      getStatusPages: jest.fn(async () => ({ success: true, statusPages: pages })),
      createStatusPage: jest.fn(async () => { pages.push({ id: "sp-1", name: "Acme status" }); return { success: true, statusPage: { id: "sp-1" } }; }),
    });
    expect((await runItem(sp, run.deps)).status).toBe("failed");
    expect(run.created[sp.key]).toBe("sp-1");
    expect(run.created["statuspage:publish"]).toBeUndefined();
    expect((await runItem(sp, run.deps)).status).toBe("done");
    expect(publish).toHaveBeenCalledTimes(2);
    expect(run.deps.createStatusPage).toHaveBeenCalledTimes(1);
    expect((await runItem(sp, run.deps)).status).toBe("adopted");
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("never publishes a page it only adopted by name", async () => {
    const adopt = makeDeps({ getStatusPages: jest.fn(async () => ({ success: true, statusPages: [{ id: "sp-old", name: "Acme status" }] })) });
    const sp = build(spDraft()).find((i) => i.kind === "status_page") as CreateItem;
    await runItem(sp, adopt.deps);
    expect((await runItem(sp, adopt.deps)).status).toBe("adopted");
    expect(adopt.deps.publishStatusPage).not.toHaveBeenCalled();
  });

  it("skips a component whose monitor or status page was deleted since", async () => {
    const comp = build(spDraft()).find((i) => i.kind === "component") as CreateItem;
    const noMonitor = makeDeps({ getStatusPages: jest.fn(async () => ({ success: true, statusPages: [{ id: "sp-1", name: "x" }] })) });
    noMonitor.created.statuspage = "sp-1";
    noMonitor.created[comp.monitorKey as string] = "m-gone";
    expect(await runItem(comp, noMonitor.deps)).toMatchObject({ status: "skipped", note: "The monitor was deleted" });
    const noPage = makeDeps({}, [{ id: "m-1", type: "website", target: "t", name: "n" }]);
    noPage.created.statuspage = "sp-gone";
    noPage.created[comp.monitorKey as string] = "m-1";
    expect(await runItem(comp, noPage.deps)).toMatchObject({ status: "skipped", note: "The status page was deleted" });
    expect(noMonitor.deps.createComponent).not.toHaveBeenCalled();
    expect(noPage.deps.createComponent).not.toHaveBeenCalled();
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
    const bad = makeDeps(
      { createComponent: jest.fn(async () => ({ success: false, message: "Component failed" })), getStatusPages: jest.fn(async () => ({ success: true, statusPages: [{ id: "sp-1", name: "x" }] })) },
      [{ id: "m-1", type: "website", target: "t", name: "n" }],
    );
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

describe("components: adoption and retry chain", () => {
  const spDraft = () => draft({ statusPage: { name: "Acme status", publish: false } });
  const monitors = [{ id: "m-1", type: "website", target: "t", name: "n" }];
  const ready = (over: Partial<RunnerDeps> = {}) => {
    const run = makeDeps({ getStatusPages: jest.fn(async () => ({ success: true, statusPages: [{ id: "sp-1", name: "x" }] })), ...over }, monitors);
    run.created.statuspage = "sp-1";
    return run;
  };

  it("adopts a component with the same name or the same monitor instead of creating a second one", async () => {
    const comp = build(spDraft()).find((i) => i.kind === "component") as CreateItem;
    const byName = ready({ getComponents: jest.fn(async () => ({ success: true, components: [{ id: "c-old", name: "app.example.com", monitorIds: [] }] })) });
    byName.created[comp.monitorKey as string] = "m-1";
    expect(await runItem(comp, byName.deps)).toMatchObject({ status: "adopted" });
    expect(byName.created[comp.key]).toBe("c-old");
    const byMonitor = ready({ getComponents: jest.fn(async () => ({ success: true, components: [{ id: "c-2", name: "other", monitorIds: ["m-1"] }] })) });
    byMonitor.created[comp.monitorKey as string] = "m-1";
    expect((await runItem(comp, byMonitor.deps)).status).toBe("adopted");
    expect(byName.deps.createComponent).not.toHaveBeenCalled();
    expect(byMonitor.deps.createComponent).not.toHaveBeenCalled();
  });

  it("fails without creating when the component list cannot be read", async () => {
    const comp = build(spDraft()).find((i) => i.kind === "component") as CreateItem;
    const run = ready({ getComponents: jest.fn(async () => ({ success: false, components: [] })) });
    run.created[comp.monitorKey as string] = "m-1";
    expect((await runItem(comp, run.deps)).status).toBe("failed");
    expect(run.deps.createComponent).not.toHaveBeenCalled();
  });

  it("a successful Retry of a monitor re-runs the components that were skipped because it failed", async () => {
    const items = build(spDraft());
    const monitor = items[0];
    const comp = items.find((i) => i.monitorKey === monitor.key) as CreateItem;
    const run = makeDeps({ getStatusPages: jest.fn(async () => ({ success: true, statusPages: [{ id: "sp-1", name: "x" }] })) });
    run.created.statuspage = "sp-1";
    const base = run.deps.fetchJson;
    run.deps.fetchJson = jest.fn(async (url, init) => (url === "/api/monitors" && init?.method === "POST" ? { ok: true, status: 200, data: { id: "m-new" } } : base(url, init)));
    const results: Record<string, ItemResult> = { [comp.key]: { status: "skipped", note: "The monitor was not created" } };
    await retryWithDependents(monitor, items, run.deps, (k, r) => (results[k] = r), (k) => results[k]?.status === "skipped");
    expect(results[monitor.key].status).toBe("done");
    expect(results[comp.key].status).toBe("done");
    expect(run.deps.createComponent).toHaveBeenCalledWith({ statusPageId: "sp-1", name: "app.example.com", monitorIds: ["m-new"] });
  });

  it("does not touch dependents when the Retry fails", async () => {
    const items = build(spDraft());
    const run = makeDeps({}, []);
    run.deps.fetchJson = jest.fn(async (url) => (url === "/api/context" ? ok({ project: { id: "other" } }) : ok({})));
    const seen: string[] = [];
    await retryWithDependents(items[0], items, run.deps, (k) => seen.push(k), () => true);
    expect(new Set(seen)).toEqual(new Set([items[0].key]));
  });
});
