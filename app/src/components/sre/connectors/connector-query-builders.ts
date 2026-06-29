export type ConnectorQueryBuilderField = {
  id: string;
  label: string;
  placeholder: string;
  help: string;
};

export type ConnectorQueryBuilderResult = {
  query: string;
  filters?: Record<string, string>;
};

export type ConnectorQueryBuilder = {
  title: string;
  description: string;
  fields: ConnectorQueryBuilderField[];
  defaults: (serviceName?: string) => Record<string, string>;
  build: (values: Record<string, string>) => ConnectorQueryBuilderResult;
};

function compact(parts: Array<string | null | undefined>) {
  return parts.filter((part): part is string => Boolean(part && part.trim()));
}

function escapeQuotedValue(value: string) {
  return value.trim().replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function normalizeLabelSelectors(value: string) {
  return value
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (entry.includes("=~") || entry.includes("!=") || entry.includes("=")) return entry;
      const separator = entry.indexOf(":");
      if (separator === -1) return entry;

      return `${entry.slice(0, separator).trim()}="${escapeQuotedValue(entry.slice(separator + 1))}"`;
    })
    .join(",");
}

function normalizeDimensions(value: string) {
  return value
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.includes("=") ? entry.indexOf("=") : entry.indexOf(":");
      if (separator <= 0) return null;

      const name = entry.slice(0, separator).trim();
      const dimensionValue = entry.slice(separator + 1).trim();
      return name && dimensionValue ? `dimension:${name}=${dimensionValue}` : null;
    })
    .filter((entry): entry is string => Boolean(entry));
}

function normalizeList(value: string) {
  return value
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function serviceDefault(serviceName?: string) {
  return serviceName?.trim() || "checkout";
}

function jqlValue(value: string) {
  return /^[A-Z][A-Z0-9_]*$/.test(value.trim().toUpperCase())
    ? value.trim().toUpperCase()
    : `"${escapeQuotedValue(value)}"`;
}

function quotedValue(value: string) {
  return `"${escapeQuotedValue(value)}"`;
}

function slackChannel(value: string) {
  const trimmed = value.trim().replace(/^#/, "");
  return trimmed ? `#${trimmed}` : "";
}

const builders: Record<string, ConnectorQueryBuilder> = {
  aws_cloudwatch: {
    title: "CloudWatch query builder",
    description: "Build an alarm lookup or metric-data query with explicit dimensions, statistic, and period.",
    fields: [
      {
        id: "alarmPrefix",
        label: "Alarm prefix",
        placeholder: "checkout",
        help: "Used when namespace and metric name are empty.",
      },
      {
        id: "alarmState",
        label: "Alarm state",
        placeholder: "ALARM",
        help: "Optional: OK, ALARM, or INSUFFICIENT_DATA.",
      },
      {
        id: "namespace",
        label: "Metric namespace",
        placeholder: "AWS/ApplicationELB",
        help: "Set with metric name to build a metric-data query.",
      },
      {
        id: "metricName",
        label: "Metric name",
        placeholder: "TargetResponseTime",
        help: "CloudWatch metric name for bounded metric-data searches.",
      },
      {
        id: "dimensions",
        label: "Dimensions",
        placeholder: "LoadBalancer=app/checkout",
        help: "Comma or newline separated Name=Value pairs.",
      },
      {
        id: "statistic",
        label: "Statistic",
        placeholder: "Average",
        help: "Example: Average, Sum, p95, Maximum.",
      },
      {
        id: "periodSeconds",
        label: "Period seconds",
        placeholder: "60",
        help: "Connector clamps periods to the safe CloudWatch range.",
      },
    ],
    defaults: (serviceName) => ({
      alarmPrefix: serviceDefault(serviceName),
      alarmState: "ALARM",
      namespace: "",
      metricName: "",
      dimensions: "",
      statistic: "Average",
      periodSeconds: "60",
    }),
    build: (values) => {
      const namespace = values.namespace?.trim();
      const metricName = values.metricName?.trim();

      if (namespace && metricName) {
        return {
          query: compact([
            `namespace:${namespace}`,
            `metric:${metricName}`,
            ...normalizeDimensions(values.dimensions ?? ""),
            values.statistic?.trim() ? `stat:${values.statistic.trim()}` : null,
            values.periodSeconds?.trim() ? `period:${values.periodSeconds.trim()}` : null,
          ]).join(" "),
        };
      }

      return {
        query: compact([
          values.alarmPrefix?.trim() ? `prefix:${values.alarmPrefix.trim()}` : null,
          values.alarmState?.trim() ? `state:${values.alarmState.trim().toUpperCase()}` : null,
        ]).join(" ") || "*",
      };
    },
  },
  loki: {
    title: "LogQL query builder",
    description: "Build a label-first LogQL query so searches stay service-scoped before text matching.",
    fields: [
      {
        id: "labels",
        label: "Labels",
        placeholder: 'service="checkout",env="prod"',
        help: "Comma or newline separated LogQL label matchers.",
      },
      {
        id: "contains",
        label: "Contains text",
        placeholder: "error",
        help: "Adds an exact text filter with |=.",
      },
      {
        id: "regex",
        label: "Regex text",
        placeholder: "timeout|deadline|upstream",
        help: "Optional regex filter with |~. Used only when contains is empty.",
      },
    ],
    defaults: (serviceName) => ({
      labels: `service="${escapeQuotedValue(serviceDefault(serviceName))}"`,
      contains: "error",
      regex: "",
    }),
    build: (values) => {
      const labels = normalizeLabelSelectors(values.labels ?? "");
      const selector = `{${labels || 'service="checkout"'}}`;
      const contains = values.contains?.trim();
      const regex = values.regex?.trim();

      if (contains) return { query: `${selector} |= "${escapeQuotedValue(contains)}"` };
      if (regex) return { query: `${selector} |~ "${escapeQuotedValue(regex)}"` };
      return { query: selector };
    },
  },
  elasticsearch: {
    title: "Elasticsearch query builder",
    description: "Build a query-string search plus index and timestamp filters for bounded log searches.",
    fields: [
      {
        id: "queryString",
        label: "Query string",
        placeholder: "service.name:checkout AND (error OR exception)",
        help: "Elasticsearch query-string syntax. Time bounds are added by SuperCheck.",
      },
      {
        id: "index",
        label: "Index pattern",
        placeholder: "logs-*",
        help: "Optional approved index or alias pattern.",
      },
      {
        id: "timestampField",
        label: "Timestamp field",
        placeholder: "@timestamp",
        help: "Timestamp field used for the incident time-window filter.",
      },
    ],
    defaults: (serviceName) => ({
      queryString: `service.name:${serviceDefault(serviceName)} AND (error OR exception)`,
      index: "logs-*",
      timestampField: "@timestamp",
    }),
    build: (values) => {
      const filters: Record<string, string> = {};
      const index = values.index?.trim();
      const timestampField = values.timestampField?.trim();
      if (index) filters.index = index;
      if (timestampField) filters.timestampField = timestampField;

      return {
        query: values.queryString?.trim() || "error",
        filters: Object.keys(filters).length > 0 ? filters : undefined,
      };
    },
  },
  tempo: {
    title: "Tempo query builder",
    description: "Build a TraceQL snippet or service/duration search that maps to Tempo's read-only search API.",
    fields: [
      {
        id: "traceQl",
        label: "TraceQL",
        placeholder: '{ resource.service.name = "checkout" && status = error }',
        help: "If provided, TraceQL is used directly.",
      },
      {
        id: "service",
        label: "Service",
        placeholder: "checkout",
        help: "Used for tag search when TraceQL is empty.",
      },
      {
        id: "operation",
        label: "Operation",
        placeholder: "POST /checkout",
        help: "Optional span operation/name tag.",
      },
      {
        id: "minDuration",
        label: "Min duration",
        placeholder: "1s",
        help: "Optional Tempo duration filter, such as 500ms or 1s.",
      },
      {
        id: "maxDuration",
        label: "Max duration",
        placeholder: "10s",
        help: "Optional upper duration filter.",
      },
    ],
    defaults: (serviceName) => ({
      traceQl: "",
      service: serviceDefault(serviceName),
      operation: "",
      minDuration: "1s",
      maxDuration: "",
    }),
    build: (values) => {
      const traceQl = values.traceQl?.trim();
      if (traceQl) return { query: traceQl };

      return {
        query: compact([
          values.service?.trim() ? `service:${values.service.trim()}` : null,
          values.operation?.trim() ? `operation:${values.operation.trim()}` : null,
          values.minDuration?.trim() ? `minDuration:${values.minDuration.trim()}` : null,
          values.maxDuration?.trim() ? `maxDuration:${values.maxDuration.trim()}` : null,
        ]).join(" ") || "*",
      };
    },
  },
  jira: {
    title: "Jira JQL builder",
    description: "Build a read-only ticket/change query scoped to project, labels, status, text, and recency.",
    fields: [
      {
        id: "projectKey",
        label: "Project key",
        placeholder: "CHECKOUT",
        help: "Optional Jira project key. Use the narrowest project that maps to the service.",
      },
      {
        id: "serviceLabel",
        label: "Service label",
        placeholder: "checkout",
        help: "Optional label used by your incident, deploy, or service tickets.",
      },
      {
        id: "statuses",
        label: "Statuses",
        placeholder: "Incident, In Progress",
        help: "Comma or newline separated Jira statuses.",
      },
      {
        id: "text",
        label: "Text search",
        placeholder: "checkout latency",
        help: "Optional JQL text search for symptoms, services, or change keywords.",
      },
      {
        id: "updatedWithin",
        label: "Updated within",
        placeholder: "-14d",
        help: "JQL relative date such as -24h, -7d, or -30d.",
      },
    ],
    defaults: (serviceName) => ({
      projectKey: serviceDefault(serviceName).toUpperCase().replace(/[^A-Z0-9_]/g, "_"),
      serviceLabel: serviceDefault(serviceName),
      statuses: "Incident, In Progress",
      text: serviceDefault(serviceName),
      updatedWithin: "-14d",
    }),
    build: (values) => {
      const statuses = normalizeList(values.statuses ?? "");

      return {
        query: compact([
          values.projectKey?.trim() ? `project = ${jqlValue(values.projectKey)}` : null,
          values.serviceLabel?.trim() ? `labels = ${quotedValue(values.serviceLabel)}` : null,
          statuses.length ? `status in (${statuses.map(quotedValue).join(", ")})` : null,
          values.text?.trim() ? `text ~ ${quotedValue(values.text)}` : null,
          values.updatedWithin?.trim() ? `updated >= ${values.updatedWithin.trim()}` : null,
        ]).join(" AND ") || "updated >= -7d",
      };
    },
  },
  confluence: {
    title: "Confluence CQL builder",
    description: "Build a read-only knowledge-base query for runbooks, postmortems, and service docs.",
    fields: [
      {
        id: "spaceKey",
        label: "Space key",
        placeholder: "SRE",
        help: "Optional Confluence space key for operational docs.",
      },
      {
        id: "contentType",
        label: "Content type",
        placeholder: "page",
        help: "Usually page or blogpost.",
      },
      {
        id: "serviceTerm",
        label: "Service term",
        placeholder: "checkout",
        help: "Service, component, or team keyword to match in content.",
      },
      {
        id: "text",
        label: "Text search",
        placeholder: "latency runbook",
        help: "Optional symptom or runbook keyword search.",
      },
      {
        id: "updatedWithin",
        label: "Updated within",
        placeholder: "-30d",
        help: "CQL relative date for lastmodified, such as -7d or -90d.",
      },
    ],
    defaults: (serviceName) => ({
      spaceKey: "SRE",
      contentType: "page",
      serviceTerm: serviceDefault(serviceName),
      text: "runbook",
      updatedWithin: "-90d",
    }),
    build: (values) => ({
      query: compact([
        values.spaceKey?.trim() ? `space = ${quotedValue(values.spaceKey)}` : null,
        values.contentType?.trim() ? `type = ${quotedValue(values.contentType)}` : null,
        values.serviceTerm?.trim() ? `text ~ ${quotedValue(values.serviceTerm)}` : null,
        values.text?.trim() ? `text ~ ${quotedValue(values.text)}` : null,
        values.updatedWithin?.trim() ? `lastmodified >= now(${quotedValue(values.updatedWithin)})` : null,
      ]).join(" AND ") || 'type = "page"',
    }),
  },
  notion: {
    title: "Notion search query builder",
    description: "Build a conservative text query for service runbooks and postmortems before live API execution is added.",
    fields: [
      {
        id: "query",
        label: "Search text",
        placeholder: "checkout incident runbook",
        help: "Plain text sent to Notion search once the live adapter is enabled.",
      },
      {
        id: "objectType",
        label: "Object type hint",
        placeholder: "page",
        help: "Optional operator hint: page or database.",
      },
      {
        id: "dataSource",
        label: "Data source hint",
        placeholder: "sre-runbooks",
        help: "Optional workspace/database label used only as query text today.",
      },
    ],
    defaults: (serviceName) => ({
      query: `${serviceDefault(serviceName)} incident runbook`,
      objectType: "page",
      dataSource: "",
    }),
    build: (values) => ({
      query: compact([
        values.query?.trim(),
        values.objectType?.trim() ? `type:${values.objectType.trim()}` : null,
        values.dataSource?.trim() ? `source:${values.dataSource.trim()}` : null,
      ]).join(" ") || "incident runbook",
    }),
  },
  slack: {
    title: "Slack message search builder",
    description: "Build a read-only incident-channel query using Slack search syntax.",
    fields: [
      {
        id: "channel",
        label: "Channel",
        placeholder: "#incidents",
        help: "Optional channel filter. Include or omit the leading #.",
      },
      {
        id: "serviceTerm",
        label: "Service term",
        placeholder: "checkout",
        help: "Service or component keyword.",
      },
      {
        id: "text",
        label: "Text search",
        placeholder: "latency timeout",
        help: "Symptoms, error terms, incident IDs, or deploy keywords.",
      },
      {
        id: "afterDate",
        label: "After date",
        placeholder: "2026-06-01",
        help: "Optional Slack after:YYYY-MM-DD filter for bounded historical searches.",
      },
    ],
    defaults: (serviceName) => ({
      channel: "#incidents",
      serviceTerm: serviceDefault(serviceName),
      text: "incident",
      afterDate: "",
    }),
    build: (values) => ({
      query: compact([
        values.channel?.trim() ? `in:${slackChannel(values.channel)}` : null,
        values.serviceTerm?.trim(),
        values.text?.trim(),
        values.afterDate?.trim() ? `after:${values.afterDate.trim()}` : null,
      ]).join(" ") || "incident",
    }),
  },
};

export function getConnectorQueryBuilder(type: string) {
  return builders[type] ?? null;
}
