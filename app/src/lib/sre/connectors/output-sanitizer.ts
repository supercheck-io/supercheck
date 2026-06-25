import {
  DEFAULT_CONNECTOR_OUTPUT_LIMITS,
  hashConnectorPayload,
  type ConnectorEvidenceItem,
  type ConnectorOutputLimits,
} from "./connector-base";

const REDACTION_PATTERNS: Array<[RegExp, string]> = [
  [/([?&](?:token|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|secret|password)=)[^&#\s]+/gi, "$1[REDACTED]"],
  [/\b(Authorization:\s*Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[REDACTED]"],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[REDACTED]"],
  [/\b(token|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|secret|password|passwd|pwd)\s*[:=]\s*[^\s,;"']+/gi, "$1=[REDACTED]"],
  [/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g, "[REDACTED_GITHUB_TOKEN]"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[REDACTED_SLACK_TOKEN]"],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]"],
];

export type SanitizedConnectorOutput = {
  items: ConnectorEvidenceItem[];
  truncated: boolean;
  resultHash: string;
  byteLength: number;
};

export function redactConnectorText(value: string): string {
  return REDACTION_PATTERNS.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), value);
}

export function sanitizeConnectorEvidence(
  items: ConnectorEvidenceItem[],
  limits: Partial<ConnectorOutputLimits> = {}
): SanitizedConnectorOutput {
  const effectiveLimits = { ...DEFAULT_CONNECTOR_OUTPUT_LIMITS, ...limits };
  const rows = items.slice(0, effectiveLimits.maxRows).map(redactEvidenceItem);
  const budgetedRows: ConnectorEvidenceItem[] = [];
  let byteLength = 0;
  let truncated = items.length > rows.length;

  for (const row of rows) {
    const rowBytes = Buffer.byteLength(JSON.stringify(row), "utf8");
    if (byteLength + rowBytes > effectiveLimits.maxBytes) {
      truncated = true;
      break;
    }

    budgetedRows.push(row);
    byteLength += rowBytes;
  }

  return {
    items: budgetedRows,
    truncated,
    resultHash: hashConnectorPayload({ items: budgetedRows, truncated }),
    byteLength,
  };
}

function redactEvidenceItem(item: ConnectorEvidenceItem): ConnectorEvidenceItem {
  const rawContent = item.rawContent ? redactConnectorText(item.rawContent) : undefined;

  return {
    ...item,
    sourceUri: redactConnectorText(item.sourceUri),
    title: redactConnectorText(item.title),
    summary: redactConnectorText(item.summary),
    rawContent,
    citation: {
      ...item.citation,
      query: redactConnectorText(item.citation.query),
    },
  };
}
