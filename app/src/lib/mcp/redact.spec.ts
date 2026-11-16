/** @jest-environment node */
import { safeJson, safeTarget, safeText } from "./redact";

describe("safeTarget", () => {
  it("keeps only scheme and host of http(s) URLs", () => {
    expect(safeTarget("https://u:pw@example.com/hooks/SECRET?token=abc")).toBe("https://example.com");
  });
  it("does not leak credentials from scheme-less targets", () => {
    expect(safeTarget("user:pw@host.example:80")).toBe("host.example:80");
  });
});

describe("safeText", () => {
  it("redacts URL credentials, basic auth, cookies and stripe keys", () => {
    const out = safeText("postgres://a:b@db/x Authorization: Basic abc123 Cookie: s=1 sk_live_abcdefgh12345")!;
    expect(out).not.toMatch(/a:b@|abc123|s=1|sk_live_/);
  });
  it("redacts Supercheck's own CLI, recorder, trigger and job keys", () => {
    const out = safeText("token sck_live_abcdef1234567890 and sck_test_abcdef1234567890 and sck_trigger_abcdef1234567890 and job_0123456789abcdef01234567")!;
    expect(out).not.toMatch(/sck_(live|test|trigger)_abc|job_0123/);
    expect(out.match(/\[REDACTED_KEY\]/g)).toHaveLength(4);
  });
  it("redacts Discord, Teams and Telegram webhook secrets", () => {
    const out = safeText("https://discord.com/api/webhooks/123/AbC-secret https://acme.webhook.office.com/webhookb2/abc/IncomingWebhook/def https://api.telegram.org/bot123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw/sendMessage")!;
    expect(out).not.toMatch(/AbC-secret|IncomingWebhook\/def|AAHdqTcv/);
    expect(safeText("https://discord.com/api/v10/webhooks/123/V10-secret")).not.toContain("V10-secret");
    expect(safeText("https://hooks.slack.com/triggers/T1/2/SLACK-secret https://outlook.office.com/webhook/OUTLOOK-secret")).not.toMatch(/SLACK-secret|OUTLOOK-secret/);
  });
  it("keeps the closing quote of an Authorization header inside JSON", () => {
    const out = safeJson({ headers: "Authorization: Bearer abc123" });
    expect(out).not.toContain("abc123");
    expect(() => JSON.parse(out)).not.toThrow();
    expect(safeText('Authorization: Bearer "abc123"')).not.toContain("abc123");
    expect(safeText("Authorization: Basic 'dXNlcjpwdw=='")).not.toContain("dXNlcjpwdw");
    // Event data reaches the redactor as JSON text, so a quoted value arrives with escaped quotes.
    const escaped = safeJson({ note: 'Authorization: Bearer "abc123"' });
    expect(escaped).not.toContain("abc123");
    expect(() => JSON.parse(escaped)).not.toThrow();
    const digest = 'Authorization: Digest username="alice", realm="r", response="deadbeef", nc=00000001';
    expect(safeText(digest)).not.toMatch(/alice|deadbeef|00000001/);
    const digestJson = safeJson({ note: digest });
    expect(digestJson).not.toMatch(/alice|deadbeef/);
    expect(() => JSON.parse(digestJson)).not.toThrow();
    const escapedQuote = 'Authorization: Digest username="ali\\"ce", response="0123456789abcdef0123456789abcdef"';
    expect(safeText(escapedQuote)).not.toContain("0123456789abcdef");
    const escapedJson = safeJson({ note: escapedQuote });
    expect(escapedJson).not.toContain("0123456789abcdef");
    expect(JSON.parse(escapedJson)).toEqual({ note: "Authorization: Digest [REDACTED]" });
  });
  it("stays fast on long whitespace after an auth scheme", () => {
    const started = Date.now();
    for (const scheme of ["Digest", "Bearer", "Basic"]) safeText(`Authorization: ${scheme} ${" ".repeat(3500)}!`);
    expect(Date.now() - started).toBeLessThan(200);
  });
  it("truncates long text", () => {
    expect(safeText("x".repeat(5000))!.endsWith("[truncated]")).toBe(true);
  });
});

describe("heartbeat ping URLs (B26)", () => {
  it("strips the token from a ping URL and from bare tokens in text", () => {
    const token = `hb_${"7f".repeat(16)}`;
    const out = safeText(`curl -fsS https://app.example/api/heartbeat/${token}/fail and ${token}`)!;
    expect(out).not.toContain(token);
    expect(out).toContain("https://app.example/api/heartbeat/[REDACTED]");
  });
});
