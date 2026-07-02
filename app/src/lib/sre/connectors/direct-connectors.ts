import crypto from "node:crypto";

import {
  DEFAULT_CONNECTOR_OUTPUT_LIMITS,
  hashConnectorPayload,
  type Connector,
  type ConnectorDefinition,
  type ConnectorEvidenceItem,
  type ConnectorMetadata,
  type ConnectorSearchParams,
  type ConnectorType,
  type ConnectorValidationResult,
} from "./connector-base";

type DirectConnectorCredential = {
  secret?: string | null;
  apiKey?: string | null;
  applicationKey?: string | null;
  sessionToken?: string | null;
  region?: string | null;
};

type DirectConnectorOptions = ConnectorDefinition & {
  endpointUrl?: string | null;
  credential?: DirectConnectorCredential | null;
};

type FetchJsonOptions = {
  url: string;
  secret?: string | null;
  timeoutMs: number;
  headers?: HeadersInit;
};

async function fetchJson({ url, secret, timeoutMs, headers = {} }: FetchJsonOptions): Promise<unknown> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      ...headers,
    },
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error(`credentials rejected with HTTP ${response.status}`);
  }

  if (!response.ok) {
    throw new Error(`request failed with HTTP ${response.status}`);
  }

  return response.json();
}

async function fetchOk({ url, secret, timeoutMs, headers = {} }: FetchJsonOptions): Promise<void> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "text/plain, application/json",
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      ...headers,
    },
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error(`credentials rejected with HTTP ${response.status}`);
  }

  if (!response.ok) {
    throw new Error(`request failed with HTTP ${response.status}`);
  }
}

function safeEndpoint(endpointUrl: string | null | undefined) {
  if (!endpointUrl) return null;
  return endpointUrl.replace(/\/$/, "");
}

function evidenceId(connectorId: string, sourceUri: string, title: string) {
  return `connector_${hashConnectorPayload({ connectorId, sourceUri, title }).slice(0, 24)}`;
}

function dateFromUnixNs(value: string | number | undefined, fallback: Date) {
  if (typeof value !== "string" && typeof value !== "number") return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;

  return new Date(Math.floor(numeric / 1_000_000));
}

function severityFromLogLine(value: string) {
  const lowered = value.toLowerCase();
  if (lowered.includes("fatal") || lowered.includes("panic") || lowered.includes("critical")) return "critical";
  if (lowered.includes("error") || lowered.includes("exception")) return "error";
  if (lowered.includes("warn")) return "warning";
  if (lowered.includes("info")) return "info";
  return undefined;
}

function sourceString(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);

    const nested = key.split(".").reduce<unknown>((current, part) => {
      if (current && typeof current === "object" && !Array.isArray(current)) {
        return (current as Record<string, unknown>)[part];
      }

      return undefined;
    }, source);
    if (typeof nested === "string" && nested.trim()) return nested.trim();
    if (typeof nested === "number" || typeof nested === "boolean") return String(nested);
  }

  return null;
}

function awsAmzDate(date = new Date()) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function awsDateStamp(amzDate: string) {
  return amzDate.slice(0, 8);
}

function hmac(key: crypto.BinaryLike | crypto.KeyObject, value: string) {
  return crypto.createHmac("sha256", key).update(value).digest();
}

function sha256Hex(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function awsEncode(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function cloudWatchRegion(endpointUrl: string, configuredRegion?: string | null) {
  if (configuredRegion?.trim()) return configuredRegion.trim();

  const host = new URL(endpointUrl).hostname;
  const match = host.match(/^monitoring(?:-fips)?[.-]([a-z0-9-]+)\./);
  return match?.[1] ?? "us-east-1";
}

function xmlDecode(value: string | undefined) {
  if (!value) return "";
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function xmlText(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return xmlDecode(match?.[1]);
}

function xmlBlocks(xml: string, tag: string) {
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;
  const blocks: string[] = [];
  let cursor = 0;

  while (cursor < xml.length) {
    const start = xml.indexOf(openTag, cursor);
    if (start === -1) break;

    let depth = 1;
    let searchFrom = start + openTag.length;

    while (depth > 0) {
      const nextOpen = xml.indexOf(openTag, searchFrom);
      const nextClose = xml.indexOf(closeTag, searchFrom);
      if (nextClose === -1) break;

      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth += 1;
        searchFrom = nextOpen + openTag.length;
        continue;
      }

      depth -= 1;
      if (depth === 0) {
        blocks.push(xml.slice(start + openTag.length, nextClose));
        cursor = nextClose + closeTag.length;
        break;
      }

      searchFrom = nextClose + closeTag.length;
    }

    if (depth > 0) break;
  }

  return blocks;
}

function xmlMemberValues(xml: string, containerTag: string) {
  const container = xmlText(xml, containerTag) ? xmlBlocks(xml, containerTag)[0] : "";
  return container ? xmlBlocks(container, "member").map((block) => xmlDecode(block)) : [];
}

function cloudWatchSeverity(state: string) {
  if (state === "ALARM") return "critical";
  if (state === "INSUFFICIENT_DATA") return "warning";
  if (state === "OK") return "info";
  return undefined;
}

function stringValue(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function tempoAttributeValue(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const attributeValue = value as Record<string, unknown>;
  return stringValue(attributeValue.stringValue)
    ?? stringValue(attributeValue.intValue)
    ?? stringValue(attributeValue.doubleValue)
    ?? stringValue(attributeValue.boolValue)
    ?? stringValue(attributeValue.arrayValue);
}

function tempoTraceHasError(trace: unknown) {
  const serialized = JSON.stringify(trace).toLowerCase();
  return serialized.includes("\"status\"") && serialized.includes("error");
}

function durationSummary(durationMs: unknown) {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) return null;
  if (durationMs >= 1000) return `${(durationMs / 1000).toFixed(2)}s`;
  return `${Math.round(durationMs)}ms`;
}

function isTraceQlQuery(query: string) {
  const trimmed = query.trim();
  return trimmed.startsWith("{") || trimmed.includes("&&") || trimmed.includes("||") || trimmed.includes("|");
}

function normalizeTempoSearchQuery(query: string) {
  const trimmed = query.trim();
  if (!trimmed || trimmed === "*") {
    return { tags: "" };
  }

  if (isTraceQlQuery(trimmed)) {
    return { q: trimmed };
  }

  const tags: string[] = [];
  let minDuration: string | undefined;
  let maxDuration: string | undefined;

  for (const token of trimmed.split(/\s+/).filter(Boolean)) {
    const separator = token.indexOf(":");
    if (separator === -1) {
      tags.push(token.includes("=") ? token : `service.name=${token}`);
      continue;
    }

    const key = token.slice(0, separator).trim();
    const value = token.slice(separator + 1).trim();
    if (!key || !value) continue;

    const normalizedKey = key.toLowerCase();
    if (normalizedKey === "minduration") {
      minDuration = value;
    } else if (normalizedKey === "maxduration") {
      maxDuration = value;
    } else if (normalizedKey === "service") {
      tags.push(`service.name=${value}`);
    } else if (normalizedKey === "operation") {
      tags.push(`name=${value}`);
    } else {
      tags.push(`${key}=${value}`);
    }
  }

  return {
    tags: tags.join(" "),
    minDuration,
    maxDuration,
  };
}

abstract class BaseDirectConnector implements Connector {
  id: string;
  type: ConnectorType;
  riskLevel: ConnectorDefinition["riskLevel"];
  permissionLevel: ConnectorDefinition["permissionLevel"];
  sideEffectLevel: ConnectorDefinition["sideEffectLevel"];
  surfaces: ConnectorDefinition["surfaces"];
  evidenceTypes: ConnectorDefinition["evidenceTypes"];
  requires: ConnectorDefinition["requires"];
  status: ConnectorDefinition["status"];
  scopedServiceIds: string[];
  defaultTimeWindowMinutes: number;
  outputLimits: ConnectorDefinition["outputLimits"];
  protected readonly endpointUrl: string | null;
  protected readonly credential: DirectConnectorCredential | null;

  constructor(options: DirectConnectorOptions) {
    this.id = options.id;
    this.type = options.type;
    this.riskLevel = options.riskLevel;
    this.permissionLevel = options.permissionLevel;
    this.sideEffectLevel = options.sideEffectLevel;
    this.surfaces = options.surfaces;
    this.evidenceTypes = options.evidenceTypes;
    this.requires = options.requires;
    this.status = options.status;
    this.scopedServiceIds = options.scopedServiceIds;
    this.defaultTimeWindowMinutes = options.defaultTimeWindowMinutes;
    this.outputLimits = options.outputLimits;
    this.endpointUrl = safeEndpoint(options.endpointUrl);
    this.credential = options.credential ?? null;
  }

  abstract search(params: ConnectorSearchParams): Promise<ConnectorEvidenceItem[]>;
  abstract metadata(): ConnectorMetadata;

  async validate(): Promise<ConnectorValidationResult> {
    const startedAt = Date.now();

    try {
      await this.validationRequest();
      return { status: "valid", latencyMs: Date.now() - startedAt };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Connector validation failed";
      const lowerMessage = message.toLowerCase();
      return {
        status: lowerMessage.includes("credentials rejected") || lowerMessage.includes("invalid credentials") ? "invalid_credentials" : "unreachable",
        message,
        latencyMs: Date.now() - startedAt,
      };
    }
  }

  protected abstract validationRequest(): Promise<unknown>;

  protected timeoutMs(params?: ConnectorSearchParams) {
    const maxSeconds = params?.budget.maxSeconds ?? this.outputLimits.maxSeconds ?? DEFAULT_CONNECTOR_OUTPUT_LIMITS.maxSeconds;
    return Math.min(maxSeconds * 1000, 30_000);
  }

  protected secret() {
    return typeof this.credential?.secret === "string" ? this.credential.secret : null;
  }

  protected apiKey() {
    return typeof this.credential?.apiKey === "string" ? this.credential.apiKey : this.secret();
  }

  protected applicationKey() {
    return typeof this.credential?.applicationKey === "string" ? this.credential.applicationKey : null;
  }

  protected sessionToken() {
    return typeof this.credential?.sessionToken === "string" ? this.credential.sessionToken : null;
  }

  protected region() {
    return typeof this.credential?.region === "string" ? this.credential.region : null;
  }
}

export class GitHubConnector extends BaseDirectConnector {
  constructor(options: Omit<DirectConnectorOptions, "type" | "surfaces" | "evidenceTypes" | "requires">) {
    super({
      ...options,
      type: "github",
      surfaces: ["code", "deploys"],
      evidenceTypes: ["deployment", "document"],
      requires: ["credentials", "service_scope", "time_window"],
      endpointUrl: options.endpointUrl ?? "https://api.github.com",
    });
  }

  metadata(): ConnectorMetadata {
    return {
      id: this.id,
      type: this.type,
      displayName: "GitHub",
      description: "Read-only commits, pull requests, and deployment context from GitHub.",
      surfaces: this.surfaces,
      evidenceTypes: this.evidenceTypes,
      requires: this.requires,
    };
  }

  protected validationRequest() {
    return fetchJson({
      url: `${this.endpointUrl}/rate_limit`,
      secret: this.secret(),
      timeoutMs: this.timeoutMs(),
      headers: { "X-GitHub-Api-Version": "2022-11-28" },
    });
  }

  async search(params: ConnectorSearchParams): Promise<ConnectorEvidenceItem[]> {
    const query = params.query.trim();
    const url = `${this.endpointUrl}/search/commits?q=${encodeURIComponent(query)}&per_page=${Math.min(params.budget.maxRows, 20)}`;
    const payload = await fetchJson({
      url,
      secret: this.secret(),
      timeoutMs: this.timeoutMs(params),
      headers: {
        Accept: "application/vnd.github.cloak-preview+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    const items = Array.isArray((payload as { items?: unknown[] }).items) ? (payload as { items: unknown[] }).items : [];
    return items.slice(0, params.budget.maxRows).map((item) => {
      const commit = item as {
        html_url?: string;
        sha?: string;
        commit?: { message?: string; author?: { date?: string; name?: string } };
        repository?: { full_name?: string };
      };
      const title = commit.commit?.message?.split("\n")[0]?.slice(0, 180) || commit.sha || "GitHub commit";
      const sourceUri = commit.html_url ?? `${this.endpointUrl}/search?q=${encodeURIComponent(query)}`;

      return {
        id: evidenceId(this.id, sourceUri, title),
        source: "github",
        sourceUri,
        title,
        summary: [commit.repository?.full_name, commit.commit?.author?.name, commit.sha?.slice(0, 12)].filter(Boolean).join(" · "),
        rawContent: commit.commit?.message,
        evidenceType: "deployment",
        metadata: {
          timestamp: commit.commit?.author?.date ? new Date(commit.commit.author.date) : params.timeWindow.end,
          tags: ["github", "commit"],
        },
        citation: {
          connectorId: this.id,
          query,
          resultHash: hashConnectorPayload(commit),
        },
      };
    });
  }
}

export class PrometheusConnector extends BaseDirectConnector {
  constructor(options: Omit<DirectConnectorOptions, "type" | "surfaces" | "evidenceTypes" | "requires">) {
    super({
      ...options,
      type: "prometheus",
      surfaces: ["metrics"],
      evidenceTypes: ["metric"],
      requires: ["network", "service_scope", "time_window", "allowlist"],
    });
  }

  metadata(): ConnectorMetadata {
    return {
      id: this.id,
      type: this.type,
      displayName: "Prometheus",
      description: "Read-only PromQL metric evidence.",
      surfaces: this.surfaces,
      evidenceTypes: this.evidenceTypes,
      requires: this.requires,
    };
  }

  protected validationRequest() {
    if (!this.endpointUrl) throw new Error("Prometheus endpoint URL is required");
    return fetchJson({
      url: `${this.endpointUrl}/api/v1/status/runtimeinfo`,
      secret: this.secret(),
      timeoutMs: this.timeoutMs(),
    });
  }

  async search(params: ConnectorSearchParams): Promise<ConnectorEvidenceItem[]> {
    if (!this.endpointUrl) throw new Error("Prometheus endpoint URL is required");

    const url = new URL(`${this.endpointUrl}/api/v1/query_range`);
    url.searchParams.set("query", params.query);
    url.searchParams.set("start", String(Math.floor(params.timeWindow.start.getTime() / 1000)));
    url.searchParams.set("end", String(Math.floor(params.timeWindow.end.getTime() / 1000)));
    url.searchParams.set("step", String(params.filters?.stepSeconds ?? 60));

    const payload = await fetchJson({ url: url.toString(), secret: this.secret(), timeoutMs: this.timeoutMs(params) });
    const result = (payload as { data?: { result?: unknown[] } }).data?.result ?? [];

    return result.slice(0, params.budget.maxRows).map((series, index) => {
      const metricSeries = series as { metric?: Record<string, string>; values?: Array<[number, string]> };
      const metricName = metricSeries.metric?.__name__ ?? params.query;
      const sourceUri = `${this.endpointUrl}/graph?g0.expr=${encodeURIComponent(params.query)}`;

      return {
        id: evidenceId(this.id, sourceUri, `${metricName}-${index}`),
        source: "prometheus",
        sourceUri,
        title: `Prometheus metric: ${metricName}`,
        summary: `${metricSeries.values?.length ?? 0} samples returned for ${params.query}`,
        rawContent: JSON.stringify(metricSeries),
        evidenceType: "metric",
        metadata: {
          timestamp: params.timeWindow.end,
          tags: ["prometheus", "metric"],
        },
        citation: {
          connectorId: this.id,
          query: params.query,
          resultHash: hashConnectorPayload(metricSeries),
        },
      };
    });
  }
}

export class GrafanaConnector extends BaseDirectConnector {
  constructor(options: Omit<DirectConnectorOptions, "type" | "surfaces" | "evidenceTypes" | "requires">) {
    super({
      ...options,
      type: "grafana",
      surfaces: ["metrics", "native"],
      evidenceTypes: ["document", "topology"],
      requires: ["credentials", "network", "service_scope"],
    });
  }

  metadata(): ConnectorMetadata {
    return {
      id: this.id,
      type: this.type,
      displayName: "Grafana",
      description: "Read-only dashboard and panel context from Grafana.",
      surfaces: this.surfaces,
      evidenceTypes: this.evidenceTypes,
      requires: this.requires,
    };
  }

  protected validationRequest() {
    if (!this.endpointUrl) throw new Error("Grafana endpoint URL is required");
    const url = new URL(`${this.endpointUrl}/api/search`);
    url.searchParams.set("limit", "1");
    return fetchJson({ url: url.toString(), secret: this.secret(), timeoutMs: this.timeoutMs() });
  }

  async search(params: ConnectorSearchParams): Promise<ConnectorEvidenceItem[]> {
    if (!this.endpointUrl) throw new Error("Grafana endpoint URL is required");
    const endpointUrl = this.endpointUrl;

    const url = new URL(`${endpointUrl}/api/search`);
    url.searchParams.set("query", params.query);
    url.searchParams.set("limit", String(Math.min(params.budget.maxRows, 50)));

    const payload = await fetchJson({ url: url.toString(), secret: this.secret(), timeoutMs: this.timeoutMs(params) });
    const dashboards = Array.isArray(payload) ? payload : [];

    return dashboards.slice(0, params.budget.maxRows).map((dashboard) => {
      const item = dashboard as { title?: string; url?: string; uri?: string; type?: string; tags?: string[] };
      const sourceUri = item.url ? `${endpointUrl}${item.url}` : endpointUrl;
      const title = item.title ?? item.uri ?? "Grafana dashboard";

      return {
        id: evidenceId(this.id, sourceUri, title),
        source: "grafana",
        sourceUri,
        title,
        summary: `Grafana ${item.type ?? "dashboard"} matched query ${params.query}`,
        rawContent: JSON.stringify(item),
        evidenceType: "document",
        metadata: {
          timestamp: params.timeWindow.end,
          tags: ["grafana", ...(item.tags ?? [])],
        },
        citation: {
          connectorId: this.id,
          query: params.query,
          resultHash: hashConnectorPayload(item),
        },
      };
    });
  }
}

export class KubernetesConnector extends BaseDirectConnector {
  constructor(options: Omit<DirectConnectorOptions, "type" | "surfaces" | "evidenceTypes" | "requires">) {
    super({
      ...options,
      type: "kubernetes",
      surfaces: ["infra", "logs"],
      evidenceTypes: ["event", "topology"],
      requires: ["credentials", "network", "service_scope", "time_window", "allowlist"],
    });
  }

  metadata(): ConnectorMetadata {
    return {
      id: this.id,
      type: this.type,
      displayName: "Kubernetes",
      description: "Read-only Kubernetes pods and events from the cluster API.",
      surfaces: this.surfaces,
      evidenceTypes: this.evidenceTypes,
      requires: this.requires,
    };
  }

  protected validationRequest() {
    if (!this.endpointUrl) throw new Error("Kubernetes API endpoint URL is required");
    return fetchJson({ url: `${this.endpointUrl}/version`, secret: this.secret(), timeoutMs: this.timeoutMs() });
  }

  async search(params: ConnectorSearchParams): Promise<ConnectorEvidenceItem[]> {
    if (!this.endpointUrl) throw new Error("Kubernetes API endpoint URL is required");
    const endpointUrl = this.endpointUrl;
    const namespace = typeof params.filters?.namespace === "string" ? params.filters.namespace : null;
    const labelSelector = params.query.trim() && params.query.trim() !== "*" ? params.query.trim() : null;
    const basePath = namespace ? `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods` : "/api/v1/pods";
    const podUrl = new URL(`${endpointUrl}${basePath}`);
    podUrl.searchParams.set("limit", String(Math.min(params.budget.maxRows, 50)));
    if (labelSelector) {
      podUrl.searchParams.set("labelSelector", labelSelector);
    }

    const payload = await fetchJson({ url: podUrl.toString(), secret: this.secret(), timeoutMs: this.timeoutMs(params) });
    const pods = Array.isArray((payload as { items?: unknown[] }).items) ? (payload as { items: unknown[] }).items : [];

    return pods.slice(0, params.budget.maxRows).map((pod) => {
      const item = pod as {
        metadata?: { name?: string; namespace?: string; uid?: string; creationTimestamp?: string; labels?: Record<string, string> };
        status?: { phase?: string; podIP?: string; startTime?: string; containerStatuses?: Array<{ name?: string; ready?: boolean; restartCount?: number }> };
        spec?: { nodeName?: string; serviceAccountName?: string };
      };
      const podNamespace = item.metadata?.namespace ?? namespace ?? "default";
      const podName = item.metadata?.name ?? "unknown-pod";
      const sourceUri = `${endpointUrl}/api/v1/namespaces/${encodeURIComponent(podNamespace)}/pods/${encodeURIComponent(podName)}`;
      const restarts = item.status?.containerStatuses?.reduce((total, container) => total + (container.restartCount ?? 0), 0) ?? 0;
      const notReady = item.status?.containerStatuses?.filter((container) => container.ready === false).map((container) => container.name).filter(Boolean) ?? [];

      return {
        id: evidenceId(this.id, sourceUri, podName),
        source: "kubernetes",
        sourceUri,
        title: `Kubernetes pod: ${podNamespace}/${podName}`,
        summary: [`Phase ${item.status?.phase ?? "unknown"}`, `${restarts} restart(s)`, notReady.length ? `Not ready: ${notReady.join(", ")}` : null]
          .filter(Boolean)
          .join(" · "),
        rawContent: JSON.stringify({
          metadata: item.metadata,
          status: item.status,
          spec: {
            nodeName: item.spec?.nodeName,
            serviceAccountName: item.spec?.serviceAccountName,
          },
        }),
        evidenceType: "topology",
        metadata: {
          timestamp: item.status?.startTime ? new Date(item.status.startTime) : params.timeWindow.end,
          severity: item.status?.phase === "Running" && restarts === 0 && notReady.length === 0 ? "info" : "warning",
          tags: ["kubernetes", "pod", podNamespace],
        },
        citation: {
          connectorId: this.id,
          query: params.query,
          resultHash: hashConnectorPayload(item),
        },
      };
    });
  }
}

export class SentryConnector extends BaseDirectConnector {
  constructor(options: Omit<DirectConnectorOptions, "type" | "surfaces" | "evidenceTypes" | "requires">) {
    super({
      ...options,
      type: "sentry",
      surfaces: ["logs", "traces"],
      evidenceTypes: ["event", "log"],
      requires: ["credentials", "network", "service_scope", "time_window"],
    });
  }

  metadata(): ConnectorMetadata {
    return {
      id: this.id,
      type: this.type,
      displayName: "Sentry",
      description: "Read-only Sentry issue context for incidents and regressions.",
      surfaces: this.surfaces,
      evidenceTypes: this.evidenceTypes,
      requires: this.requires,
    };
  }

  protected validationRequest() {
    if (!this.endpointUrl) throw new Error("Sentry project API endpoint URL is required");
    return fetchJson({ url: `${this.endpointUrl}/issues/?limit=1`, secret: this.secret(), timeoutMs: this.timeoutMs() });
  }

  async search(params: ConnectorSearchParams): Promise<ConnectorEvidenceItem[]> {
    if (!this.endpointUrl) throw new Error("Sentry project API endpoint URL is required");

    const url = new URL(`${this.endpointUrl}/issues/`);
    url.searchParams.set("query", params.query);
    url.searchParams.set("limit", String(Math.min(params.budget.maxRows, 50)));

    const payload = await fetchJson({ url: url.toString(), secret: this.secret(), timeoutMs: this.timeoutMs(params) });
    const issues = Array.isArray(payload) ? payload : [];

    return issues.slice(0, params.budget.maxRows).map((issue) => {
      const item = issue as {
        id?: string;
        shortId?: string;
        title?: string;
        culprit?: string;
        permalink?: string;
        level?: string;
        status?: string;
        count?: string | number;
        firstSeen?: string;
        lastSeen?: string;
        metadata?: Record<string, unknown>;
      };
      const title = item.title ?? item.shortId ?? item.id ?? "Sentry issue";
      const sourceUri = item.permalink ?? `${this.endpointUrl}/issues/${encodeURIComponent(item.id ?? title)}/`;
      const observedAt = item.lastSeen ?? item.firstSeen;

      return {
        id: evidenceId(this.id, sourceUri, title),
        source: "sentry",
        sourceUri,
        title: `Sentry issue: ${title}`,
        summary: [item.shortId, item.culprit, item.status, item.count ? `${item.count} event(s)` : null].filter(Boolean).join(" · "),
        rawContent: JSON.stringify({ ...item, metadata: item.metadata ?? {} }),
        evidenceType: "event",
        metadata: {
          timestamp: observedAt ? new Date(observedAt) : params.timeWindow.end,
          severity: item.level ?? undefined,
          tags: ["sentry", "issue", item.status].filter((value): value is string => Boolean(value)),
        },
        citation: {
          connectorId: this.id,
          query: params.query,
          resultHash: hashConnectorPayload(item),
        },
      };
    });
  }
}

export class DatadogConnector extends BaseDirectConnector {
  constructor(options: Omit<DirectConnectorOptions, "type" | "surfaces" | "evidenceTypes" | "requires">) {
    super({
      ...options,
      type: "datadog",
      surfaces: ["metrics", "logs", "traces"],
      evidenceTypes: ["event", "log", "metric"],
      requires: ["credentials", "network", "service_scope", "time_window"],
      endpointUrl: options.endpointUrl ?? "https://api.datadoghq.com",
    });
  }

  metadata(): ConnectorMetadata {
    return {
      id: this.id,
      type: this.type,
      displayName: "Datadog",
      description: "Read-only Datadog event context for incident investigations.",
      surfaces: this.surfaces,
      evidenceTypes: this.evidenceTypes,
      requires: this.requires,
    };
  }

  private datadogHeaders() {
    const apiKey = this.apiKey();
    const applicationKey = this.applicationKey();
    if (!apiKey || !applicationKey) {
      throw new Error("credentials rejected: Datadog connector requires apiKey and applicationKey credentials");
    }

    return {
      "DD-API-KEY": apiKey,
      "DD-APPLICATION-KEY": applicationKey,
    };
  }

  protected async validationRequest() {
    if (!this.endpointUrl) throw new Error("Datadog endpoint URL is required");
    const payload = await fetchJson({ url: `${this.endpointUrl}/api/v1/validate`, timeoutMs: this.timeoutMs(), headers: this.datadogHeaders() });
    if ((payload as { valid?: unknown }).valid === false) {
      throw new Error("credentials rejected: Datadog API key was rejected");
    }
    return payload;
  }

  async search(params: ConnectorSearchParams): Promise<ConnectorEvidenceItem[]> {
    if (!this.endpointUrl) throw new Error("Datadog endpoint URL is required");

    const url = new URL(`${this.endpointUrl}/api/v1/events`);
    url.searchParams.set("start", String(Math.floor(params.timeWindow.start.getTime() / 1000)));
    url.searchParams.set("end", String(Math.floor(params.timeWindow.end.getTime() / 1000)));
    url.searchParams.set("unaggregated", "true");
    if (params.query.trim()) {
      url.searchParams.set("tags", params.query.trim());
    }

    const payload = await fetchJson({ url: url.toString(), timeoutMs: this.timeoutMs(params), headers: this.datadogHeaders() });
    const events = Array.isArray((payload as { events?: unknown[] }).events) ? (payload as { events: unknown[] }).events : [];

    return events.slice(0, params.budget.maxRows).map((event) => {
      const item = event as {
        id?: number | string;
        title?: string;
        text?: string;
        date_happened?: number;
        alert_type?: string;
        source?: string;
        host?: string;
        tags?: string[];
        url?: string;
      };
      const title = item.title ?? `Datadog event ${item.id ?? "unknown"}`;
      const sourceUri = item.url ?? `${this.endpointUrl}/event/event?id=${encodeURIComponent(String(item.id ?? title))}`;

      return {
        id: evidenceId(this.id, sourceUri, title),
        source: "datadog",
        sourceUri,
        title: `Datadog event: ${title}`,
        summary: [item.alert_type, item.source, item.host, item.text?.slice(0, 180)].filter(Boolean).join(" · "),
        rawContent: JSON.stringify(item),
        evidenceType: "event",
        metadata: {
          timestamp: item.date_happened ? new Date(item.date_happened * 1000) : params.timeWindow.end,
          severity: item.alert_type ?? undefined,
          tags: ["datadog", ...(item.tags ?? [])],
        },
        citation: {
          connectorId: this.id,
          query: params.query,
          resultHash: hashConnectorPayload(item),
        },
      };
    });
  }
}

export class LokiConnector extends BaseDirectConnector {
  constructor(options: Omit<DirectConnectorOptions, "type" | "surfaces" | "evidenceTypes" | "requires">) {
    super({
      ...options,
      type: "loki",
      surfaces: ["logs"],
      evidenceTypes: ["log"],
      requires: ["network", "service_scope", "time_window", "allowlist"],
    });
  }

  metadata(): ConnectorMetadata {
    return {
      id: this.id,
      type: this.type,
      displayName: "Loki",
      description: "Read-only LogQL log evidence from Grafana Loki.",
      surfaces: this.surfaces,
      evidenceTypes: this.evidenceTypes,
      requires: this.requires,
    };
  }

  protected validationRequest() {
    if (!this.endpointUrl) throw new Error("Loki endpoint URL is required");
    return fetchJson({ url: `${this.endpointUrl}/loki/api/v1/labels`, secret: this.secret(), timeoutMs: this.timeoutMs() });
  }

  async search(params: ConnectorSearchParams): Promise<ConnectorEvidenceItem[]> {
    if (!this.endpointUrl) throw new Error("Loki endpoint URL is required");

    const url = new URL(`${this.endpointUrl}/loki/api/v1/query_range`);
    url.searchParams.set("query", params.query);
    url.searchParams.set("start", String(params.timeWindow.start.getTime() * 1_000_000));
    url.searchParams.set("end", String(params.timeWindow.end.getTime() * 1_000_000));
    url.searchParams.set("limit", String(Math.min(params.budget.maxRows, 100)));
    url.searchParams.set("direction", "backward");

    const payload = await fetchJson({ url: url.toString(), secret: this.secret(), timeoutMs: this.timeoutMs(params) });
    const streams = Array.isArray((payload as { data?: { result?: unknown[] } }).data?.result)
      ? (payload as { data: { result: unknown[] } }).data.result
      : [];
    const entries: ConnectorEvidenceItem[] = [];

    for (const stream of streams) {
      const item = stream as { stream?: Record<string, string>; values?: Array<[string, string]> };
      const labels = item.stream ?? {};
      const labelSummary = Object.entries(labels)
        .map(([key, value]) => `${key}=${value}`)
        .join(", ");

      for (const [timestampNs, line] of item.values ?? []) {
        if (entries.length >= params.budget.maxRows) return entries;

        const observedAt = dateFromUnixNs(timestampNs, params.timeWindow.end);
        const titleLine = line.trim().slice(0, 160) || "Loki log line";
        const sourceUri = `${this.endpointUrl}/loki/api/v1/query_range?query=${encodeURIComponent(params.query)}&ts=${encodeURIComponent(timestampNs)}`;

        entries.push({
          id: evidenceId(this.id, sourceUri, titleLine),
          source: "loki",
          sourceUri,
          title: `Loki log: ${titleLine}`,
          summary: labelSummary || `LogQL match for ${params.query}`,
          rawContent: line,
          evidenceType: "log",
          metadata: {
            timestamp: observedAt,
            severity: severityFromLogLine(line),
            tags: ["loki", ...Object.entries(labels).map(([key, value]) => `${key}:${value}`)],
          },
          citation: {
            connectorId: this.id,
            query: params.query,
            resultHash: hashConnectorPayload({ labels, timestampNs, line }),
          },
        });
      }
    }

    return entries;
  }
}

export class ElasticsearchConnector extends BaseDirectConnector {
  constructor(options: Omit<DirectConnectorOptions, "type" | "surfaces" | "evidenceTypes" | "requires">) {
    super({
      ...options,
      type: "elasticsearch",
      surfaces: ["logs"],
      evidenceTypes: ["log"],
      requires: ["network", "service_scope", "time_window", "allowlist"],
    });
  }

  metadata(): ConnectorMetadata {
    return {
      id: this.id,
      type: this.type,
      displayName: "Elasticsearch/OpenSearch",
      description: "Read-only log evidence from Elasticsearch-compatible search APIs.",
      surfaces: this.surfaces,
      evidenceTypes: this.evidenceTypes,
      requires: this.requires,
    };
  }

  protected validationRequest() {
    if (!this.endpointUrl) throw new Error("Elasticsearch endpoint URL is required");
    return fetchJson({ url: `${this.endpointUrl}/_cluster/health`, secret: this.secret(), timeoutMs: this.timeoutMs() });
  }

  async search(params: ConnectorSearchParams): Promise<ConnectorEvidenceItem[]> {
    if (!this.endpointUrl) throw new Error("Elasticsearch endpoint URL is required");

    const index = typeof params.filters?.index === "string" && params.filters.index.trim() ? params.filters.index.trim() : null;
    const timestampField = typeof params.filters?.timestampField === "string" && params.filters.timestampField.trim() ? params.filters.timestampField.trim() : "@timestamp";
    const searchPath = index ? `/${encodeURIComponent(index)}/_search` : "/_search";
    const url = new URL(`${this.endpointUrl}${searchPath}`);
    url.searchParams.set("q", `(${params.query}) AND ${timestampField}:[${params.timeWindow.start.toISOString()} TO ${params.timeWindow.end.toISOString()}]`);
    url.searchParams.set("size", String(Math.min(params.budget.maxRows, 100)));
    url.searchParams.set("ignore_unavailable", "true");
    url.searchParams.set("allow_no_indices", "true");

    const payload = await fetchJson({ url: url.toString(), secret: this.secret(), timeoutMs: this.timeoutMs(params) });
    const hits = Array.isArray((payload as { hits?: { hits?: unknown[] } }).hits?.hits)
      ? (payload as { hits: { hits: unknown[] } }).hits.hits
      : [];

    return hits.slice(0, params.budget.maxRows).map((hit) => {
      const item = hit as { _id?: string; _index?: string; _score?: number; _source?: Record<string, unknown> };
      const source = item._source ?? {};
      const message = sourceString(source, ["message", "log", "event.original", "body"]) ?? JSON.stringify(source).slice(0, 500);
      const service = sourceString(source, ["service.name", "service", "app", "application"]);
      const level = sourceString(source, ["log.level", "level", "severity"]);
      const timestamp = sourceString(source, ["@timestamp", "timestamp", "time"]);
      const observedAt = timestamp ? new Date(timestamp) : params.timeWindow.end;
      const titleLine = message.slice(0, 160) || item._id || "Elasticsearch log document";
      const sourceUri = `${this.endpointUrl}/${encodeURIComponent(item._index ?? index ?? "_all")}/_doc/${encodeURIComponent(item._id ?? titleLine)}`;

      return {
        id: evidenceId(this.id, sourceUri, titleLine),
        source: "elasticsearch",
        sourceUri,
        title: `Elasticsearch log: ${titleLine}`,
        summary: [item._index, service, level, typeof item._score === "number" ? `score ${item._score.toFixed(2)}` : null].filter(Boolean).join(" · "),
        rawContent: JSON.stringify(source),
        evidenceType: "log",
        metadata: {
          timestamp: Number.isNaN(observedAt.getTime()) ? params.timeWindow.end : observedAt,
          severity: level ?? severityFromLogLine(message),
          tags: ["elasticsearch", item._index, service].filter((value): value is string => Boolean(value)),
        },
        citation: {
          connectorId: this.id,
          query: params.query,
          resultHash: hashConnectorPayload(item),
        },
      };
    });
  }
}

export class TempoConnector extends BaseDirectConnector {
  constructor(options: Omit<DirectConnectorOptions, "type" | "surfaces" | "evidenceTypes" | "requires">) {
    super({
      ...options,
      type: "tempo",
      surfaces: ["traces"],
      evidenceTypes: ["trace"],
      requires: ["network", "service_scope", "time_window", "allowlist"],
    });
  }

  metadata(): ConnectorMetadata {
    return {
      id: this.id,
      type: this.type,
      displayName: "Grafana Tempo",
      description: "Read-only distributed trace search evidence from Grafana Tempo.",
      surfaces: this.surfaces,
      evidenceTypes: this.evidenceTypes,
      requires: this.requires,
    };
  }

  protected validationRequest() {
    if (!this.endpointUrl) throw new Error("Tempo endpoint URL is required");
    return fetchOk({ url: `${this.endpointUrl}/ready`, secret: this.secret(), timeoutMs: this.timeoutMs() });
  }

  async search(params: ConnectorSearchParams): Promise<ConnectorEvidenceItem[]> {
    if (!this.endpointUrl) throw new Error("Tempo endpoint URL is required");

    const normalizedQuery = normalizeTempoSearchQuery(params.query);
    const url = new URL(`${this.endpointUrl}/api/search`);
    url.searchParams.set("start", String(Math.floor(params.timeWindow.start.getTime() / 1000)));
    url.searchParams.set("end", String(Math.floor(params.timeWindow.end.getTime() / 1000)));
    url.searchParams.set("limit", String(Math.min(params.budget.maxRows, 100)));

    if (normalizedQuery.q) {
      url.searchParams.set("q", normalizedQuery.q);
    } else if (normalizedQuery.tags) {
      url.searchParams.set("tags", normalizedQuery.tags);
    }

    if (normalizedQuery.minDuration) {
      url.searchParams.set("minDuration", normalizedQuery.minDuration);
    }

    if (normalizedQuery.maxDuration) {
      url.searchParams.set("maxDuration", normalizedQuery.maxDuration);
    }

    const payload = await fetchJson({ url: url.toString(), secret: this.secret(), timeoutMs: this.timeoutMs(params) });
    const traces = Array.isArray((payload as { traces?: unknown[] }).traces) ? (payload as { traces: unknown[] }).traces : [];

    return traces.slice(0, params.budget.maxRows).map((trace) => {
      const item = trace as {
        traceID?: string;
        traceId?: string;
        rootServiceName?: string;
        rootTraceName?: string;
        serviceStats?: Record<string, unknown>;
        startTimeUnixNano?: string | number;
        durationMs?: number;
        spanSet?: { spans?: unknown[] };
        spanSets?: Array<{ spans?: unknown[] }>;
      };
      const traceId = item.traceID ?? item.traceId ?? "unknown-trace";
      const rootService = item.rootServiceName ?? "unknown-service";
      const rootName = item.rootTraceName ?? "trace";
      const sourceUri = `${this.endpointUrl}/api/traces/${encodeURIComponent(traceId)}`;
      const serviceNames = Object.keys(item.serviceStats ?? {}).slice(0, 10);
      const spans = [
        ...(Array.isArray(item.spanSet?.spans) ? item.spanSet.spans : []),
        ...(item.spanSets ?? []).flatMap((spanSet) => Array.isArray(spanSet.spans) ? spanSet.spans : []),
      ];
      const spanAttributes = spans
        .flatMap((span) => {
          if (!span || typeof span !== "object" || Array.isArray(span)) return [];
          const attributes = (span as { attributes?: unknown[] }).attributes;
          if (!Array.isArray(attributes)) return [];
          return attributes
            .map((attribute) => {
              if (!attribute || typeof attribute !== "object" || Array.isArray(attribute)) return null;
              const entry = attribute as { key?: unknown; value?: unknown };
              const key = stringValue(entry.key);
              const value = tempoAttributeValue(entry.value);
              return key && value ? `${key}=${value}` : null;
            })
            .filter((attribute): attribute is string => Boolean(attribute));
        })
        .slice(0, 12);
      const duration = durationSummary(item.durationMs);

      return {
        id: evidenceId(this.id, sourceUri, traceId),
        source: "tempo",
        sourceUri,
        title: `Tempo trace: ${rootService} ${rootName}`,
        summary: [
          traceId,
          duration ? `duration ${duration}` : null,
          serviceNames.length ? `services ${serviceNames.join(", ")}` : null,
        ].filter(Boolean).join(" · "),
        rawContent: JSON.stringify({
          traceID: traceId,
          rootServiceName: item.rootServiceName,
          rootTraceName: item.rootTraceName,
          durationMs: item.durationMs,
          startTimeUnixNano: item.startTimeUnixNano,
          serviceStats: item.serviceStats,
          spanAttributes,
        }),
        evidenceType: "trace",
        metadata: {
          timestamp: dateFromUnixNs(item.startTimeUnixNano, params.timeWindow.end),
          severity: tempoTraceHasError(trace) ? "error" : undefined,
          tags: ["tempo", "trace", rootService, ...serviceNames.map((service) => `service:${service}`), ...spanAttributes],
        },
        citation: {
          connectorId: this.id,
          query: params.query,
          resultHash: hashConnectorPayload(trace),
        },
      };
    });
  }
}

type CloudWatchQueryShape = {
  namespace?: string;
  metricName?: string;
  statistic: string;
  periodSeconds: number;
  dimensions: Array<{ name: string; value: string }>;
  alarmPrefix?: string;
  stateValue?: string;
  freeText: string;
};

export class AwsCloudWatchConnector extends BaseDirectConnector {
  constructor(options: Omit<DirectConnectorOptions, "type" | "surfaces" | "evidenceTypes" | "requires">) {
    super({
      ...options,
      type: "aws_cloudwatch",
      surfaces: ["metrics", "infra"],
      evidenceTypes: ["metric", "event"],
      requires: ["credentials", "network", "service_scope", "time_window", "allowlist"],
      endpointUrl: options.endpointUrl ?? "https://monitoring.us-east-1.amazonaws.com",
    });
  }

  metadata(): ConnectorMetadata {
    return {
      id: this.id,
      type: this.type,
      displayName: "AWS CloudWatch",
      description: "Read-only CloudWatch alarm and metric evidence for AWS-backed services.",
      surfaces: this.surfaces,
      evidenceTypes: this.evidenceTypes,
      requires: this.requires,
    };
  }

  protected validationRequest() {
    return this.cloudWatchRequest({
      Action: "DescribeAlarms",
      MaxRecords: "1",
    });
  }

  async search(params: ConnectorSearchParams): Promise<ConnectorEvidenceItem[]> {
    const query = this.parseQuery(params.query);

    if (query.namespace && query.metricName) {
      return this.searchMetricData(params, query);
    }

    return this.searchAlarms(params, query);
  }

  private awsCredentials() {
    const accessKeyId = this.apiKey();
    const secretAccessKey = this.secret();
    if (!accessKeyId || !secretAccessKey) {
      throw new Error("AWS CloudWatch connector requires apiKey/accessKeyId and secret/secretAccessKey credentials");
    }

    return {
      accessKeyId,
      secretAccessKey,
      sessionToken: this.sessionToken() ?? this.applicationKey(),
    };
  }

  private async cloudWatchRequest(parameters: Record<string, string>, params?: ConnectorSearchParams) {
    if (!this.endpointUrl) throw new Error("AWS CloudWatch endpoint URL is required");

    const endpoint = new URL(this.endpointUrl);
    const region = cloudWatchRegion(this.endpointUrl, this.region());
    const credentials = this.awsCredentials();
    const amzDate = awsAmzDate();
    const dateStamp = awsDateStamp(amzDate);
    const body = new URLSearchParams({
      Version: "2010-08-01",
      ...parameters,
    }).toString();
    const payloadHash = sha256Hex(body);
    const canonicalHeaders = [
      "content-type:application/x-www-form-urlencoded; charset=utf-8",
      `host:${endpoint.host}`,
      `x-amz-date:${amzDate}`,
      ...(credentials.sessionToken ? [`x-amz-security-token:${credentials.sessionToken}`] : []),
    ].join("\n") + "\n";
    const signedHeaders = ["content-type", "host", "x-amz-date", ...(credentials.sessionToken ? ["x-amz-security-token"] : [])].join(";");
    const canonicalRequest = ["POST", endpoint.pathname || "/", "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const credentialScope = `${dateStamp}/${region}/monitoring/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, dateStamp), region), "monitoring"), "aws4_request");
    const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");
    const authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const response = await fetch(this.endpointUrl, {
      method: "POST",
      headers: {
        Accept: "application/xml",
        Authorization: authorization,
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        "X-Amz-Date": amzDate,
        ...(credentials.sessionToken ? { "X-Amz-Security-Token": credentials.sessionToken } : {}),
      },
      body,
      signal: AbortSignal.timeout(this.timeoutMs(params)),
      cache: "no-store",
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error(`credentials rejected with HTTP ${response.status}`);
    }

    if (!response.ok) {
      throw new Error(`request failed with HTTP ${response.status}`);
    }

    return response.text();
  }

  private parseQuery(query: string): CloudWatchQueryShape {
    const parsed: CloudWatchQueryShape = {
      statistic: "Average",
      periodSeconds: 60,
      dimensions: [],
      freeText: "",
    };
    const freeText: string[] = [];

    for (const token of query.trim().split(/\s+/).filter(Boolean)) {
      const separator = token.indexOf(":");
      if (separator === -1) {
        freeText.push(token);
        continue;
      }

      const key = token.slice(0, separator).toLowerCase();
      const value = token.slice(separator + 1).trim();
      if (!value) continue;

      if (key === "namespace" || key === "ns") parsed.namespace = value;
      else if (key === "metric" || key === "metricname") parsed.metricName = value;
      else if (key === "stat" || key === "statistic") parsed.statistic = value;
      else if (key === "period" || key === "periodseconds") parsed.periodSeconds = Math.min(Math.max(Number(value) || 60, 60), 3600);
      else if (key === "state") parsed.stateValue = value.toUpperCase();
      else if (key === "prefix" || key === "alarmprefix") parsed.alarmPrefix = value;
      else if (key === "dimension" || key === "dim") {
        const equalsAt = value.indexOf("=");
        if (equalsAt > 0) {
          parsed.dimensions.push({ name: value.slice(0, equalsAt), value: value.slice(equalsAt + 1) });
        }
      } else {
        freeText.push(token);
      }
    }

    parsed.freeText = freeText.join(" ").trim();
    return parsed;
  }

  private async searchAlarms(params: ConnectorSearchParams, query: CloudWatchQueryShape): Promise<ConnectorEvidenceItem[]> {
    if (!this.endpointUrl) throw new Error("AWS CloudWatch endpoint URL is required");

    const body: Record<string, string> = {
      Action: "DescribeAlarms",
      MaxRecords: String(Math.min(params.budget.maxRows, 100)),
    };
    const prefix = query.alarmPrefix ?? query.freeText;
    if (prefix && prefix !== "*") body.AlarmNamePrefix = prefix.slice(0, 255);
    if (query.stateValue && ["OK", "ALARM", "INSUFFICIENT_DATA"].includes(query.stateValue)) {
      body.StateValue = query.stateValue;
    }

    const xml = await this.cloudWatchRequest(body, params);
    const alarmsContainer = xmlBlocks(xml, "MetricAlarms")[0] ?? "";
    const alarms = xmlBlocks(alarmsContainer, "member");

    return alarms.slice(0, params.budget.maxRows).map((alarm) => {
      const alarmName = xmlText(alarm, "AlarmName") || "CloudWatch alarm";
      const alarmArn = xmlText(alarm, "AlarmArn");
      const stateValue = xmlText(alarm, "StateValue");
      const metricName = xmlText(alarm, "MetricName");
      const namespace = xmlText(alarm, "Namespace");
      const stateUpdatedAt = xmlText(alarm, "StateUpdatedTimestamp");
      const title = `CloudWatch alarm: ${alarmName}`;
      const region = cloudWatchRegion(this.endpointUrl!, this.region());
      const sourceUri = `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${awsEncode(region)}#alarmsV2:alarm/${awsEncode(alarmName)}`;

      return {
        id: evidenceId(this.id, alarmArn || sourceUri, title),
        source: "aws_cloudwatch",
        sourceUri,
        title,
        summary: [stateValue || "unknown state", namespace && metricName ? `${namespace}/${metricName}` : null, xmlText(alarm, "StateReason")]
          .filter(Boolean)
          .join(" · "),
        rawContent: JSON.stringify({
          alarmName,
          alarmArn,
          alarmDescription: xmlText(alarm, "AlarmDescription"),
          stateValue,
          stateReason: xmlText(alarm, "StateReason"),
          namespace,
          metricName,
          statistic: xmlText(alarm, "Statistic") || xmlText(alarm, "ExtendedStatistic"),
          threshold: xmlText(alarm, "Threshold"),
          comparisonOperator: xmlText(alarm, "ComparisonOperator"),
        }),
        evidenceType: "metric",
        metadata: {
          timestamp: stateUpdatedAt ? new Date(stateUpdatedAt) : params.timeWindow.end,
          severity: cloudWatchSeverity(stateValue),
          tags: ["aws", "cloudwatch", "alarm", stateValue, namespace, metricName].filter((value): value is string => Boolean(value)),
        },
        citation: {
          connectorId: this.id,
          query: params.query,
          resultHash: hashConnectorPayload(alarm),
        },
      };
    });
  }

  private async searchMetricData(params: ConnectorSearchParams, query: CloudWatchQueryShape): Promise<ConnectorEvidenceItem[]> {
    if (!this.endpointUrl || !query.namespace || !query.metricName) {
      throw new Error("AWS CloudWatch metric queries require namespace and metric");
    }

    const body: Record<string, string> = {
      Action: "GetMetricData",
      StartTime: params.timeWindow.start.toISOString(),
      EndTime: params.timeWindow.end.toISOString(),
      MaxDatapoints: String(Math.min(Math.max(params.budget.maxRows * 2, 1), 1000)),
      "MetricDataQueries.member.1.Id": "m1",
      "MetricDataQueries.member.1.ReturnData": "true",
      "MetricDataQueries.member.1.MetricStat.Metric.Namespace": query.namespace,
      "MetricDataQueries.member.1.MetricStat.Metric.MetricName": query.metricName,
      "MetricDataQueries.member.1.MetricStat.Period": String(query.periodSeconds),
      "MetricDataQueries.member.1.MetricStat.Stat": query.statistic,
    };

    query.dimensions.slice(0, 10).forEach((dimension, index) => {
      const position = index + 1;
      body[`MetricDataQueries.member.1.MetricStat.Metric.Dimensions.member.${position}.Name`] = dimension.name;
      body[`MetricDataQueries.member.1.MetricStat.Metric.Dimensions.member.${position}.Value`] = dimension.value;
    });

    const xml = await this.cloudWatchRequest(body, params);
    const resultsContainer = xmlBlocks(xml, "MetricDataResults")[0] ?? "";
    const results = xmlBlocks(resultsContainer, "member");
    const region = cloudWatchRegion(this.endpointUrl, this.region());

    return results.slice(0, params.budget.maxRows).map((result) => {
      const label = xmlText(result, "Label") || `${query.namespace}/${query.metricName}`;
      const values = xmlMemberValues(result, "Values").slice(0, params.budget.maxRows);
      const timestamps = xmlMemberValues(result, "Timestamps").slice(0, params.budget.maxRows);
      const latestValue = values[0];
      const latestTimestamp = timestamps[0];
      const title = `CloudWatch metric: ${label}`;
      const sourceUri = `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${awsEncode(region)}#metricsV2`;

      return {
        id: evidenceId(this.id, sourceUri, title),
        source: "aws_cloudwatch",
        sourceUri,
        title,
        summary: [
          `${values.length} datapoint${values.length === 1 ? "" : "s"}`,
          latestValue ? `latest ${latestValue}` : null,
          query.dimensions.length ? query.dimensions.map((dimension) => `${dimension.name}=${dimension.value}`).join(", ") : null,
        ].filter(Boolean).join(" · "),
        rawContent: JSON.stringify({
          namespace: query.namespace,
          metricName: query.metricName,
          statistic: query.statistic,
          periodSeconds: query.periodSeconds,
          dimensions: query.dimensions,
          statusCode: xmlText(result, "StatusCode"),
          values,
          timestamps,
        }),
        evidenceType: "metric",
        metadata: {
          timestamp: latestTimestamp ? new Date(latestTimestamp) : params.timeWindow.end,
          tags: ["aws", "cloudwatch", "metric", query.namespace, query.metricName, ...query.dimensions.map((dimension) => `${dimension.name}:${dimension.value}`)]
            .filter((value): value is string => Boolean(value)),
        },
        citation: {
          connectorId: this.id,
          query: params.query,
          resultHash: hashConnectorPayload(result),
        },
      };
    });
  }
}

export function createDirectConnector(options: DirectConnectorOptions): Connector {
  switch (options.type) {
    case "github":
      return new GitHubConnector(options);
    case "prometheus":
      return new PrometheusConnector(options);
    case "grafana":
      return new GrafanaConnector(options);
    case "kubernetes":
      return new KubernetesConnector(options);
    case "sentry":
      return new SentryConnector(options);
    case "datadog":
      return new DatadogConnector(options);
    case "loki":
      return new LokiConnector(options);
    case "elasticsearch":
      return new ElasticsearchConnector(options);
    case "tempo":
      return new TempoConnector(options);
    case "aws_cloudwatch":
      return new AwsCloudWatchConnector(options);
    default:
      throw new Error(`Direct connector search is not implemented for ${options.type}`);
  }
}
