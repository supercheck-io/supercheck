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
      return {
        status: message.includes("credentials rejected") ? "invalid_credentials" : "unreachable",
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
    return fetchJson({ url: `${this.endpointUrl}/api/health`, secret: this.secret(), timeoutMs: this.timeoutMs() });
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
      throw new Error("Datadog connector requires apiKey and applicationKey credentials");
    }

    return {
      "DD-API-KEY": apiKey,
      "DD-APPLICATION-KEY": applicationKey,
    };
  }

  protected validationRequest() {
    if (!this.endpointUrl) throw new Error("Datadog endpoint URL is required");
    return fetchJson({ url: `${this.endpointUrl}/api/v1/validate`, timeoutMs: this.timeoutMs(), headers: this.datadogHeaders() });
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
    return fetchOk({ url: `${this.endpointUrl}/ready`, secret: this.secret(), timeoutMs: this.timeoutMs() });
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
    default:
      throw new Error(`Direct connector search is not implemented for ${options.type}`);
  }
}
