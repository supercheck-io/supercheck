/**
 * Security header grade, based on Mozilla HTTP Observatory scoring
 * (httpobs/docs/scoring.md), limited to tests one response can answer.
 */
export type RowStatus = "pass" | "warn" | "fail" | "info";

export interface GradeRow {
  id: string;
  status: RowStatus;
  modifier: number;
  value: string | null;
  note: string;
}

export interface GradeResult {
  grade: string;
  score: number;
  rows: GradeRow[];
}

const BOUNDARIES: [number, string][] = [
  [100, "A+"],
  [90, "A"],
  [85, "A-"],
  [80, "B+"],
  [70, "B"],
  [65, "B-"],
  [60, "C+"],
  [50, "C"],
  [45, "C-"],
  [40, "D+"],
  [30, "D"],
  [25, "D-"],
];

export function letter(score: number): string {
  return BOUNDARIES.find(([min]) => score >= min)?.[1] ?? "F";
}

type Policy = Map<string, string[]>;

/** Splits one or more CSP headers (repeated headers arrive joined by ", ") into policies. */
export function parseCsp(value: string | undefined): Policy[] {
  if (!value) return [];
  return value
    .split(",")
    .map((policy) => {
      const map: Policy = new Map();
      for (const part of policy.split(";")) {
        const [name, ...sources] = part.trim().toLowerCase().split(/\s+/);
        if (name && !map.has(name)) map.set(name, sources);
      }
      return map;
    })
    .filter((map) => map.size > 0);
}

function scriptSources(policy: Policy): string[] | null {
  return policy.get("script-src") ?? policy.get("default-src") ?? null;
}

/** script-src-elem and script-src-attr override script-src for elements and inline handlers. */
function unsafeScripts(policy: Policy): boolean {
  const base = scriptSources(policy);
  return [base, policy.get("script-src-elem") ?? base, policy.get("script-src-attr") ?? base].some(unsafeScript);
}

function unsafeScript(sources: string[] | null): boolean {
  if (sources === null) return true;
  const hasNonceOrHash = sources.some((s) => /^'(nonce-|sha256-|sha384-|sha512-)/.test(s));
  return (
    (sources.includes("'unsafe-inline'") && !hasNonceOrHash) ||
    sources.some((s) => s === "data:" || s === "*" || s === "http:")
  );
}

function objectNone(policy: Policy): boolean {
  const object = policy.get("object-src") ?? policy.get("default-src");
  return object !== undefined && object.length === 1 && object[0] === "'none'";
}

const GOOD_REFERRER = ["no-referrer", "same-origin", "strict-origin", "strict-origin-when-cross-origin"];
const NEUTRAL_REFERRER = ["no-referrer-when-downgrade"];
const BAD_REFERRER = ["unsafe-url", "origin", "origin-when-cross-origin"];

/** `headers` uses lowercase names. Every policy in force applies, so a weakness counts only if all policies share it. */
export function grade(headers: Record<string, string | undefined>, finalUrlIsHttps: boolean): GradeResult {
  const rows: GradeRow[] = [];
  const add = (id: string, status: RowStatus, modifier: number, value: string | undefined, note: string) =>
    rows.push({ id, status, modifier, value: value ?? null, note });

  const cspHeader = headers["content-security-policy"];
  const policies = parseCsp(cspHeader);
  if (policies.length === 0) {
    add("csp", "fail", -25, cspHeader, "Content-Security-Policy is missing");
  } else {
    const unsafe = policies.every(unsafeScripts);
    const unsafeEval = policies.every((p) => (scriptSources(p) ?? ["'unsafe-eval'"]).includes("'unsafe-eval'"));
    if (unsafe) add("csp", "fail", -20, cspHeader, "script-src allows unsafe-inline, data:, * or http:");
    if (unsafeEval) add("csp-eval", "warn", -10, cspHeader, "script-src allows unsafe-eval");
    if (!unsafe && !unsafeEval && policies.some(objectNone)) {
      add("csp", "pass", 5, cspHeader, "Strict policy with object-src 'none'");
    } else if (!unsafe) {
      add("csp", "pass", 0, cspHeader, "Content-Security-Policy is set");
    }
  }

  const hsts = headers["strict-transport-security"];
  if (!finalUrlIsHttps) {
    add("hsts", "fail", -20, hsts, "The final URL is not served over HTTPS");
  } else {
    const parsed = parseHsts(hsts);
    if (!parsed) add("hsts", "fail", -20, hsts, "Strict-Transport-Security is missing or invalid");
    else if (parsed.maxAge < 15_768_000) add("hsts", "warn", -10, hsts, "max-age is shorter than six months");
    else if (parsed.maxAge >= 31_536_000 && parsed.includeSubDomains && parsed.preload)
      add("hsts", "pass", 5, hsts, "Long max-age with includeSubDomains and preload");
    else add("hsts", "pass", 0, hsts, "Strict-Transport-Security is set");
  }

  const xcto = headers["x-content-type-options"];
  if (xcto?.trim().toLowerCase() === "nosniff") add("x-content-type-options", "pass", 0, xcto, "Set to nosniff");
  else add("x-content-type-options", "fail", -5, xcto, "X-Content-Type-Options is not nosniff");

  const xfo = headers["x-frame-options"]?.trim().toLowerCase();
  const frameAncestors = policies.some((p) => p.has("frame-ancestors"));
  if (frameAncestors) add("framing", "pass", 5, headers["x-frame-options"], "CSP frame-ancestors is set");
  else if (xfo === "deny" || xfo === "sameorigin") add("framing", "pass", 0, headers["x-frame-options"], "X-Frame-Options is set");
  else add("framing", "fail", -20, headers["x-frame-options"], "No X-Frame-Options or CSP frame-ancestors");

  const referrer = headers["referrer-policy"];
  if (referrer !== undefined) {
    // Browsers apply the last token they understand.
    const token = referrer
      .toLowerCase()
      .split(",")
      .map((t) => t.trim())
      .filter((t) => [...GOOD_REFERRER, ...NEUTRAL_REFERRER, ...BAD_REFERRER].includes(t))
      .pop();
    if (token && GOOD_REFERRER.includes(token)) add("referrer-policy", "pass", 5, referrer, "Private referrer policy");
    else if (token && NEUTRAL_REFERRER.includes(token)) add("referrer-policy", "info", 0, referrer, "Sends the full URL to HTTPS sites");
    else add("referrer-policy", "warn", -5, referrer, "Referrer policy leaks the full URL, or is invalid");
  } else {
    add("referrer-policy", "info", 0, referrer, "Not set; browsers default to strict-origin-when-cross-origin");
  }

  add("permissions-policy", "info", 0, headers["permissions-policy"], "Shown, not scored");
  add("cross-origin-opener-policy", "info", 0, headers["cross-origin-opener-policy"], "Shown, not scored");

  const penalties = rows.reduce((sum, r) => sum + Math.min(r.modifier, 0), 0);
  const bonuses = rows.reduce((sum, r) => sum + Math.max(r.modifier, 0), 0);
  let score = 100 + penalties;
  // Bonuses count only when the score before bonuses is at least 90.
  if (score >= 90) score += bonuses;
  score = Math.max(score, 0);
  return { grade: letter(score), score, rows };
}

export interface Hsts {
  maxAge: number;
  includeSubDomains: boolean;
  preload: boolean;
}

export function parseHsts(value: string | undefined): Hsts | null {
  if (!value) return null;
  // Repeated headers are joined with ", "; the first one is the one browsers use.
  const directives = value.split(",")[0].split(";").map((d) => d.trim().toLowerCase());
  const maxAge = directives.find((d) => d.startsWith("max-age="));
  const seconds = maxAge ? Number(maxAge.slice(8).replace(/"/g, "")) : NaN;
  if (!Number.isInteger(seconds) || seconds < 0) return null;
  return {
    maxAge: seconds,
    includeSubDomains: directives.includes("includesubdomains"),
    preload: directives.includes("preload"),
  };
}
