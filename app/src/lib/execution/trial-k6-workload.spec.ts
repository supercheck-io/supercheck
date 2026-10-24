/** @jest-environment node */
import { createTrialK6Script, parseTrialK6Workload, normalizeTargetHostname } from "./trial-k6-workload";
const workload = { url: "https://target.example.com/check", vus: 2, durationSeconds: 30 };
it("accepts only the generated bounded HTTP workload", () => {
  const script = createTrialK6Script(workload);
  expect(parseTrialK6Workload(script)).toEqual(workload);
  expect(script).toContain('"maxRedirects":0');
  expect(script).toContain('"insecureSkipTLSVerify":false');
  expect(script).toContain('"redirects":0');
});
it.each([
  "import http from 'k6/http'; http.get('https://other.example');",
  createTrialK6Script(workload) + "\nhttp.get('https://other.example');",
  createTrialK6Script(workload).replace("http.get", "http.post"),
])("rejects arbitrary or modified source", script => {
  expect(() => parseTrialK6Workload(script)).toThrow("generated HTTP workload");
});
it.each([
  { ...workload, url: "https://target.example.com/" + "x".repeat(3000) }, { ...workload, vus: 6 }, { ...workload, vus: 0 }, { ...workload, vus: 1.5 },
  { ...workload, durationSeconds: 301 }, { ...workload, durationSeconds: 0 },
  { ...workload, url: "http://target.example.com" },
  { ...workload, url: "https://127.0.0.1" },
  { ...workload, url: "https://user:password@target.example.com" },
  { ...workload, url: "https://target.example.com:8443" },
  { ...workload, headers: { Host: "foreign.example" } },
])("rejects unbounded or unsafe workload %j", input => {
  expect(() => createTrialK6Script(input)).toThrow();
});
it("pins only the public target host in the runtime script", () => {
  expect(createTrialK6Script(workload, { "target.example.com": "93.184.216.34" })).toContain('"hosts":{"target.example.com":"93.184.216.34"}');
});

it("canonicalizes exact hostnames", () => {
  expect(normalizeTargetHostname("TARGET.Example.com.")).toBe("target.example.com");
});
it.each(["https://example.com", "example.com/path", " example.com", "*.example.com", "127.0.0.1", "[::1]", "localhost", "x.internal", "x.localhost", "x.local", "x.lan", "x.home", "bad..example.com", "example.com:443", "127.1", "0x7f.1", "a.b.0x7f", "target.123"])("rejects invalid target hostname %s", hostname => {
  expect(() => normalizeTargetHostname(hostname)).toThrow();
});
