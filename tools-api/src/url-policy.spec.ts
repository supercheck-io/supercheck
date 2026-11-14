import { describe, expect, it } from "vitest";
import { checkDomain, checkUrl, hostReason, registrable } from "./url-policy";

const reason = (input: string, blocked: string[] = []) => {
  const r = checkUrl(input, blocked);
  return r.ok ? null : r.reason;
};

describe("checkUrl (SSRF suite)", () => {
  it("accepts public http and https URLs and adds a missing scheme", () => {
    expect(checkUrl("example.com/path?q=1#frag", [])).toMatchObject({ ok: true });
    const r = checkUrl("example.com/path?q=1#frag", []);
    expect(r.ok && r.value.toString()).toBe("https://example.com/path?q=1");
    expect(reason("http://example.com")).toBeNull();
  });

  it.each(["ftp://example.com", "file:///etc/passwd", "javascript:alert(1)", "data:text/html,x", "gopher://example.com"])(
    "rejects scheme %s",
    (input) => expect(reason(input)).toBe("scheme"),
  );

  it("rejects userinfo", () => {
    expect(reason("https://user:pass@example.com")).toBe("userinfo");
    expect(reason("https://user@example.com")).toBe("userinfo");
  });

  it("allows only ports 80 and 443", () => {
    expect(reason("http://example.com:80/")).toBeNull();
    expect(reason("https://example.com:443/")).toBeNull();
    expect(reason("https://example.com:8080/")).toBe("port");
    expect(reason("http://example.com:443/")).toBe("port");
    expect(reason("https://example.com:22")).toBe("port");
  });

  it.each([
    "http://127.0.0.1/",
    "http://2130706433/",
    "http://0x7f000001/",
    "http://0177.0.0.1/",
    "http://127.1/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[fd00::1]/",
    "http://169.254.169.254/latest/meta-data",
    "http://8.8.8.8/",
  ])("rejects IP literal %s", (input) => expect(reason(input)).toBe("ip_literal"));

  it("rejects single-label hosts", () => {
    expect(reason("http://intranet/")).toBe("single_label");
  });

  it.each([
    "localhost",
    "a.localhost",
    "printer.local",
    "svc.internal",
    "x.home.arpa",
    "abc.onion",
    "foo.test",
    "www.example",
    "x.invalid",
    "1.0.0.127.in-addr.arpa",
  ])("rejects special-use name %s", (host) => {
    expect(["reserved_name", "single_label"]).toContain(reason(`https://${host}/`));
  });

  it.each(["x.workers.dev", "workers.dev", "y.pages.dev", "app.supercheck.io", "demo.supercheck.io", "a.app.supercheck.io"])(
    "rejects our own and Cloudflare platform host %s",
    (host) => expect(reason(`https://${host}/`)).toBe("reserved_name"),
  );

  it("keeps the marketing site checkable", () => {
    expect(reason("https://supercheck.io/")).toBeNull();
  });

  it("normalises punycode, case and a trailing dot", () => {
    const r = checkUrl("https://BÜCHER.Example.COM./", []);
    expect(r.ok && r.value.hostname).toBe("xn--bcher-kva.example.com");
    expect(reason("https://LOCALHOST./")).toBe("single_label");
    expect(reason("https://app.supercheck.io./")).toBe("reserved_name");
  });

  it("matches BLOCKED_HOSTS by suffix on a label boundary", () => {
    expect(reason("https://www.optout.com/", ["optout.com"])).toBe("blocked_host");
    expect(reason("https://optout.com/", ["optout.com"])).toBe("blocked_host");
    expect(reason("https://notoptout.com/", ["optout.com"])).toBeNull();
    expect(reason("https://a.optout.com/", [".optout.com"])).toBe("blocked_host");
  });

  it("rejects garbage", () => {
    expect(reason("https://")).toBe("invalid_url");
    expect(reason("http://exa mple.com")).toBe("invalid_url");
  });
});

describe("checkDomain", () => {
  it("accepts a bare domain or reduces a URL to its host", () => {
    expect(checkDomain("Example.com.", [])).toEqual({ ok: true, value: "example.com" });
    expect(checkDomain("https://www.example.com/path", [])).toEqual({ ok: true, value: "www.example.com" });
  });
  it("applies the host rules", () => {
    expect(checkDomain("localhost", [])).toEqual({ ok: false, reason: "single_label" });
    expect(checkDomain("a.localhost", [])).toEqual({ ok: false, reason: "reserved_name" });
    expect(checkDomain("10.0.0.1", [])).toEqual({ ok: false, reason: "ip_literal" });
    expect(checkDomain("opt.out.com", ["out.com"])).toEqual({ ok: false, reason: "blocked_host" });
    expect(checkDomain("user@example.com", [])).toEqual({ ok: false, reason: "userinfo" });
    expect(checkDomain("exa mple.com", [])).toEqual({ ok: false, reason: "invalid_domain" });
  });
});

describe("helpers", () => {
  it("hostReason flags bracketed and colon hosts", () => {
    expect(hostReason("[::1]", [])).toBe("ip_literal");
  });
  it("registrable uses the public suffix list", () => {
    expect(registrable("a.b.example.co.uk")).toBe("example.co.uk");
    expect(registrable("a1.victim.com")).toBe("victim.com");
  });
});
