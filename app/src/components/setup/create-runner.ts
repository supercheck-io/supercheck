import { warningKindsForMonitorType } from "@/lib/alerts/warning-kinds";
import type { SetupDraft } from "@/lib/setup/draft-schema";
import type { SetupFeatures } from "@/lib/setup/features";
import type { SetupStepKey } from "@/lib/setup/persona";

/**
 * Review and create (spec D7, D10, D11). One existing route or action call per item, run one at
 * a time. Before every item the active project is checked, and an item already recorded in
 * `draft.created` is adopted, never recreated. Fetchers are injected so the runner has no
 * dependency on the browser or on server-only modules.
 */

export type ItemStatus = "pending" | "running" | "done" | "adopted" | "skipped" | "failed";

export interface ItemResult {
  status: ItemStatus;
  error?: string;
  /** Heartbeat ping URL from the create response. Held in memory only, never in the draft. */
  pingUrl?: string;
  /** Explains a skipped or adopted item. */
  note?: string;
}

export type ItemKind = "website" | "http_request" | "heartbeat" | "ai_endpoint" | "mcp_server" | "status_page" | "component" | "repeat";

export interface CreateItem {
  key: string;
  kind: ItemKind;
  step: SetupStepKey;
  label: string;
  detail?: string;
  /** Monitor create body, status page name, etc. */
  payload: Record<string, unknown>;
  /** component items: key of the monitor item whose created id they show. */
  monitorKey?: string;
}

export const PROJECT_CHANGED_ERROR = "Project changed in another tab";

interface FetchResult {
  ok: boolean;
  status: number;
  data: unknown;
}

type ActionResult = { success: boolean; message?: string; error?: string; [key: string]: unknown };

export interface RunnerDeps {
  setupProjectId: string;
  fetchJson: (url: string, init?: { method?: string; body?: unknown }) => Promise<FetchResult>;
  getStatusPages: () => Promise<{ success: boolean; statusPages: Array<{ id: string; name: string }> }>;
  createStatusPage: (data: { name: string }) => Promise<ActionResult & { statusPage?: { id: string } }>;
  publishStatusPage: (id: string) => Promise<ActionResult>;
  createComponent: (data: { statusPageId: string; name: string; monitorIds: string[] }) => Promise<ActionResult>;
  getPolicy: (projectId: string) => Promise<{ success: boolean; error?: string; data?: { policy: Record<string, unknown> } }>;
  savePolicy: (projectId: string, input: Record<string, unknown>) => Promise<ActionResult>;
  /** Persist an id into draft.created; resolves once saved. */
  recordCreated: (key: string, id: string) => Promise<void>;
  getCreated: () => Record<string, string>;
}

interface Lookup {
  monitors?: Array<{ id: string; type: string; target: string; name: string }>;
  statusPages?: Array<{ id: string; name: string }>;
}

function hash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i++) h = ((h << 5) + h + value.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export interface BuildOptions {
  skipped: readonly SetupStepKey[];
  features: Pick<SetupFeatures, "repeatUntilAck" | "warningAlerts" | "heartbeat" | "aiEndpoint" | "mcpMonitor">;
  canUpdateProject: boolean;
}

function errorText(data: unknown, fallback: string): string {
  const body = (data ?? {}) as { error?: unknown; details?: unknown };
  const details = typeof body.details === "string" ? body.details : "";
  const main = typeof body.error === "string" ? body.error : fallback;
  return details ? `${main}: ${details}` : main;
}

/** Items to create, in order, from the draft. A skipped step or a flag that is off adds nothing. */
export function buildCreateItems(draft: SetupDraft, opts: BuildOptions): CreateItem[] {
  const { skipped, features } = opts;
  const items: CreateItem[] = [];
  const providerIds = skipped.includes("alerts") ? [] : (draft.alerts?.providerIds ?? []);
  const warnings = Boolean(features.warningAlerts && draft.alerts?.warnings && providerIds.length);
  const frequencyMinutes = draft.monitors?.frequencyMinutes ?? 5;

  const alertConfig = (type: string, extra: { ssl?: boolean; aiEndpoint?: boolean } = {}) => {
    if (providerIds.length === 0) return undefined;
    const kinds = warnings ? warningKindsForMonitorType(type, { aiEndpoint: extra.aiEndpoint }) : [];
    return {
      enabled: true,
      notificationProviders: providerIds,
      alertOnFailure: true,
      alertOnRecovery: true,
      ...(extra.ssl ? { alertOnSslExpiration: true } : {}),
      failureThreshold: 1,
      recoveryThreshold: 1,
      ...(kinds.length ? { warnings: Object.fromEntries(kinds.map((kind) => [kind, true])) } : {}),
    };
  };
  const withAlerts = (body: Record<string, unknown>, alerts: ReturnType<typeof alertConfig>) =>
    alerts ? { ...body, alertConfig: alerts } : body;

  if (!skipped.includes("monitors")) {
    for (const page of draft.monitors?.pages ?? []) {
      const homepage = new URL(page.url).pathname === "/";
      const kind: ItemKind = homepage ? "website" : "http_request";
      items.push({
        key: `monitor:${kind}:${hash(page.url)}`,
        kind,
        step: "monitors",
        label: page.name,
        detail: page.url,
        payload: withAlerts(
          {
            name: page.name,
            type: kind,
            target: page.url,
            frequencyMinutes,
            config: homepage
              ? { enableSslCheck: true }
              : { method: "GET", expectedStatusCodes: "200-299", timeoutSeconds: 30 },
          },
          alertConfig(kind, { ssl: homepage }),
        ),
      });
    }
    const heartbeat = features.heartbeat ? draft.monitors?.heartbeat : undefined;
    if (heartbeat) {
      items.push({
        key: `monitor:heartbeat:${hash(heartbeat.name)}`,
        kind: "heartbeat",
        step: "monitors",
        label: heartbeat.name,
        detail: `Expects a ping every ${heartbeat.frequencyMinutes} min`,
        payload: withAlerts(
          { name: heartbeat.name, type: "heartbeat", target: "", frequencyMinutes: heartbeat.frequencyMinutes, config: { heartbeat: { graceMinutes: Math.max(1, Math.min(heartbeat.frequencyMinutes, 60)) } } },
          alertConfig("heartbeat"),
        ),
      });
    }
    const ai = features.aiEndpoint ? draft.monitors?.aiEndpoint : undefined;
    if (ai) {
      items.push({
        key: `monitor:ai_endpoint:${hash(ai.url)}`,
        kind: "ai_endpoint",
        step: "monitors",
        label: ai.name,
        detail: ai.url,
        payload: withAlerts(
          { name: ai.name, type: "http_request", target: ai.url, frequencyMinutes, config: { aiEndpoint: { model: ai.model, secretKey: ai.secretKey } } },
          alertConfig("http_request", { aiEndpoint: true }),
        ),
      });
    }
    const mcp = features.mcpMonitor ? draft.monitors?.mcpMonitor : undefined;
    if (mcp) {
      items.push({
        key: `monitor:mcp_server:${hash(mcp.url)}`,
        kind: "mcp_server",
        step: "monitors",
        label: mcp.name,
        detail: mcp.url,
        payload: withAlerts(
          {
            name: mcp.name,
            type: "mcp_server",
            target: mcp.url,
            frequencyMinutes,
            config: { mcp: { auth: mcp.secretKey ? { type: "bearer", secretKey: mcp.secretKey } : { type: "none" } } },
          },
          alertConfig("mcp_server"),
        ),
      });
    }
  }

  const statusPage = draft.statusPage;
  if (!skipped.includes("statusPage") && statusPage?.name && !statusPage.optOut) {
    items.push({
      key: "statuspage",
      kind: "status_page",
      step: "statusPage",
      label: statusPage.name,
      detail: statusPage.publish ? "Published" : "Draft",
      payload: { name: statusPage.name, publish: Boolean(statusPage.publish) },
    });
    for (const monitor of items.filter((item) => item.step === "monitors")) {
      items.push({
        key: `component:${monitor.key}`,
        kind: "component",
        step: "statusPage",
        label: `Component: ${monitor.label}`,
        payload: { name: monitor.label.slice(0, 100) },
        monitorKey: monitor.key,
      });
    }
  }

  const repeat = draft.alerts?.repeatUntilAck;
  if (!skipped.includes("alerts") && features.repeatUntilAck && opts.canUpdateProject && repeat?.enabled) {
    items.push({
      key: "policy:repeat",
      kind: "repeat",
      step: "alerts",
      label: "Repeat until acknowledged",
      detail: `Every ${repeat.repeatMinutes} min`,
      payload: { repeatMinutes: repeat.repeatMinutes },
    });
  }
  return items;
}

async function listMonitors(deps: RunnerDeps, lookup: Lookup) {
  if (lookup.monitors) return lookup.monitors;
  const all: NonNullable<Lookup["monitors"]> = [];
  for (let page = 1; page <= 20; page++) {
    const res = await deps.fetchJson(`/api/monitors?limit=100&page=${page}`);
    if (!res.ok) throw new Error(errorText(res.data, "Could not read monitors"));
    const body = res.data as { data?: typeof all; pagination?: { hasNextPage?: boolean } };
    all.push(...(body.data ?? []));
    if (!body.pagination?.hasNextPage) break;
  }
  lookup.monitors = all;
  return all;
}

async function listStatusPages(deps: RunnerDeps, lookup: Lookup) {
  if (lookup.statusPages) return lookup.statusPages;
  const res = await deps.getStatusPages();
  if (!res.success) throw new Error("Could not read status pages");
  lookup.statusPages = res.statusPages;
  return res.statusPages;
}

const isMonitorKind = (kind: ItemKind) => ["website", "http_request", "heartbeat", "ai_endpoint", "mcp_server"].includes(kind);

async function ensureProject(deps: RunnerDeps): Promise<string | null> {
  try {
    const res = await deps.fetchJson("/api/context");
    const id = (res.data as { project?: { id?: string } })?.project?.id;
    return res.ok && id === deps.setupProjectId ? null : PROJECT_CHANGED_ERROR;
  } catch {
    return PROJECT_CHANGED_ERROR;
  }
}

async function createMonitor(item: CreateItem, deps: RunnerDeps, lookup: Lookup): Promise<ItemResult> {
  const created = deps.getCreated()[item.key];
  const monitors = await listMonitors(deps, lookup);
  const payload = item.payload as { type: string; target: string; name: string };
  const natural = monitors.find((m) =>
    payload.type === "heartbeat"
      ? m.type === "heartbeat" && m.name === payload.name
      : m.type === payload.type && m.target === payload.target,
  );
  if (created) {
    return monitors.some((m) => m.id === created)
      ? { status: "adopted", note: "Already created" }
      : { status: "skipped", note: "Deleted since it was created, so it was not recreated" };
  }
  if (natural) {
    await deps.recordCreated(item.key, natural.id);
    return { status: "adopted", note: "A matching monitor already exists" };
  }
  const res = await deps.fetchJson("/api/monitors", { method: "POST", body: item.payload });
  if (!res.ok) return { status: "failed", error: errorText(res.data, "Could not create the monitor") };
  const body = res.data as { id: string; heartbeat?: { pingUrl?: string } };
  await deps.recordCreated(item.key, body.id);
  return { status: "done", pingUrl: body.heartbeat?.pingUrl };
}

async function createStatusPageItem(item: CreateItem, deps: RunnerDeps, lookup: Lookup): Promise<ItemResult> {
  const created = deps.getCreated()[item.key];
  const pages = await listStatusPages(deps, lookup);
  if (created) {
    return pages.some((p) => p.id === created)
      ? { status: "adopted", note: "Already created" }
      : { status: "skipped", note: "Deleted since it was created, so it was not recreated" };
  }
  const name = String(item.payload.name);
  const natural = pages.find((p) => p.name === name);
  if (natural) {
    await deps.recordCreated(item.key, natural.id);
    return { status: "adopted", note: "A status page with this name already exists" };
  }
  const res = await deps.createStatusPage({ name });
  const id = res.statusPage?.id;
  if (!res.success || !id) return { status: "failed", error: res.message ?? "Could not create the status page" };
  await deps.recordCreated(item.key, id);
  if (item.payload.publish) {
    const published = await deps.publishStatusPage(id);
    if (!published.success) return { status: "failed", error: `Created as a draft; publishing failed: ${published.message ?? "unknown error"}` };
  }
  return { status: "done" };
}

async function createComponentItem(item: CreateItem, deps: RunnerDeps): Promise<ItemResult> {
  const created = deps.getCreated();
  if (created[item.key]) return { status: "adopted", note: "Already created" };
  const statusPageId = created.statuspage;
  const monitorId = item.monitorKey ? created[item.monitorKey] : undefined;
  if (!statusPageId) return { status: "skipped", note: "The status page was not created" };
  if (!monitorId) return { status: "skipped", note: "The monitor was not created" };
  const res = await deps.createComponent({ statusPageId, name: String(item.payload.name), monitorIds: [monitorId] });
  const component = res.component as { id?: string } | undefined;
  if (!res.success) return { status: "failed", error: res.message ?? "Could not create the component" };
  await deps.recordCreated(item.key, component?.id ?? statusPageId);
  return { status: "done" };
}

async function saveRepeat(item: CreateItem, deps: RunnerDeps): Promise<ItemResult> {
  if (deps.getCreated()[item.key]) return { status: "adopted", note: "Already saved" };
  const current = await deps.getPolicy(deps.setupProjectId);
  if (!current.success || !current.data) return { status: "failed", error: current.error ?? "Could not read the notification policy" };
  const { policy } = current.data;
  const minutes = Number(item.payload.repeatMinutes);
  // Merge only the reminder fields; channels and escalation stay as they are.
  const saved = await deps.savePolicy(deps.setupProjectId, {
    channelIds: policy.channelIds,
    emailServiceOwnersOnSev12: policy.emailServiceOwnersOnSev12,
    renotifyUnackedMinutes: minutes,
    renotifyRepeatMinutes: minutes,
    renotifyMax: policy.renotifyMax,
    escalateAfterMinutes: policy.escalateAfterMinutes,
    escalateChannelId: policy.escalateChannelId,
    escalateUserId: policy.escalateUserId,
    autoInvestigateOnOpen: policy.autoInvestigateOnOpen,
  });
  if (!saved.success) return { status: "failed", error: saved.error ?? "Could not save the notification policy" };
  await deps.recordCreated(item.key, deps.setupProjectId);
  return { status: "done" };
}

/** Run one item. Never throws: a failure becomes `{ status: "failed" }`. */
export async function runItem(item: CreateItem, deps: RunnerDeps, lookup: Lookup = {}): Promise<ItemResult> {
  try {
    const changed = await ensureProject(deps);
    if (changed) return { status: "failed", error: changed };
    if (isMonitorKind(item.kind)) return await createMonitor(item, deps, lookup);
    if (item.kind === "status_page") return await createStatusPageItem(item, deps, lookup);
    if (item.kind === "component") return await createComponentItem(item, deps);
    return await saveRepeat(item, deps);
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : "Something went wrong" };
  }
}

/** Run items in order. Stops at "Project changed in another tab"; other failures do not stop the run. */
export async function runAll(
  items: CreateItem[],
  deps: RunnerDeps,
  onUpdate: (key: string, result: ItemResult) => void,
  shouldRun: (key: string) => boolean = () => true,
): Promise<void> {
  const lookup: Lookup = {};
  for (const item of items) {
    if (!shouldRun(item.key)) continue;
    onUpdate(item.key, { status: "running" });
    const result = await runItem(item, deps, lookup);
    onUpdate(item.key, result);
    if (result.error === PROJECT_CHANGED_ERROR) return;
  }
}
