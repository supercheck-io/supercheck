import { fetchConnectorEndpoint, fetchPublicEndpoint } from "../pinned-fetch";
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
} from "../connector-base";
import { validateAzure, searchAzure } from "./azure-monitor";
import { validateGcp, searchGcp } from "./gcp-monitoring";
import { validateJaeger, searchJaeger } from "./jaeger";
import { validateNewRelic, searchNewRelic } from "./newrelic";
import {
  assertVendorUrl,
  PROVIDER_MAX_RESPONSE_BYTES,
  type ProviderContext,
  type ProviderCredential,
  type ProviderHttp,
  type ProviderRecord,
  type ProviderResult,
  type ProviderSearchParams,
} from "./provider-core";
import { validateSplunk, searchSplunk } from "./splunk";

export const OBSERVABILITY_PROVIDER_TYPES = [
  "jaeger",
  "newrelic",
  "splunk",
  "gcp_monitoring",
  "azure_monitor",
] as const satisfies readonly ConnectorType[];

export type ObservabilityProviderType =
  (typeof OBSERVABILITY_PROVIDER_TYPES)[number];

export function isObservabilityProviderType(
  type: string,
): type is ObservabilityProviderType {
  return (OBSERVABILITY_PROVIDER_TYPES as readonly string[]).includes(type);
}

type ProviderConnectorOptions = ConnectorDefinition & {
  endpointUrl?: string | null;
  credential?: {
    secret?: string | null;
    fields?: ProviderCredential | null;
  } | null;
};

type ProviderSpec = {
  displayName: string;
  description: string;
  surfaces: ConnectorDefinition["surfaces"];
  evidenceTypes: ConnectorDefinition["evidenceTypes"];
  requires: ConnectorDefinition["requires"];
  validate: (ctx: ProviderContext) => Promise<void>;
  search: (
    ctx: ProviderContext,
    params: ProviderSearchParams,
  ) => Promise<ProviderResult>;
};

const PROVIDER_SPECS: Record<ObservabilityProviderType, ProviderSpec> = {
  jaeger: {
    displayName: "Jaeger",
    description: "Read-only distributed trace search evidence from Jaeger.",
    surfaces: ["traces"],
    evidenceTypes: ["trace", "topology"],
    requires: ["network", "service_scope", "time_window", "allowlist"],
    validate: validateJaeger,
    search: searchJaeger,
  },
  newrelic: {
    displayName: "New Relic",
    description: "Read-only NRQL evidence from New Relic (NerdGraph).",
    surfaces: ["metrics", "logs", "traces", "events"],
    evidenceTypes: ["metric", "log", "trace", "event"],
    requires: ["credentials", "service_scope", "time_window"],
    validate: validateNewRelic,
    search: searchNewRelic,
  },
  splunk: {
    displayName: "Splunk",
    description: "Read-only SPL search evidence from Splunk.",
    surfaces: ["logs", "metrics", "events"],
    evidenceTypes: ["log", "metric"],
    requires: ["credentials", "network", "service_scope", "time_window", "allowlist"],
    validate: validateSplunk,
    search: searchSplunk,
  },
  gcp_monitoring: {
    displayName: "Google Cloud Monitoring and Logging",
    description: "Read-only metric time series and log entries from Google Cloud.",
    surfaces: ["metrics", "logs"],
    evidenceTypes: ["metric", "log"],
    requires: ["credentials", "service_scope", "time_window"],
    validate: validateGcp,
    search: searchGcp,
  },
  azure_monitor: {
    displayName: "Azure Monitor",
    description: "Read-only Azure metrics and Log Analytics (KQL) evidence.",
    surfaces: ["metrics", "logs"],
    evidenceTypes: ["metric", "log", "event"],
    requires: ["credentials", "service_scope", "time_window"],
    validate: validateAzure,
    search: searchAzure,
  },
};

async function readBoundedText(response: Response, maxBytes: number) {
  const reader = response.body?.getReader();
  if (!reader) return { text: "", truncated: false };
  const decoder = new TextDecoder();
  let text = "";
  let received = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = maxBytes - received;
    if (value.byteLength > remaining) {
      text += decoder.decode(value.subarray(0, Math.max(remaining, 0)));
      truncated = true;
      await reader.cancel();
      break;
    }
    received += value.byteLength;
    text += decoder.decode(value, { stream: true });
  }
  return { text, truncated };
}

/**
 * Customer endpoints use the connector pin (self-hosted may reach private
 * networks). Fixed vendor hosts, including OAuth token endpoints, always use the
 * public-only pin and must be on the vendor allowlist.
 */
export const providerHttp: ProviderHttp = async (request) => {
  if (request.target === "vendor") assertVendorUrl(request.url);
  const fetcher =
    request.target === "vendor" ? fetchPublicEndpoint : fetchConnectorEndpoint;
  const response = await fetcher(
    request.url,
    {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: AbortSignal.timeout(request.timeoutMs),
      cache: "no-store",
      redirect: "error",
    },
    PROVIDER_MAX_RESPONSE_BYTES,
  );
  const { text, truncated } = await readBoundedText(response, request.maxBytes);
  return { status: response.status, text, truncated };
};

function toEvidenceItem(
  connector: { id: string; type: ConnectorType },
  query: string,
  record: ProviderRecord,
  fallback: Date,
): ConnectorEvidenceItem {
  const observed = new Date(record.observedAt);
  return {
    id: `connector_${hashConnectorPayload({ connectorId: connector.id, sourceUri: record.sourceUri, title: record.title, hash: record.hashInput }).slice(0, 24)}`,
    source: connector.type,
    sourceUri: record.sourceUri,
    title: record.title,
    summary: record.summary,
    rawContent: record.rawContent,
    evidenceType: record.evidenceType,
    metadata: {
      timestamp: Number.isNaN(observed.getTime()) ? fallback : observed,
      severity: record.severity,
      tags: record.tags,
    },
    citation: {
      connectorId: connector.id,
      query,
      resultHash: hashConnectorPayload(record.hashInput),
    },
  };
}

export class ObservabilityProviderConnector implements Connector {
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
  private readonly spec: ProviderSpec;
  private readonly endpointUrl: string | null;
  private readonly credentialFields: ProviderCredential;

  constructor(
    options: ProviderConnectorOptions & { type: ObservabilityProviderType },
    private readonly http: ProviderHttp = providerHttp,
  ) {
    this.spec = PROVIDER_SPECS[options.type];
    this.id = options.id;
    this.type = options.type;
    this.riskLevel = options.riskLevel;
    this.permissionLevel = options.permissionLevel;
    this.sideEffectLevel = options.sideEffectLevel;
    this.surfaces = this.spec.surfaces;
    this.evidenceTypes = this.spec.evidenceTypes;
    this.requires = this.spec.requires;
    this.status = options.status;
    this.scopedServiceIds = options.scopedServiceIds;
    this.defaultTimeWindowMinutes = options.defaultTimeWindowMinutes;
    this.outputLimits = options.outputLimits;
    this.endpointUrl = options.endpointUrl
      ? options.endpointUrl.replace(/\/+$/, "")
      : null;
    this.credentialFields = {
      ...(options.credential?.fields ?? {}),
      ...(options.credential?.secret ? { secret: options.credential.secret } : {}),
    };
  }

  metadata(): ConnectorMetadata {
    return {
      id: this.id,
      type: this.type,
      displayName: this.spec.displayName,
      description: this.spec.description,
      surfaces: this.surfaces,
      evidenceTypes: this.evidenceTypes,
      requires: this.requires,
    };
  }

  private context(): ProviderContext {
    return {
      http: this.http,
      credential: this.credentialFields,
      endpointUrl: this.endpointUrl,
    };
  }

  async validate(): Promise<ConnectorValidationResult> {
    const startedAt = Date.now();
    try {
      await this.spec.validate(this.context());
      return { status: "valid", latencyMs: Date.now() - startedAt };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Connector validation failed";
      const lowered = message.toLowerCase();
      return {
        status:
          lowered.includes("credentials rejected") ||
          lowered.includes("invalid credentials")
            ? "invalid_credentials"
            : "unreachable",
        message,
        latencyMs: Date.now() - startedAt,
      };
    }
  }

  async search(params: ConnectorSearchParams): Promise<ConnectorEvidenceItem[]> {
    const maxSeconds = Math.min(
      params.budget.maxSeconds ||
        this.outputLimits.maxSeconds ||
        DEFAULT_CONNECTOR_OUTPUT_LIMITS.maxSeconds,
      30,
    );
    const result = await this.spec.search(this.context(), {
      query: params.query,
      timeWindow: params.timeWindow,
      maxRows: params.budget.maxRows,
      maxBytes: params.budget.maxBytes,
      maxSeconds,
    });
    return result.records
      .slice(0, params.budget.maxRows)
      .map((record) =>
        toEvidenceItem(this, params.query, record, params.timeWindow.end),
      );
  }
}
