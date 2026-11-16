import { AI_WARN_FIRST_TOKEN_DEFAULT_MS, warningKindsForMonitorType } from "@/lib/alerts/warning-kinds";
import { SETUP_LIMITS, type SetupDraft } from "@/lib/setup/draft-schema";
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

export type ItemKind = "website" | "http_request" | "heartbeat" | "ai_endpoint" | "mcp_server" | "status_page" | "component" | "repeat" | "requirement" | "service";

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
export const NETWORK_ERROR = "Network error. Check your connection and retry.";
export const RATE_LIMIT_NOTE = "Waiting for the rate limit...";
/** Longest wait for one 429 and how often an item is retried after it, so one item cannot stall the run. */
const MAX_RATE_LIMIT_WAIT_SECONDS = 60;
const MAX_RATE_LIMIT_RETRIES = 2;
// Exact text of the server error in lib/sre/notification-policy.ts.
const CHANNEL_NOT_IN_PROJECT = "Some channels do not belong to this project";
export const TAKEN_OVER_ERROR = "Another person took over setup";
/** Sent with every REST write so the server can refuse it when the active project is no longer this one. */
export const PROJECT_HEADER = "x-supercheck-project-id";

interface FetchResult {
  ok: boolean;
  status: number;
  data: unknown;
  /** Retry-After header in seconds, when the response had one. */
  retryAfterSeconds?: number;
}

type ActionResult = { success: boolean; message?: string; error?: string; [key: string]: unknown };

export interface RunnerDeps {
  setupProjectId: string;
  fetchJson: (url: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => Promise<FetchResult>;
  /** Re-claims the setup lock with this tab's token; false when another tab or person holds it now. */
  heartbeat?: () => Promise<boolean>;
  getComponents: (statusPageId: string) => Promise<{ success: boolean; components: Array<{ id: string; name: string; monitorIds: string[] }> }>;
  getStatusPages: () => Promise<{ success: boolean; statusPages: Array<{ id: string; name: string }> }>;
  createStatusPage: (data: { name: string }) => Promise<ActionResult & { statusPage?: { id: string } }>;
  publishStatusPage: (id: string) => Promise<ActionResult>;
  createComponent: (data: { statusPageId: string; name: string; monitorIds: string[] }) => Promise<ActionResult>;
  getPolicy: (projectId: string) => Promise<{ success: boolean; error?: string; data?: { policy: Record<string, unknown> } }>;
  savePolicy: (projectId: string, input: Record<string, unknown>) => Promise<ActionResult>;
  /** Persist an id into draft.created; resolves once saved. */
  recordCreated: (key: string, id: string) => Promise<void>;
  /** Only the recorded id and exact title: a full list is capped and would miss older requirements. */
  findRequirements: (query: { ids: string[]; titles: string[] }) => Promise<{ success: boolean; requirements: Array<{ id: string; title: string }> }>;
  createRequirement: (data: { title: string; description?: string }) => Promise<{ id: string; success: boolean; error?: string }>;
  getServices: () => Promise<{ success: boolean; services: Array<{ id: string; name: string }> }>;
  createService: (data: { name: string }) => Promise<ActionResult & { service?: { id: string } }>;
  getCreated: () => Record<string, string>;
  /** Test seam for the rate-limit wait. */
  sleep?: (ms: number) => Promise<void>;
}

/** Reports a progress note (rate-limit wait) while an item is running. */
type Progress = (result: Partial<ItemResult>) => void;

interface Lookup {
  monitors?: Array<{ id: string; type: string; target: string; name: string; config?: { aiEndpoint?: unknown } | null }>;
  statusPages?: Array<{ id: string; name: string }>;
  services?: Array<{ id: string; name: string }>;
}

function hash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i++) h = ((h << 5) + h + value.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export interface BuildOptions {
  skipped: readonly SetupStepKey[];
  features: Pick<SetupFeatures, "repeatUntilAck" | "warningAlerts" | "heartbeat" | "aiEndpoint" | "mcpMonitor"> & Partial<Pick<SetupFeatures, "aiTests" | "aiSre">>;
  canUpdateProject: boolean;
  /** test:create / sre_connector:configure; the server enforces them too. Default true. */
  canCreateTests?: boolean;
  canConfigureConnectors?: boolean;
  /** Shortest interval the org's plan allows (a trial rejects shorter ones); default 1. */
  minIntervalMinutes?: number;
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
  const minInterval = opts.minIntervalMinutes ?? 1;
  const frequencyMinutes = Math.max(draft.monitors?.frequencyMinutes ?? 5, minInterval);

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
      const beatEvery = Math.max(heartbeat.frequencyMinutes, minInterval);
      items.push({
        key: `monitor:heartbeat:${hash(heartbeat.name)}`,
        kind: "heartbeat",
        step: "monitors",
        label: heartbeat.name,
        detail: `Expects a ping every ${beatEvery} min`,
        payload: withAlerts(
          { name: heartbeat.name, type: "heartbeat", target: "", frequencyMinutes: beatEvery, config: { heartbeat: { graceMinutes: Math.max(1, Math.min(beatEvery, 60)) } } },
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
          { name: ai.name, type: "http_request", target: ai.url, frequencyMinutes, config: { aiEndpoint: { model: ai.model, secretKey: ai.secretKey, ...(warnings ? { warnFirstTokenMs: AI_WARN_FIRST_TOKEN_DEFAULT_MS } : {}) } } },
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
      payload: { repeatMinutes: repeat.repeatMinutes, providerIds: draft.alerts?.providerIds ?? [] },
    });
  }

  if (!skipped.includes("tests") && features.aiTests && opts.canCreateTests !== false) {
    // Keyed by title, not position, so reordering or unticking on a re-run keeps each id with its own title.
    for (const requirement of draft.tests?.requirements ?? []) {
      const key = `requirement:${hash(requirement.title)}`;
      if (items.some((item) => item.key === key)) continue;
      items.push({
        key,
        kind: "requirement",
        step: "tests",
        label: requirement.title,
        detail: requirement.description,
        payload: { title: requirement.title, ...(requirement.description ? { description: requirement.description } : {}) },
      });
    }
  }
  if (!skipped.includes("aiSre") && features.aiSre && opts.canConfigureConnectors !== false) {
    for (const service of draft.aiSre?.services ?? []) {
      items.push({ key: `service:${hash(service.name)}`, kind: "service", step: "aiSre", label: service.name, detail: "Service", payload: { name: service.name } });
    }
  }
  return items;
}

const projectFetch = (deps: RunnerDeps, url: string, init: { method?: string; body?: unknown } = {}) =>
  deps.fetchJson(url, { ...init, headers: { [PROJECT_HEADER]: deps.setupProjectId } });

async function listMonitors(deps: RunnerDeps, lookup: Lookup) {
  if (lookup.monitors) return lookup.monitors;
  const all: NonNullable<Lookup["monitors"]> = [];
  for (let page = 1; page <= 20; page++) {
    const res = await projectFetch(deps, `/api/monitors?limit=100&page=${page}`);
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

async function createRequirementItem(item: CreateItem, deps: RunnerDeps, lookup: Lookup): Promise<ItemResult> {
  const created = deps.getCreated()[item.key];
  const title = String(item.payload.title);
  const res = await deps.findRequirements({ ids: created ? [created] : [], titles: [title] });
  if (!res.success) throw new Error("Could not read requirements");
  const known = res.requirements;
  if (created) {
    return known.some((r) => r.id === created)
      ? { status: "adopted", note: "Already created" }
      : { status: "skipped", note: "Deleted since it was created, so it was not recreated" };
  }
  const natural = known.find((r) => r.title === title);
  if (natural) {
    await deps.recordCreated(item.key, natural.id);
    return { status: "adopted", note: "A requirement with this title already exists" };
  }
  const made = await deps.createRequirement({ title, description: item.payload.description as string | undefined });
  if (!made.success || !made.id) return { status: "failed", error: made.error ?? "Could not create the requirement" };
  await deps.recordCreated(item.key, made.id);
  return { status: "done" };
}

async function createServiceItem(item: CreateItem, deps: RunnerDeps, lookup: Lookup): Promise<ItemResult> {
  const created = deps.getCreated()[item.key];
  if (!lookup.services) {
    const res = await deps.getServices();
    if (!res.success) throw new Error("Could not read services");
    lookup.services = res.services;
  }
  const known = lookup.services;
  if (created) {
    return known.some((x) => x.id === created)
      ? { status: "adopted", note: "Already created" }
      : { status: "skipped", note: "Deleted since it was created, so it was not recreated" };
  }
  const name = String(item.payload.name);
  const natural = known.find((x) => x.name === name);
  if (natural) {
    await deps.recordCreated(item.key, natural.id);
    return { status: "adopted", note: "A service with this name already exists" };
  }
  const res = await deps.createService({ name });
  const id = res.service?.id;
  if (!res.success || !id) return { status: "failed", error: res.error ?? res.message ?? "Could not create the service" };
  known.push({ id, name });
  await deps.recordCreated(item.key, id);
  return { status: "done" };
}

const isMonitorKind = (kind: ItemKind) => ["website", "http_request", "heartbeat", "ai_endpoint", "mcp_server"].includes(kind);

export async function ensureProject(deps: Pick<RunnerDeps, "setupProjectId" | "fetchJson">): Promise<string | null> {
  try {
    const res = await deps.fetchJson("/api/context");
    // Only a readable answer naming another project is a mismatch; a failed lookup is not.
    if (!res.ok) return `Could not confirm the active project (HTTP ${res.status}). Retry.`;
    const id = (res.data as { project?: { id?: string } })?.project?.id;
    return id === deps.setupProjectId ? null : PROJECT_CHANGED_ERROR;
  } catch {
    return NETWORK_ERROR;
  }
}

const isNetworkFailure = (error: unknown) => error instanceof TypeError;

async function createMonitor(item: CreateItem, deps: RunnerDeps, lookup: Lookup, progress?: Progress): Promise<ItemResult> {
  const created = deps.getCreated()[item.key];
  const monitors = await listMonitors(deps, lookup);
  const payload = item.payload as { type: string; target: string; name: string };
  // An AI endpoint and a plain page can share a URL, so the AI preset is part of the natural key.
  const wantsAi = item.kind === "ai_endpoint";
  const natural = monitors.find((m) =>
    payload.type === "heartbeat"
      ? m.type === "heartbeat" && m.name === payload.name
      : m.type === payload.type && m.target === payload.target && Boolean(m.config?.aiEndpoint) === wantsAi,
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
  let res = await projectFetch(deps, "/api/monitors", { method: "POST", body: item.payload });
  // The create API allows 20 a minute and a run can add more, so wait out a 429 and retry the same item.
  for (let retry = 0; res.status === 429 && retry < MAX_RATE_LIMIT_RETRIES; retry++) {
    const bodyWait = Number((res.data as { retryAfter?: unknown } | null)?.retryAfter);
    const seconds = Math.min(MAX_RATE_LIMIT_WAIT_SECONDS, Math.max(1, res.retryAfterSeconds ?? (Number.isFinite(bodyWait) ? bodyWait : 15)));
    progress?.({ status: "running", note: RATE_LIMIT_NOTE });
    await (deps.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms))))(seconds * 1000);
    progress?.({ status: "running", note: undefined });
    // The wait can outlast the lock, so ask directly (not the throttled wrapper) before writing again.
    if (deps.heartbeat && !(await deps.heartbeat())) return { status: "failed", error: TAKEN_OVER_ERROR };
    res = await projectFetch(deps, "/api/monitors", { method: "POST", body: item.payload });
  }
  if (!res.ok) return { status: "failed", error: errorText(res.data, "Could not create the monitor") };
  const body = res.data as { id: string; heartbeat?: { pingUrl?: string } };
  lookup.monitors?.push({ id: body.id, type: payload.type, target: payload.target, name: payload.name, config: item.kind === "ai_endpoint" ? { aiEndpoint: true } : null });
  await deps.recordCreated(item.key, body.id);
  return { status: "done", pingUrl: body.heartbeat?.pingUrl };
}

const PUBLISH_KEY = "statuspage:publish";

async function publishOnce(id: string, deps: RunnerDeps): Promise<ItemResult | null> {
  const published = await deps.publishStatusPage(id);
  if (!published.success) return { status: "failed", error: `Created as a draft; publishing failed: ${published.message ?? "unknown error"}` };
  await deps.recordCreated(PUBLISH_KEY, id);
  return null;
}

async function createStatusPageItem(item: CreateItem, deps: RunnerDeps, lookup: Lookup): Promise<ItemResult> {
  const created = deps.getCreated()[item.key];
  const pages = await listStatusPages(deps, lookup);
  if (created) {
    if (!pages.some((p) => p.id === created)) return { status: "skipped", note: "Deleted since it was created, so it was not recreated" };
    // Publish is its own recorded step, so a publish that failed after the create is retried here.
    if (item.payload.publish && !deps.getCreated()[PUBLISH_KEY]) {
      const failed = await publishOnce(created, deps);
      return failed ?? { status: "done", note: "Published" };
    }
    return { status: "adopted", note: "Already created" };
  }
  const name = String(item.payload.name);
  const natural = pages.find((p) => p.name === name);
  if (natural) {
    await deps.recordCreated(item.key, natural.id);
    // An existing page is never published by setup.
    await deps.recordCreated(PUBLISH_KEY, natural.id);
    return { status: "adopted", note: item.payload.publish ? "Already there (publish it from Status pages)" : "A status page with this name already exists" };
  }
  const res = await deps.createStatusPage({ name });
  const id = res.statusPage?.id;
  if (!res.success || !id) return { status: "failed", error: res.message ?? "Could not create the status page" };
  lookup.statusPages?.push({ id, name });
  await deps.recordCreated(item.key, id);
  if (item.payload.publish) {
    const failed = await publishOnce(id, deps);
    if (failed) return failed;
  }
  return { status: "done" };
}

async function createComponentItem(item: CreateItem, deps: RunnerDeps, lookup: Lookup): Promise<ItemResult> {
  const created = deps.getCreated();
  if (created[item.key]) return { status: "adopted", note: "Already created" };
  const statusPageId = created.statuspage;
  const monitorId = item.monitorKey ? created[item.monitorKey] : undefined;
  if (!statusPageId) return { status: "skipped", note: "The status page was not created" };
  if (!monitorId) return { status: "skipped", note: "The monitor was not created" };
  // A monitor or page deleted since it was created can never succeed, so it is not a failure.
  if (!(await listMonitors(deps, lookup)).some((m) => m.id === monitorId)) return { status: "skipped", note: "The monitor was deleted" };
  if (!(await listStatusPages(deps, lookup)).some((p) => p.id === statusPageId)) return { status: "skipped", note: "The status page was deleted" };
  const name = String(item.payload.name);
  // Adopt only a component that already carries this monitor; a same-name one for another monitor is not ours.
  const existing = await deps.getComponents(statusPageId);
  if (!existing.success) return { status: "failed", error: "Could not read the status page components" };
  const natural = existing.components.find((c) => c.monitorIds.includes(monitorId));
  if (natural) {
    await deps.recordCreated(item.key, natural.id);
    return { status: "adopted", note: "A matching component already exists" };
  }
  const res = await deps.createComponent({ statusPageId, name, monitorIds: [monitorId] });
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
  // Reminders go only to the policy's channels, so a policy with none gets this run's alert channels; existing ones are kept.
  const existing = Array.isArray(policy.channelIds) ? (policy.channelIds as string[]) : [];
  const setupChannels = Array.isArray(item.payload.providerIds) ? (item.payload.providerIds as string[]).slice(0, SETUP_LIMITS.maxChannels) : [];
  // Merge only the reminder fields; escalation stays as it is.
  const save = (channelIds: string[]) =>
    deps.savePolicy(deps.setupProjectId, {
      channelIds,
      emailServiceOwnersOnSev12: policy.emailServiceOwnersOnSev12,
      renotifyUnackedMinutes: minutes,
      renotifyRepeatMinutes: minutes,
      renotifyMax: policy.renotifyMax,
      escalateAfterMinutes: policy.escalateAfterMinutes,
      escalateChannelId: policy.escalateChannelId,
      escalateUserId: policy.escalateUserId,
      autoInvestigateOnOpen: policy.autoInvestigateOnOpen,
    });
  const channelIds = existing.length > 0 ? existing : setupChannels;
  let saved = await save(channelIds);
  let note: string | undefined;
  // A channel deleted since the draft was made fails the save; keep only the ones that still exist and retry once.
  if (!saved.success && existing.length === 0 && setupChannels.length > 0 && saved.error === CHANNEL_NOT_IN_PROJECT) {
    const res = await projectFetch(deps, "/api/notification-providers");
    if (res.ok && Array.isArray(res.data)) {
      const live = new Set((res.data as Array<{ id: string }>).map((row) => row.id));
      const remaining = setupChannels.filter((id) => live.has(id));
      saved = await save(remaining);
      if (saved.success && remaining.length === 0) note = "Reminders have no channel: add one under Notifications";
    }
  }
  if (!saved.success) return { status: "failed", error: saved.error ?? "Could not save the notification policy" };
  await deps.recordCreated(item.key, deps.setupProjectId);
  return note ? { status: "done", note } : { status: "done" };
}

const HEARTBEAT_MIN_GAP_MS = 30_000;
const lastBeat = new WeakMap<() => Promise<boolean>, number>();

/** The lock route allows 12 claims a minute, so ownership is re-checked at most every 30 s (and before the first item). */
async function throttledHeartbeat(beat: () => Promise<boolean>): Promise<boolean> {
  const last = lastBeat.get(beat);
  if (last !== undefined && Date.now() - last < HEARTBEAT_MIN_GAP_MS) return true;
  const ok = await beat();
  if (ok) lastBeat.set(beat, Date.now());
  return ok;
}

const inFlight = new Set<string>();

/** Run one item. Never throws: a failure becomes `{ status: "failed" }`. A second concurrent run of the same item is ignored. */
export async function runItem(item: CreateItem, deps: RunnerDeps, lookup: Lookup = {}, progress?: Progress): Promise<ItemResult> {
  const guard = `${deps.setupProjectId}:${item.key}`;
  if (inFlight.has(guard)) return { status: "running" };
  inFlight.add(guard);
  try {
    // A takeover by another person must stop this run before it writes anything more.
    if (deps.heartbeat && !(await throttledHeartbeat(deps.heartbeat))) return { status: "failed", error: TAKEN_OVER_ERROR };
    const changed = await ensureProject(deps);
    if (changed) return { status: "failed", error: changed };
    if (isMonitorKind(item.kind)) return await createMonitor(item, deps, lookup, progress);
    if (item.kind === "status_page") return await createStatusPageItem(item, deps, lookup);
    if (item.kind === "component") return await createComponentItem(item, deps, lookup);
    if (item.kind === "requirement") return await createRequirementItem(item, deps, lookup);
    if (item.kind === "service") return await createServiceItem(item, deps, lookup);
    return await saveRepeat(item, deps);
  } catch (error) {
    return { status: "failed", error: isNetworkFailure(error) ? NETWORK_ERROR : error instanceof Error ? error.message : "Something went wrong" };
  } finally {
    inFlight.delete(guard);
  }
}

const STOPPING_ERRORS = [PROJECT_CHANGED_ERROR, TAKEN_OVER_ERROR];

/** Run items in order. Stops at "Project changed in another tab" or a lock takeover; other failures (including a network error) do not stop the run. */
export async function runAll(
  items: CreateItem[],
  deps: RunnerDeps,
  onUpdate: (key: string, result: ItemResult) => void,
  shouldRun: (key: string) => boolean = () => true,
): Promise<void> {
  const lookup: Lookup = {};
  for (const item of items) {
    if (!shouldRun(item.key)) continue;
    onUpdate(item.key, { status: "running", error: undefined, note: undefined });
    const result = await runItem(item, deps, lookup, (partial) => onUpdate(item.key, { status: "running", ...partial }));
    // A duplicate run reports "running" and the run that owns the item delivers the final result.
    if (result.status !== "running") onUpdate(item.key, { note: undefined, ...result });
    if (result.error && STOPPING_ERRORS.includes(result.error)) return;
  }
}

/**
 * Retry one item. When a monitor or the status page succeeds, the components that were skipped
 * because it had failed are run again, so one Retry heals the whole chain.
 */
export async function retryWithDependents(
  item: CreateItem,
  items: CreateItem[],
  deps: RunnerDeps,
  onUpdate: (key: string, result: ItemResult) => void,
  isSkipped: (key: string) => boolean,
): Promise<void> {
  const lookup: Lookup = {};
  onUpdate(item.key, { status: "running", error: undefined, note: undefined });
  const result = await runItem(item, deps, lookup, (partial) => onUpdate(item.key, { status: "running", ...partial }));
  if (result.status === "running") return;
  onUpdate(item.key, { note: undefined, ...result });
  if (result.status !== "done" && result.status !== "adopted") return;
  const dependents = items.filter(
    (other) => other.kind === "component" && isSkipped(other.key) && (item.kind === "status_page" || other.monitorKey === item.key),
  );
  for (const dependent of dependents) {
    onUpdate(dependent.key, { status: "running", error: undefined, note: undefined });
    const next = await runItem(dependent, deps, lookup);
    if (next.status !== "running") onUpdate(dependent.key, { note: undefined, ...next });
    if (next.error && STOPPING_ERRORS.includes(next.error)) return;
  }
}
