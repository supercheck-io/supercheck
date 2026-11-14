"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { loadableImage, type ToolId } from "../../lib/tools-funnel";

// Every target-controlled value below is rendered as React text. Never as href, HTML or markdown.
type R = Record<string, unknown>;
type Tone = "pass" | "warn" | "fail" | "info";

const str = (v: unknown): string | null => (typeof v === "string" ? v : typeof v === "number" ? String(v) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const arr = <T = R,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const obj = (v: unknown): R => (v && typeof v === "object" && !Array.isArray(v) ? (v as R) : {});

const TONE: Record<Tone, { icon: typeof CheckCircle2; className: string; label: string }> = {
  pass: { icon: CheckCircle2, className: "text-success", label: "Pass" },
  warn: { icon: AlertTriangle, className: "text-warning", label: "Warning" },
  fail: { icon: XCircle, className: "text-failure", label: "Fail" },
  info: { icon: Info, className: "text-fd-muted-foreground", label: "Info" },
};

export function Status({ tone, label }: { tone: Tone; label?: string }) {
  const t = TONE[tone];
  const Icon = t.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${t.className}`}>
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {label ?? t.label}
    </span>
  );
}

function Verdict({ tone, title, sub, badge }: { tone: Tone; title: string; sub?: string | null; badge?: string }) {
  const t = TONE[tone];
  const Icon = t.icon;
  return (
    <div className="flex items-start gap-4 p-4 sm:p-6" data-testid="tool-verdict">
      {badge ? (
        <span className={`inline-flex size-14 shrink-0 items-center justify-center rounded-lg border border-fd-border text-2xl font-semibold ${t.className}`}>{badge}</span>
      ) : (
        <Icon className={`mt-0.5 size-6 shrink-0 ${t.className}`} aria-hidden="true" />
      )}
      <div className="min-w-0">
        <p className="text-lg font-semibold">{title}</p>
        {sub && <p className="mt-1 break-words text-sm text-fd-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

function Rows({ head, rows }: { head: string[]; rows: (React.ReactNode | string | null)[][] }) {
  return (
    <div className="overflow-x-auto border-t border-fd-border">
      <table className="w-full min-w-[480px] text-left text-sm">
        <thead className="text-xs text-fd-muted-foreground">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-4 py-2 font-medium sm:px-6">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-fd-border align-top">
              {row.map((cell, j) => (
                <td key={j} className={`px-4 py-2.5 sm:px-6 ${j === row.length - 1 ? "break-all font-mono text-xs" : ""}`}>
                  {cell ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STOP_COPY: Record<string, string> = {
  private_address: "This name points to a private or reserved address, so we didn't check it.",
  no_address: "This name has no public address.",
  dns_error: "We couldn't resolve this name.",
  blocked_host: "This site's owner has asked us not to check it.",
  target_rate_limited: "This site has been checked many times in the last minute. Try again shortly.",
  too_many_hosts: "The redirects touched too many hosts, so we stopped.",
  off_site_redirect: "A redirect left the site, so we stopped.",
  subrequest_budget: "This check needed more requests than we allow, so we stopped.",
  deadline: "The check took too long and was stopped.",
  internal_error: "Something went wrong on our side. Try again later.",
};

function hopsText(hops: unknown): string | null {
  const list = arr(hops).map((h) => `${str(h.host) ?? "?"} (${str(h.status) ?? "?"})`);
  return list.length ? list.join(" → ") : null;
}

export function ToolResult({ tool, result }: { tool: ToolId; result: R }) {
  if (typeof result.stopped === "string") {
    const reason = str(result.reason) ?? "";
    const redirect = result.stopped === "blocked_redirect";
    return (
      <Verdict
        tone={result.stopped === "limited" ? "warn" : "fail"}
        title={result.stopped === "limited" ? "Check stopped" : redirect ? "Redirect blocked" : "Not checked"}
        sub={(redirect ? "A redirect went somewhere we don't check. " : "") + (STOP_COPY[reason] ?? `Reason: ${reason}`)}
      />
    );
  }
  switch (tool) {
    case "uptime":
      return <Uptime r={result} />;
    case "api":
      return <Api r={result} />;
    case "https":
      return <Https r={result} />;
    case "headers":
      return <Headers r={result} />;
    case "agents":
      return <Agents r={result} />;
    case "dns":
      return <Dns r={result} />;
    case "social":
      return <Social r={result} />;
    case "domain":
      return <Domain r={result} />;
  }
}

const ERROR_COPY: Record<string, string> = {
  too_many_redirects: "Too many redirects",
  timeout: "Timed out",
  tls_error: "TLS or certificate error",
  dns_error: "DNS error",
  connection_failed: "Connection failed",
};
const errorText = (e: unknown) => ERROR_COPY[str(e) ?? ""] ?? str(e);

function Uptime({ r }: { r: R }) {
  const up = r.up === true;
  const time = num(r.timeMs);
  return (
    <>
      <Verdict
        tone={up ? "pass" : "fail"}
        title={up ? `Up · ${str(r.status)}` : `Down · ${r.error ? errorText(r.error) : str(r.status)}`}
        sub={time !== null ? `${time} ms to the first response` : null}
      />
      <Rows
        head={["", "Value"]}
        rows={[
          ["Status", str(r.status)],
          ["Final URL", str(r.finalUrl)],
          ["Redirects", hopsText(r.hops) ?? "None"],
          ["Server header", str(r.server)],
        ]}
      />
    </>
  );
}

function Api({ r }: { r: R }) {
  const ok = r.responding === true;
  const json: Record<string, string> = { valid: "Valid", invalid: "Invalid", not_json: "Not JSON", truncated: "Not checked (over 64 KB)", not_read: "Not read (HEAD)" };
  return (
    <>
      <Verdict tone={ok ? "pass" : "fail"} title={ok ? `Responding · ${str(r.status)}` : `Error · ${r.error ? errorText(r.error) : str(r.status)}`} sub={num(r.timeMs) !== null ? `${num(r.timeMs)} ms` : null} />
      <Rows
        head={["", "Value"]}
        rows={[
          ["Status", str(r.status)],
          ["Content type", str(r.contentType)],
          ["JSON", json[str(r.json) ?? ""] ?? null],
          ["CORS origin", str(r.cors)],
          ["Cache-Control", str(r.cacheControl)],
          ["Redirects", hopsText(r.hops) ?? "None"],
        ]}
      />
    </>
  );
}

function Https({ r }: { r: R }) {
  const hsts = obj(r.hsts);
  const problems = num(r.problems) ?? 0;
  const preload: Record<string, string> = { preloaded: "Preloaded", pending: "Pending", unknown: "Not on the list", error: "Couldn't ask hstspreload.org" };
  return (
    <>
      <Verdict tone={r.ok === true ? "pass" : "warn"} title={r.ok === true ? "HTTPS OK" : `${problems} problem${problems === 1 ? "" : "s"} found`} />
      <Rows
        head={["Check", "Result", "What we saw"]}
        rows={[
          ["Certificate valid", <Status key="c" tone={r.certificateValid ? "pass" : "fail"} label={r.certificateValid ? "Yes" : "No"} />, r.certificateValid ? "HTTPS connection succeeded" : errorText(r.certificateError)],
          ["HTTP → HTTPS", <Status key="h" tone={r.redirectsToHttps ? "pass" : "fail"} label={r.redirectsToHttps ? "Pass" : "No"} />, hopsText(r.httpHops)],
          [
            "HSTS",
            <Status key="s" tone={r.hsts ? "pass" : "fail"} label={r.hsts ? "Present" : "Missing"} />,
            r.hsts ? `max-age ${num(hsts.maxAgeDays)} days${hsts.includeSubDomains ? ", includeSubDomains" : ""}${hsts.preload ? ", preload" : ""}` : null,
          ],
          ["Preload list", <Status key="p" tone="info" label={preload[str(r.preload) ?? ""] ?? "Unknown"} />, "hstspreload.org"],
          ["Expiry date and issuer", <Status key="e" tone="info" label="Not visible" />, "A Supercheck website monitor with SSL checks tracks expiry."],
        ]}
      />
    </>
  );
}

const HEADER_LABEL: Record<string, string> = {
  csp: "Content-Security-Policy",
  "csp-eval": "CSP unsafe-eval",
  hsts: "Strict-Transport-Security",
  "x-content-type-options": "X-Content-Type-Options",
  framing: "Framing (X-Frame-Options / frame-ancestors)",
  "referrer-policy": "Referrer-Policy",
  "permissions-policy": "Permissions-Policy",
  "cross-origin-opener-policy": "Cross-Origin-Opener-Policy",
};
const MDN = "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/";
const HEADER_DOC: Record<string, string> = {
  csp: "Content-Security-Policy",
  "csp-eval": "Content-Security-Policy",
  hsts: "Strict-Transport-Security",
  "x-content-type-options": "X-Content-Type-Options",
  framing: "X-Frame-Options",
  "referrer-policy": "Referrer-Policy",
  "permissions-policy": "Permissions-Policy",
  "cross-origin-opener-policy": "Cross-Origin-Opener-Policy",
};

function Headers({ r }: { r: R }) {
  if (r.error) return <Verdict tone="fail" title="Couldn't fetch the page" sub={errorText(r.error)} />;
  const grade = str(r.grade) ?? "?";
  const tone: Tone = grade.startsWith("A") ? "pass" : grade.startsWith("B") || grade.startsWith("C") ? "warn" : "fail";
  const rows = arr(r.rows);
  return (
    <>
      <Verdict tone={tone} badge={grade} title={`Grade ${grade} · score ${num(r.score)}`} sub={str(r.finalUrl)} />
      <Rows
        head={["Header", "Result", "Score", "Seen"]}
        rows={rows.map((row) => {
          const id = str(row.id) ?? "";
          const mod = num(row.modifier) ?? 0;
          return [
            <span key="n">
              {HEADER_LABEL[id] ?? id}
              <span className="block text-xs text-fd-muted-foreground">
                {str(row.note)} ·{" "}
                <a href={`${MDN}${HEADER_DOC[id] ?? ""}`} target="_blank" rel="noopener noreferrer" className="text-fd-primary hover:underline">
                  MDN
                </a>
              </span>
            </span>,
            <Status key="s" tone={(str(row.status) as Tone) ?? "info"} />,
            mod > 0 ? `+${mod}` : String(mod),
            str(row.value)?.slice(0, 300) ?? null,
          ];
        })}
      />
    </>
  );
}

const AGENT_LABEL: Record<string, string> = { https: "HTTPS", llms_txt: "llms.txt", ai_crawlers: "AI search and user agents", not_blocked: "Not blocked for agents" };

function Agents({ r }: { r: R }) {
  const passed = num(r.passed) ?? 0;
  const total = num(r.total) ?? 4;
  const discovery = obj(r.discovery);
  const card = obj(discovery.agentCard);
  const mcp = obj(discovery.mcp);
  const training = arr(r.training);
  return (
    <>
      <Verdict tone={passed === total ? "pass" : "warn"} badge={`${passed}/${total}`} title={`${passed} of ${total} checks pass`} sub={r.robotsTruncated ? "robots.txt was over 128 KB; we read the first 128 KB." : null} />
      <Rows
        head={["Check", "Result", "What we saw"]}
        rows={arr(r.checks).map((c) => [AGENT_LABEL[str(c.id) ?? ""] ?? str(c.id), <Status key="s" tone={(str(c.status) as Tone) ?? "info"} />, str(c.detail)])}
      />
      <Rows
        head={["Discovery (not counted)", "Result", "What we saw"]}
        rows={[
          ["A2A agent card", <Status key="a" tone={(str(card.status) as Tone) ?? "info"} label={card.status === "info" ? "Not published" : card.status === "pass" ? "Published" : "Incomplete"} />, str(card.name) ?? (arr<string>(card.missing).join(", ") || "/.well-known/agent-card.json")],
          ["MCP server", <Status key="m" tone={mcp.status === "pass" ? "pass" : "info"} label={mcp.status === "pass" ? "Published" : "Not published"} />, str(mcp.path) ?? "/.well-known/ai-catalog.json"],
          ["Training crawlers", <Status key="t" tone="info" label="Your choice" />, training.map((t) => `${str(t.agent)} ${t.allowed ? "allowed" : "blocked"}`).join(" · ") || null],
        ]}
      />
    </>
  );
}

function Dns({ r }: { r: R }) {
  if (r.resolves === false) return <Verdict tone="fail" title="Domain does not resolve" sub={`${str(r.domain)} · NXDOMAIN`} />;
  const records = obj(r.records);
  const count = num(r.count) ?? 0;
  const rows = Object.entries(records).flatMap(([type, list]) => arr(list).map((rec) => [type, str(rec.ttl), str(rec.data)]));
  return (
    <>
      <Verdict
        tone={count > 0 ? "pass" : "warn"}
        title={`${count} record${count === 1 ? "" : "s"} found`}
        sub={`${str(r.domain)} · ${r.dnssec ? "DNSSEC validated" : "DNSSEC not validated"}${num(r.failedQueries) ? ` · ${num(r.failedQueries)} queries failed` : ""}`}
      />
      {rows.length > 0 && <Rows head={["Type", "TTL", "Data"]} rows={rows} />}
    </>
  );
}

function Social({ r }: { r: R }) {
  const [show, setShow] = useState(false);
  if (r.error) return <Verdict tone="fail" title="Couldn't fetch the page" sub={errorText(r.error)} />;
  const tags = obj(r.tags);
  const missing = arr<string>(r.missing);
  const image = r.image ? obj(r.image) : null;
  const src = image && image.loadable === true ? loadableImage(image.url) : null;
  const title = str(tags["og:title"]) ?? str(tags["twitter:title"]) ?? str(r.title);
  const description = str(tags["og:description"]) ?? str(tags["twitter:description"]) ?? str(r.description);
  return (
    <>
      <Verdict tone={missing.length ? "warn" : "pass"} title={missing.length ? `${missing.length} tags missing` : "Preview ready"} />
      <div className="px-4 pb-4 sm:px-6 sm:pb-6">
        <div className="max-w-md overflow-hidden rounded-lg border border-fd-border" data-testid="social-card">
          <div className="flex aspect-[1.91/1] items-center justify-center bg-fd-muted text-xs text-fd-muted-foreground">
            {show && src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src} alt="" referrerPolicy="no-referrer" className="size-full object-cover" data-testid="social-image" />
            ) : src ? (
              <button type="button" className="rounded-md border border-fd-border bg-fd-background px-3 py-1.5 text-sm" onClick={() => setShow(true)}>
                Show image
              </button>
            ) : image ? (
              image.loadable === false && str(image.url)?.startsWith("http:") ? "Not loaded (http)" : "No loadable image"
            ) : (
              "No og:image"
            )}
          </div>
          <div className="p-3">
            <p className="truncate text-xs text-fd-muted-foreground">{str(r.finalUrl) ? hostOf(str(r.finalUrl)!) : null}</p>
            <p className="font-semibold">{title ?? "No title"}</p>
            <p className="line-clamp-2 text-sm text-fd-muted-foreground">{description ?? "No description"}</p>
          </div>
        </div>
      </div>
      <Rows
        head={["Tag", "Result", "Value"]}
        rows={[
          ...Object.entries(tags).map(([k, v]) => [k, <Status key="f" tone="pass" label="Found" />, str(v)]),
          ...missing.map((k) => [k, <Status key="m" tone="warn" label="Missing" />, null]),
          ...(image
            ? [["og:image check", <Status key="i" tone={image.reachable ? "pass" : "fail"} label={image.reachable ? "Loads" : "Problem"} />, [str(image.url), str(image.contentType), num(image.bytes) !== null ? `${num(image.bytes)} bytes` : null, str(image.reason)].filter(Boolean).join(" · ")]]
            : []),
        ]}
      />
    </>
  );
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function Domain({ r }: { r: R }) {
  if (r.hasData !== true) {
    const reason = str(r.reason);
    const title = reason === "no_rdap_service" ? `Not available for .${str(r.tld)}` : reason === "not_found" ? "Domain not found" : "Expiry date not available";
    const sub =
      reason === "no_rdap_service"
        ? `${str(r.domain)} · the .${str(r.tld)} registry publishes no RDAP data. We never guess a date; check your registrar's dashboard.`
        : reason === "not_found"
          ? `${str(r.domain)} · the registry has no record of it.`
          : `${str(r.domain)} · the registry didn't publish an expiry date.`;
    return <Verdict tone="info" title={title} sub={sub} />;
  }
  const days = num(r.daysLeft) ?? 0;
  const date = str(r.expires) ? new Date(str(r.expires)!).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
  return (
    <>
      <Verdict tone={r.expired ? "fail" : days < 30 ? "warn" : "pass"} title={r.expired ? `Expired (${date})` : `Expires in ${days} days (${date})`} sub={str(r.domain)} />
      <Rows
        head={["", "Value"]}
        rows={[
          ["Registrar", str(r.registrar)],
          ["Status codes", arr<string>(r.statuses).join(", ") || null],
          ["RDAP server", str(r.server)],
        ]}
      />
    </>
  );
}
