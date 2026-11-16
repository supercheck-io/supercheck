import type { SetupDraft } from "@/lib/setup/draft-schema";
import { SETUP_FEATURES } from "@/lib/setup/features";
import { buildCreateItems, runAll, runItem, retryWithDependents, PROJECT_CHANGED_ERROR, PROJECT_HEADER, TAKEN_OVER_ERROR, NETWORK_ERROR, RATE_LIMIT_NOTE, type CreateItem, type ItemResult, type RunnerDeps } from "./create-runner";

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
    findRequirements: jest.fn(async () => ({ success: true, requirements: [] as Array<{ id: string; title: string }> })),
    createRequirement: jest.fn(async () => ({ id: "r-new", success: true })),
    getServices: jest.fn(async () => ({ success: true, services: [] as Array<{ id: string; name: string }> })),
    createService: jest.fn(async () => ({ success: true, service: { id: "s-new" } })),
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
    expect((await runItem(item, deps)).error).toBe(NETWORK_ERROR);
  });

  it("reports a project mismatch only when the context names another project", async () => {
    const { deps } = makeDeps({ fetchJson: jest.fn().mockResolvedValue({ ok: true, status: 200, data: { project: { id: "other" } } }) });
    const [item] = build(draft());
    expect((await runItem(item, deps)).error).toBe(PROJECT_CHANGED_ERROR);
    const failing = makeDeps({ fetchJson: jest.fn().mockResolvedValue({ ok: false, status: 500, data: {} }) });
    const failed = await runItem(item, failing.deps);
    expect(failed.error).toMatch(/HTTP 500/);
    expect(failed.error).not.toBe(PROJECT_CHANGED_ERROR);
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
    // Each item is 31 s after the last, so each one re-checks.
    let now = 1_000_000;
    const spy = jest.spyOn(Date, "now").mockImplementation(() => (now += 31_000));
    await runAll(build(draft()), deps, (k, r) => (results[k] = r));
    spy.mockRestore();
    expect(heartbeat).toHaveBeenCalledTimes(2);
    expect(Object.values(results).map((r) => r.status)).toEqual(["done", "failed"]);
    expect(Object.values(results)[1].error).toBe(TAKEN_OVER_ERROR);
    expect((deps.fetchJson as jest.Mock).mock.calls.filter(([, i]) => i?.method === "POST")).toHaveLength(1);
  });

  it("checks ownership before the first item, then at most once per 30 s", async () => {
    const heartbeat = jest.fn().mockResolvedValue(true);
    const { deps } = makeDeps({ heartbeat });
    const items = build(draft());
    let now = 1_000_000;
    const spy = jest.spyOn(Date, "now").mockImplementation(() => now);
    await runAll(items, deps, () => undefined);
    expect(heartbeat).toHaveBeenCalledTimes(1);
    now += 31_000;
    await runItem(items[0], deps);
    spy.mockRestore();
    expect(heartbeat).toHaveBeenCalledTimes(2);
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

describe("requirement and service items", () => {
  const withBoth = (): SetupDraft => ({
    tests: { requirements: [{ title: "User can sign in", description: "Happy path" }, { title: "User can log out" }] },
    aiSre: { connectorIds: [], services: [{ name: "app.example.com" }] },
  });
  const items = () => buildCreateItems(withBoth(), { skipped: [], features, canUpdateProject: true });

  it("builds requirement:<title hash> and service items, honouring skips, flags and permissions", () => {
    expect(items().map((i) => [i.key.split(":")[0], i.kind, i.step])).toEqual([
      ["requirement", "requirement", "tests"],
      ["requirement", "requirement", "tests"],
      ["service", "service", "aiSre"],
    ]);
    expect(items()[0].key).toMatch(/^requirement:[0-9a-z]+$/);
    expect(items()[1].payload).toEqual({ title: "User can log out" });
    const only = (over: Partial<Parameters<typeof buildCreateItems>[1]>) => buildCreateItems(withBoth(), { skipped: [], features, canUpdateProject: true, ...over });
    expect(only({ skipped: ["tests", "aiSre"] })).toEqual([]);
    expect(only({ features: { ...features, aiTests: false, aiSre: false } })).toEqual([]);
    expect(only({ canCreateTests: false, canConfigureConnectors: false })).toEqual([]);
  });

  it("creates, records ids, and does not recreate on a re-run", async () => {
    const { deps, created } = makeDeps();
    const results: Record<string, ItemResult> = {};
    await runAll(items(), deps, (k, r) => (results[k] = r));
    expect(Object.values(results).map((r) => r.status)).toEqual(["done", "done", "done"]);
    expect(deps.createRequirement).toHaveBeenCalledTimes(2);
    expect(deps.createRequirement).toHaveBeenCalledWith({ title: "User can sign in", description: "Happy path" });
    expect(Object.values(created)).toEqual(expect.arrayContaining(["r-new", "s-new"]));
    (deps.findRequirements as jest.Mock).mockResolvedValue({ success: true, requirements: [{ id: "r-new", title: "x" }] });
    (deps.getServices as jest.Mock).mockResolvedValue({ success: true, services: [{ id: "s-new", name: "app.example.com" }] });
    await runAll(items(), deps, (k, r) => (results[k] = r));
    expect(deps.createRequirement).toHaveBeenCalledTimes(2);
    expect(deps.createService).toHaveBeenCalledTimes(1);
    expect(results[items()[0].key].status).toBe("adopted");
  });

  it("adopts an existing requirement and service by exact title / name", async () => {
    const { deps, created } = makeDeps({
      findRequirements: jest.fn(async () => ({ success: true, requirements: [{ id: "r-1", title: "User can sign in" }] })),
      getServices: jest.fn(async () => ({ success: true, services: [{ id: "s-1", name: "app.example.com" }] })),
    });
    const list = items();
    expect((await runItem(list[0], deps)).status).toBe("adopted");
    expect((await runItem(list[2], deps)).status).toBe("adopted");
    expect(created).toMatchObject({ [list[0].key]: "r-1", [list[2].key]: "s-1" });
    expect(deps.createRequirement).not.toHaveBeenCalled();
    expect(deps.createService).not.toHaveBeenCalled();
  });

  it("keeps ids with their titles when the list is reordered or trimmed on a re-run", async () => {
    const { deps, created } = makeDeps({ createRequirement: jest.fn().mockResolvedValueOnce({ id: "r-in", success: true }).mockResolvedValueOnce({ id: "r-out", success: true }).mockResolvedValue({ id: "r-new", success: true }) });
    const build = (titles: string[]) => buildCreateItems({ tests: { requirements: titles.map((title) => ({ title })) } }, { skipped: [], features, canUpdateProject: true });
    const first = build(["Sign in", "Log out"]);
    await runAll(first, deps, () => undefined);
    const [signIn, logOut] = [first[0].key, first[1].key];
    expect(created).toMatchObject({ [signIn]: "r-in", [logOut]: "r-out" });
    (deps.findRequirements as jest.Mock).mockResolvedValue({ success: true, requirements: [{ id: "r-in", title: "Sign in" }, { id: "r-out", title: "Log out" }] });
    const second = build(["Pricing", "Log out", "Sign in"]);
    const results: Record<string, ItemResult> = {};
    await runAll(second, deps, (k, r) => (results[k] = r));
    expect(results[signIn].status).toBe("adopted");
    expect(results[logOut].status).toBe("adopted");
    expect(second[0].key).not.toBe(signIn);
    expect(results[second[0].key].status).toBe("done");
    expect(created[second[0].key]).toBe("r-new");
    expect(build(["Sign in", "Sign in"])).toHaveLength(1);
  });

  it("looks requirements up by the recorded id and exact title, so older ones are still found", async () => {
    const { deps, created } = makeDeps({ findRequirements: jest.fn(async () => ({ success: true, requirements: [{ id: "r-old", title: "User can sign in" }] })) });
    const list = items();
    expect((await runItem(list[0], deps)).status).toBe("adopted");
    expect(deps.findRequirements).toHaveBeenCalledWith({ ids: [], titles: ["User can sign in"] });
    created[list[0].key] = "r-old";
    expect((await runItem(list[0], deps)).status).toBe("adopted");
    expect(deps.findRequirements).toHaveBeenLastCalledWith({ ids: ["r-old"], titles: ["User can sign in"] });
    expect(deps.createRequirement).not.toHaveBeenCalled();
  });

  it("skips an item that was created and then deleted", async () => {
    const { deps, created } = makeDeps();
    const list = items();
    created[list[0].key] = "gone";
    created[list[2].key] = "gone";
    expect((await runItem(list[0], deps)).status).toBe("skipped");
    expect((await runItem(list[2], deps)).status).toBe("skipped");
  });

  it("fails with the action error and succeeds on retry", async () => {
    const createRequirement = jest.fn().mockResolvedValueOnce({ id: "", success: false, error: "Insufficient permissions" }).mockResolvedValue({ id: "r-9", success: true });
    const createService = jest.fn().mockResolvedValueOnce({ success: false, error: "An active service with this name already exists" }).mockResolvedValue({ success: true, service: { id: "s-9" } });
    const { deps } = makeDeps({ createRequirement, createService });
    const list = items();
    expect(await runItem(list[0], deps)).toEqual({ status: "failed", error: "Insufficient permissions" });
    expect((await runItem(list[0], deps)).status).toBe("done");
    expect((await runItem(list[2], deps)).error).toMatch(/already exists/);
    expect((await runItem(list[2], deps)).status).toBe("done");
  });

  it("reports unreadable lookups as failures", async () => {
    const { deps } = makeDeps({
      findRequirements: jest.fn(async () => ({ success: false, requirements: [] })),
      getServices: jest.fn(async () => ({ success: false, services: [] })),
    });
    const list = items();
    expect((await runItem(list[0], deps)).error).toMatch(/requirements/);
    expect((await runItem(list[2], deps)).error).toMatch(/services/);
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

  it("does not adopt a same-name component that belongs to another monitor", async () => {
    const comp = build(spDraft()).find((i) => i.kind === "component") as CreateItem;
    const run = ready({ getComponents: jest.fn(async () => ({ success: true, components: [{ id: "c-other", name: "app.example.com", monitorIds: ["m-9"] }] })) });
    run.created[comp.monitorKey as string] = "m-1";
    expect((await runItem(comp, run.deps)).status).toBe("done");
    expect(run.deps.createComponent).toHaveBeenCalledTimes(1);
    expect(run.created[comp.key]).not.toBe("c-other");
  });

  it("adopts a component that already carries this monitor instead of creating a second one", async () => {
    const comp = build(spDraft()).find((i) => i.kind === "component") as CreateItem;
    const byName = ready({ getComponents: jest.fn(async () => ({ success: true, components: [{ id: "c-old", name: "app.example.com", monitorIds: ["m-1"] }] })) });
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

describe("review fixes", () => {
  const monitorPost = (calls: Array<{ url: string; method?: string }>) => calls.filter((c) => c.url === "/api/monitors" && c.method === "POST");

  it("repeat reminders: a policy with no channels gets the alert step's channels, one with channels keeps them", async () => {
    const d = draft({ alerts: { providerIds: [PROVIDER], repeatUntilAck: { enabled: true, repeatMinutes: 10 } } });
    const repeat = build(d).find((i) => i.kind === "repeat") as CreateItem;
    const empty = makeDeps({ getPolicy: jest.fn(async () => ({ success: true, data: { policy: { channelIds: [] } } })) });
    await runItem(repeat, empty.deps);
    expect(empty.deps.savePolicy).toHaveBeenCalledWith(PROJECT, expect.objectContaining({ channelIds: [PROVIDER], renotifyRepeatMinutes: 10 }));
    const kept = makeDeps();
    await runItem(repeat, kept.deps);
    expect(kept.deps.savePolicy).toHaveBeenCalledWith(PROJECT, expect.objectContaining({ channelIds: ["x"] }));
  });

  it("stops after a 429 wait when the lock was lost, without posting again", async () => {
    const heartbeat = jest.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
    const run = makeDeps({ sleep: async () => undefined, heartbeat });
    const base = run.deps.fetchJson;
    run.deps.fetchJson = jest.fn(async (url, init) => (url === "/api/monitors" && init?.method === "POST" ? { ok: false, status: 429, data: {} } : base(url, init)));
    const [item] = build(draft());
    expect(await runItem(item, run.deps)).toMatchObject({ status: "failed", error: TAKEN_OVER_ERROR });
    expect((run.deps.fetchJson as jest.Mock).mock.calls.filter(([u, i]) => u === "/api/monitors" && i?.method === "POST")).toHaveLength(1);
  });

  it("repeat reminders: drops deleted channels and retries once, noting when none remain", async () => {
    const d = draft({ alerts: { providerIds: [PROVIDER], repeatUntilAck: { enabled: true, repeatMinutes: 10 } } });
    const repeat = build(d).find((i) => i.kind === "repeat") as CreateItem;
    const empty = { ...(await makeDeps().deps.getPolicy("p")).data!.policy, channelIds: [] };
    const run = (live: Array<{ id: string }>) => {
      const m = makeDeps({
        getPolicy: jest.fn(async () => ({ success: true, data: { policy: empty } })) as never,
        savePolicy: jest.fn(async (_p: string, v: Record<string, unknown>) => ((v.channelIds as string[]).length ? { success: false, error: "Some channels do not belong to this project" } : { success: true })),
      });
      const base = m.deps.fetchJson;
      m.deps.fetchJson = jest.fn(async (url, init) => (url === "/api/notification-providers" ? ok(live) : base(url, init)));
      return m;
    };
    const none = run([]);
    expect(await runItem(repeat, none.deps)).toMatchObject({ status: "done", note: "Reminders have no channel: add one under Notifications" });
    expect(none.deps.savePolicy).toHaveBeenCalledTimes(2);
    expect(none.deps.savePolicy).toHaveBeenLastCalledWith(PROJECT, expect.objectContaining({ channelIds: [] }));
  });

  it("waits out a 429 with Retry-After (capped) and retries the same item", async () => {
    const sleeps: number[] = [];
    const notes: Array<string | undefined> = [];
    const run = makeDeps({ sleep: async (ms) => void sleeps.push(ms) });
    const base = run.deps.fetchJson;
    let limited = 2;
    run.deps.fetchJson = jest.fn(async (url, init) => {
      if (url === "/api/monitors" && init?.method === "POST" && limited-- > 0) return { ok: false, status: 429, data: { error: "Too many requests", retryAfter: 500 }, retryAfterSeconds: limited === 1 ? 7 : undefined };
      return base(url, init);
    });
    const [item] = build(draft());
    const result = await runItem(item, run.deps, {}, (p) => notes.push(p.note));
    expect(result.status).toBe("done");
    expect(sleeps).toEqual([7000, 60000]); // header first, then the body value capped at 60 s
    expect(notes).toContain(RATE_LIMIT_NOTE);
  });

  it("fails after the retries are used up", async () => {
    const run = makeDeps({ sleep: async () => undefined });
    const base = run.deps.fetchJson;
    run.deps.fetchJson = jest.fn(async (url, init) => (url === "/api/monitors" && init?.method === "POST" ? { ok: false, status: 429, data: { error: "Too many requests" } } : base(url, init)));
    const [item] = build(draft());
    expect(await runItem(item, run.deps)).toMatchObject({ status: "failed", error: "Too many requests" });
    expect(monitorPost(run.calls)).toHaveLength(0);
    expect((run.deps.fetchJson as jest.Mock).mock.calls.filter(([u, i]) => u === "/api/monitors" && i?.method === "POST")).toHaveLength(3);
  });

  it("an AI endpoint does not adopt the plain page monitor on the same URL, and a page does not adopt the AI one", async () => {
    const url = "https://api.example.com/v1/chat/completions";
    const d = draft({
      monitors: { pages: [{ url, name: "page" }], aiEndpoint: { name: "AI", url, model: "m", secretKey: "OPENAI_KEY" } },
    });
    const items = build(d);
    const plain = { id: "m-plain", type: "http_request", target: url, name: "page", config: {} };
    const ai = items.find((i) => i.kind === "ai_endpoint") as CreateItem;
    const withPlain = makeDeps({}, [plain]);
    expect((await runItem(ai, withPlain.deps)).status).toBe("done");
    const page = items.find((i) => i.kind === "http_request") as CreateItem;
    const withAi = makeDeps({}, [{ id: "m-ai", type: "http_request", target: url, name: "AI", config: { aiEndpoint: { model: "m" } } }]);
    expect((await runItem(page, withAi.deps)).status).toBe("done");
    expect(monitorPost(withAi.calls)).toHaveLength(1);
    const adopt = makeDeps({}, [{ id: "m-ai", type: "http_request", target: url, name: "AI", config: { aiEndpoint: { model: "m" } } }]);
    expect((await runItem(ai, adopt.deps)).status).toBe("adopted");
  });

  it("warnings on an AI endpoint set the default first-token threshold", () => {
    const d = draft({ alerts: { providerIds: [PROVIDER], warnings: true }, monitors: { pages: [], aiEndpoint: { name: "AI", url: "https://a.example.com/v1", model: "m", secretKey: "OPENAI_KEY" } } });
    expect((build(d)[0].payload as { config: { aiEndpoint: Record<string, unknown> } }).config.aiEndpoint.warnFirstTokenMs).toBe(3000);
    const off = draft({ monitors: d.monitors });
    expect((build(off)[0].payload as { config: { aiEndpoint: Record<string, unknown> } }).config.aiEndpoint).not.toHaveProperty("warnFirstTokenMs");
  });

  it("raises the interval to the plan minimum", () => {
    const items = build(draft({ monitors: { pages: [{ url: "https://app.example.com/", name: "a" }], frequencyMinutes: 1, heartbeat: { name: "hb", frequencyMinutes: 2 } } }), { minIntervalMinutes: 5 });
    expect(items.map((i) => (i.payload as { frequencyMinutes: number }).frequencyMinutes)).toEqual([5, 5]);
  });

  it("a network error is a retryable failure, not a project change, and a second concurrent run of an item is ignored", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const run = makeDeps();
    const base = run.deps.fetchJson;
    run.deps.fetchJson = jest.fn(async (url, init) => {
      if (url === "/api/monitors" && init?.method === "POST") await gate;
      return base(url, init);
    });
    const [item] = build(draft());
    const first = runItem(item, run.deps);
    expect((await runItem(item, run.deps)).status).toBe("running");
    release();
    expect((await first).status).toBe("done");
    const offline = makeDeps();
    offline.deps.fetchJson = jest.fn(async () => { throw new TypeError("Failed to fetch"); });
    expect(await runItem(item, offline.deps)).toMatchObject({ status: "failed", error: NETWORK_ERROR });
  });

  it("notes an existing status page that setup did not publish", async () => {
    const run = makeDeps({ getStatusPages: jest.fn(async () => ({ success: true, statusPages: [{ id: "sp-9", name: "Acme status" }] })) });
    const item = build(draft({ statusPage: { name: "Acme status", publish: true } })).find((i) => i.kind === "status_page") as CreateItem;
    expect(await runItem(item, run.deps)).toMatchObject({ status: "adopted", note: "Already there (publish it from Status pages)" });
  });
});
