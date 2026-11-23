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
  // Field names ending in a secret word, any case or prefix ("clientSecret", "db_password"), so "tokenizer" or
  // "token_count" stay readable; bounded so the scan stays linear.
  [/("[A-Za-z0-9_-]{0,40}(?:token|api[_-]?key|secret|password|passwd|pwd|credentials?|authorization)"\s*:\s*)"(?:\\.|[^"\\])*"/gi, '$1"[REDACTED]"'],
  // Query parameters, including presigned storage URL signatures.
  [/([?&](?:token|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|secret|password|x-amz-(?:signature|credential|security-token)|signature|sig)=)[^&#\s]+/gi, "$1[REDACTED]"],
  [/\b(Authorization:\s*Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[REDACTED]"],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[REDACTED]"],
  // KEY=value whose name ends in a secret word, "_" or "-" separated (DB_PASSWORD, AWS_SECRET_ACCESS_KEY, client_secret).
  // Ending, not containing, so diagnostic names such as token_count or secret_name stay readable.
  [/\b((?:[A-Za-z0-9]{1,30}[_-]){0,4}(?:token|api[_-]?key|key|secret|password|passwd|pwd|pass))\s*[:=]\s*(?:"[^"\n]{0,500}"|'[^'\n]{0,500}'|[^\s,;"']+)/gi, "$1=[REDACTED]"],
  // camelCase names (clientSecret, apiKey, dbPassword); case-sensitive so "monkey" or "bypass" stay untouched.
  [/\b([a-z][a-z0-9]{0,30}(?:Token|Secret|Password|Passwd|Pwd|Pass|ApiKey|Key))\s*[:=]\s*(?:"[^"\n]{0,500}"|'[^'\n]{0,500}'|[^\s,;"']+)/g, "$1=[REDACTED]"],
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

const MIN_EXACT_SECRET_CHARS = 6;

// Credential fields that hold a secret. Identifiers (region, tenant, subscription, header name, user) appear in
// legitimate evidence and links, so they are left to the patterns.
const SECRET_CREDENTIAL_KEY = /secret|token|password|passwd|pwd|apikey|api_key|key$|credential|private/i;

/** Secret values of a connector credential (raw and trimmed), for exact-match redaction of output that echoes them. */
export function connectorCredentialSecrets(credential: Record<string, unknown> | null | undefined): string[] {
  const values = Object.entries(credential ?? {})
    .filter(([key, value]) => typeof value === "string" && SECRET_CREDENTIAL_KEY.test(key))
    .flatMap(([, value]) => [value as string, (value as string).trim()]);
  return [...new Set(values)];
}

/**
 * Replaces every occurrence of the connector's own secrets, which patterns cannot recognise (a short
 * opaque password, a custom header value). Overlapping matches are merged so no fragment is left behind;
 * the same approach as the Private Agent's redactMcpText.
 */
export function redactExactSecrets(value: string, secrets: readonly string[]): string {
  const spans: Array<[number, number]> = [];
  for (const secret of secrets) {
    if (secret.length < MIN_EXACT_SECRET_CHARS) continue;
    for (let i = value.indexOf(secret); i !== -1; i = value.indexOf(secret, i + 1)) spans.push([i, i + secret.length]);
  }
  if (spans.length === 0) return value;
  spans.sort((a, b) => a[0] - b[0]);
  let redacted = "";
  let cursor = 0;
  for (const [start, end] of spans) {
    if (start < cursor) {
      cursor = Math.max(cursor, end);
      continue;
    }
    redacted += `${value.slice(cursor, start)}[REDACTED]`;
    cursor = end;
  }
  return redacted + value.slice(cursor);
}

export function sanitizeConnectorEvidence(
  items: ConnectorEvidenceItem[],
  limits: Partial<ConnectorOutputLimits> = {},
  secrets: readonly string[] = [],
): SanitizedConnectorOutput {
  const effectiveLimits = { ...DEFAULT_CONNECTOR_OUTPUT_LIMITS, ...limits };
  const rows = items.slice(0, effectiveLimits.maxRows).map((item) => redactEvidenceItem(item, secrets));
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

function redactEvidenceItem(item: ConnectorEvidenceItem, secrets: readonly string[]): ConnectorEvidenceItem {
  // Exact secrets first: a pattern rewrite could split a secret and hide it from the exact match.
  const redact = (value: string) => redactConnectorText(redactExactSecrets(value, secrets));
  const rawContent = item.rawContent ? redact(item.rawContent) : undefined;

  return {
    ...item,
    sourceUri: safeEvidenceSourceUri(redact(item.sourceUri)),
    // Clip after redacting so a secret cut at the limit cannot escape its pattern.
    title: redact(item.title).slice(0, MAX_EVIDENCE_TITLE_CHARS),
    summary: redact(item.summary),
    rawContent,
    citation: {
      ...item.citation,
      query: redact(item.citation.query),
    },
  };
}
