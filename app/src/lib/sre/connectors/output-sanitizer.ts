import {
  DEFAULT_CONNECTOR_OUTPUT_LIMITS,
  hashConnectorPayload,
  type ConnectorEvidenceItem,
  type ConnectorOutputLimits,
} from "./connector-base";
import { safeEvidenceSourceUri } from "@/lib/sre/evidence-source-uri";

const REDACTION_PATTERNS: Array<[RegExp, string]> = [
  // Provider payloads commonly serialize secrets as quoted JSON fields.
  [/("(?:token|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|secret|password|passwd|pwd)"\s*:\s*)"(?:\\.|[^"\\])*"/gi, '$1"[REDACTED]"'],
  [/([?&](?:token|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|secret|password)=)[^&#\s]+/gi, "$1[REDACTED]"],
  [/\b(Authorization:\s*Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[REDACTED]"],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[REDACTED]"],
  [/\b(token|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|secret|password|passwd|pwd)\s*[:=]\s*[^\s,;"']+/gi, "$1=[REDACTED]"],
  [/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g, "[REDACTED_GITHUB_TOKEN]"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[REDACTED_SLACK_TOKEN]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_AWS_ACCESS_KEY]"],
  // Lookarounds (not \b) keep this linear: "-" is a class member, so \b would restart a scan at every "-eyJ".
  [/(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?![A-Za-z0-9_-])/g, "[REDACTED_JWT]"],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_API_KEY]"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, "[REDACTED_PRIVATE_KEY]"],
  // Start-anchored and length-bounded (local part capped at 254, domain at 255) so a long run without "@" is scanned once.
  [/(?<![A-Z0-9._%+-])[A-Z0-9._%+-]{1,254}@[A-Z0-9.-]{1,255}\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]"],
];

export type SanitizedConnectorOutput = {
  items: ConnectorEvidenceItem[];
  truncated: boolean;
  resultHash: string;
  byteLength: number;
};

// Redaction is O(n) per pattern; bound n so one oversized log line cannot stall the event loop.
const MAX_REDACTION_INPUT_CHARS = 64 * 1024;

export function redactConnectorText(value: string): string {
  const bounded = value.length > MAX_REDACTION_INPUT_CHARS
      ? `${value.slice(0, MAX_REDACTION_INPUT_CHARS)} [TRUNCATED]`
      : value;
  return REDACTION_PATTERNS.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), bounded);
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
    sourceUri: safeEvidenceSourceUri(redactConnectorText(item.sourceUri)),
    title: redactConnectorText(item.title),
    summary: redactConnectorText(item.summary),
    rawContent,
    citation: {
      ...item.citation,
      query: redactConnectorText(item.citation.query),
    },
  };
}
