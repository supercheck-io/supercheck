import {
  DEFAULT_CONNECTOR_OUTPUT_LIMITS,
  hashConnectorPayload,
  type ConnectorEvidenceItem,
  type ConnectorOutputLimits,
} from "./connector-base";
import { safeEvidenceSourceUri } from "@/lib/sre/evidence-source-uri";

const REDACTION_PATTERNS: Array<[RegExp, string]> = [
  // The password may contain "/" or "@": greedy to the last "@" before whitespace (bounded, so still linear); a port (then / ? # , or space) is not a password; an IPv6 bracket host is not a user.
  // scheme://user:password@host keeps scheme, user and host; must run before the email pattern, which needs a dotted host.
  [/\b([a-z][a-z0-9+.-]{0,30}:\/\/[^\s:/@\[]{0,200}:)(?!\d{1,5}(?:[/?#,\s]|$))[^\s]{1,500}(@)/gi, "$1[REDACTED]$2"],
  // scheme://<token>@host: the whole user part is a credential (ghp_, glpat-, sk-, xox*, or a long opaque string).
  [/\b([a-z][a-z0-9+.-]{0,30}:\/\/)(?:(?:(?:ghp|gho|ghu|ghs|ghr)_|glpat-|sk-|xox[a-z]-)[A-Za-z0-9_-]+|[A-Za-z0-9_-]{21,200})(@)/gi, "$1[REDACTED]$2"],
  // Provider payloads commonly serialize secrets as quoted JSON fields.
  // Field names that contain a secret word, any case or prefix ("clientSecret", "db_password"); bounded so the scan stays linear.
  [/("[A-Za-z0-9_-]{0,40}(?:token|api[_-]?key|secret|password|passwd|pwd)[A-Za-z0-9_-]{0,20}"\s*:\s*)"(?:\\.|[^"\\])*"/gi, '$1"[REDACTED]"'],
  // Query parameters, including presigned storage URL signatures.
  [/([?&](?:token|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|secret|password|x-amz-(?:signature|credential|security-token)|signature|sig)=)[^&#\s]+/gi, "$1[REDACTED]"],
  [/\b(Authorization:\s*Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[REDACTED]"],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[REDACTED]"],
  // KEY=value whose name ends in a secret word, "_" or "-" separated (DB_PASSWORD, AWS_SECRET_ACCESS_KEY, client_secret).
  // Ending, not containing, so diagnostic names such as token_count or secret_name stay readable.
  [/\b((?:[A-Za-z0-9]{1,30}[_-]){0,4}(?:token|api[_-]?key|key|secret|password|passwd|pwd|pass))\s*[:=]\s*[^\s,;"']+/gi, "$1=[REDACTED]"],
  // camelCase names (clientSecret, apiKey, dbPassword); case-sensitive so "monkey" or "bypass" stay untouched.
  [/\b([a-z][a-z0-9]{0,30}(?:Token|Secret|Password|Passwd|Pwd|Pass|ApiKey|Key))\s*[:=]\s*[^\s,;"']+/g, "$1=[REDACTED]"],
  [/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g, "[REDACTED_GITHUB_TOKEN]"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[REDACTED_SLACK_TOKEN]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_AWS_ACCESS_KEY]"],
  [/\bAIza[0-9A-Za-z_-]{35}(?![A-Za-z0-9_-])/g, "[REDACTED_API_KEY]"],
  [/\b(?:github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|sntrys_[A-Za-z0-9_=+/-]{20,}|[rs]k_live_[A-Za-z0-9]{16,})/g, "[REDACTED_API_KEY]"],
  [/\b(Authorization:\s*Basic\s+)[A-Za-z0-9+/]+=*/gi, "$1[REDACTED]"],
  [/\bhttps:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/gi, "[REDACTED_SLACK_WEBHOOK]"],
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

const MAX_EVIDENCE_TITLE_CHARS = 200;

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
    // Clip after redacting so a secret cut at the limit cannot escape its pattern.
    title: redactConnectorText(item.title).slice(0, MAX_EVIDENCE_TITLE_CHARS),
    summary: redactConnectorText(item.summary),
    rawContent,
    citation: {
      ...item.citation,
      query: redactConnectorText(item.citation.query),
    },
  };
}
