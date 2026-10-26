/** @jest-environment node */
import { createVerify, generateKeyPairSync } from "node:crypto";
import { hasBalancedParentheses, parseGcpCredential, parseGcpQuery, searchGcp, signGcpJwt, validateGcp } from "./gcp-monitoring";
import { makeContext, mockHttp, params } from "./provider-test-utils";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const keyJson = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "service_account", client_email: "sc@proj-123.iam.gserviceaccount.com", private_key: pem, private_key_id: "kid1", project_id: "proj-123", token_uri: "https://evil.example.com/token", ...overrides });
const cred = { secret: keyJson() };
const token = { json: { access_token: "ya29.token", expires_in: 3600 } };

describe("gcp provider", () => {
  it("validates the service account key shape", () => {
    expect(parseGcpCredential(cred).projectId).toBe("proj-123");
    expect(parseGcpCredential({ ...cred, projectId: "other-project" }).projectId).toBe("other-project");
    expect(() => parseGcpCredential({})).toThrow(/service account JSON key/);
    expect(() => parseGcpCredential({ secret: "not json" })).toThrow(/not valid JSON/);
    expect(() => parseGcpCredential({ secret: keyJson({ type: "external_account" }) })).toThrow(/service_account/);
    expect(() => parseGcpCredential({ secret: keyJson({ client_email: "a@evil.com" }) })).toThrow(/client_email/);
    expect(() => parseGcpCredential({ secret: keyJson({ project_id: "BAD ID" }) })).toThrow(/project ID/);
  });

  it("signs a verifiable RS256 JWT against the fixed token URL", () => {
    const jwt = signGcpJwt(parseGcpCredential(cred), 1_000);
    const [h, c, s] = jwt.split(".");
    const claims = JSON.parse(Buffer.from(c, "base64url").toString());
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toMatchObject({ alg: "RS256", kid: "kid1" });
    expect(claims).toMatchObject({ iss: "sc@proj-123.iam.gserviceaccount.com", aud: "https://oauth2.googleapis.com/token", iat: 1_000, exp: 4_600 });
    expect(claims.scope).toContain("monitoring.read");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${h}.${c}`);
    expect(verifier.verify(publicKey, Buffer.from(s, "base64url"))).toBe(true);
    expect(() => signGcpJwt({ ...parseGcpCredential(cred), privateKey: "-----BEGIN PRIVATE KEY-----\nbad\n-----END PRIVATE KEY-----" }, 1)).toThrow(/could not sign/);
  });

  it("classifies queries and guards the filter", () => {
    expect(parseGcpQuery('severity>=ERROR').kind).toBe("logs");
    expect(parseGcpQuery('metric.type="a/b"').kind).toBe("metrics");
    expect(parseGcpQuery('metrics: metric.type="a/b"').filter).toBe('metric.type="a/b"');
    expect(() => parseGcpQuery("metrics: resource.type=x")).toThrow(/metric.type/);
    expect(() => parseGcpQuery('logs: a) OR (b')).toThrow(/unbalanced/);
    expect(hasBalancedParentheses('a="(" AND (b)')).toBe(true);
    expect(hasBalancedParentheses("x='a) OR (b='")).toBe(false);
    expect(parseGcpQuery("logs: *").filter).toBe("");
  });

  it("exchanges a token at the fixed endpoint, caches it, and queries logs", async () => {
    const { http, calls } = mockHttp((req) => (req.url.includes("oauth2") ? token : { json: { entries: [{ timestamp: "2026-10-27T11:30:00Z", severity: "ERROR", textPayload: "db down", resource: { type: "cloud_run_revision", labels: { service_name: "checkout" } }, logName: "projects/p/logs/stderr" }, { timestamp: "2026-10-27T11:31:00Z", severity: "INFO", jsonPayload: { message: "ok" } }] } }));
    const ctx = makeContext(http, cred);
    const result = await searchGcp(ctx, params('logs: severity>=ERROR AND resource.labels.service_name="checkout"', { maxRows: 1 }));
    expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(calls[0].target).toBe("vendor");
    expect(new URLSearchParams(calls[0].body).get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(calls[1].url).toBe("https://logging.googleapis.com/v2/entries:list");
    expect(calls[1].headers.Authorization).toBe("Bearer ya29.token");
    const body = JSON.parse(calls[1].body as string);
    expect(body.resourceNames).toEqual(["projects/proj-123"]);
    expect(body.filter).toBe('(severity>=ERROR AND resource.labels.service_name="checkout") AND timestamp>="2026-10-27T11:00:00.000Z" AND timestamp<="2026-10-27T12:00:00.000Z"');
    expect(body.pageSize).toBe(2);
    expect(result.records).toHaveLength(1);
    expect(result.truncated).toBe(true);
    expect(result.records[0]).toMatchObject({ evidenceType: "log", severity: "error" });
    await searchGcp(ctx, params("logs: *"));
    expect(calls.filter((c) => c.url.includes("oauth2"))).toHaveLength(1);
  });

  it("queries metric time series with the window and summarises points", async () => {
    const point = (v: number, t: string) => ({ interval: { endTime: t }, value: { doubleValue: v } });
    const { http, calls } = mockHttp((req) => (req.url.includes("oauth2") ? token : { json: { timeSeries: [{ metric: { type: "run.googleapis.com/request_count", labels: { response_code_class: "5xx" } }, resource: { type: "cloud_run_revision", labels: { service_name: "checkout" } }, points: [point(9, "2026-10-27T11:59:00Z"), point(1, "2026-10-27T11:58:00Z")] }] } }));
    const result = await searchGcp(makeContext(http, cred), params('metrics: metric.type="run.googleapis.com/request_count"'));
    const url = new URL(calls[1].url);
    expect(url.pathname).toBe("/v3/projects/proj-123/timeSeries");
    expect(url.searchParams.get("filter")).toBe('metric.type="run.googleapis.com/request_count"');
    expect(url.searchParams.get("interval.startTime")).toBe("2026-10-27T11:00:00.000Z");
    expect(url.searchParams.get("interval.endTime")).toBe("2026-10-27T12:00:00.000Z");
    expect(result.records[0]).toMatchObject({ evidenceType: "metric" });
    expect(JSON.parse(result.records[0].rawContent as string).stats).toMatchObject({ latest: 9, min: 1, max: 9, points: 2 });
  });

  it("maps token and API failures", async () => {
    await expect(searchGcp(makeContext(mockHttp([{ status: 400, json: { error: "invalid_grant", error_description: "Invalid JWT Signature." } }]).http, cred), params("logs: *"))).rejects.toThrow(/invalid credentials.*Invalid JWT Signature/);
    const forbidden = mockHttp((req) => (req.url.includes("oauth2") ? token : { status: 403 }));
    await expect(searchGcp(makeContext(forbidden.http, cred), params("logs: *"))).rejects.toThrow(/credentials rejected with HTTP 403/);
  });

  it("validates with monitoring and falls back to logging", async () => {
    const both = mockHttp((req) => (req.url.includes("oauth2") ? token : req.url.includes("metricDescriptors") ? { status: 403 } : { json: {} }));
    await expect(validateGcp(makeContext(both.http, cred))).resolves.toBeUndefined();
    const none = mockHttp((req) => (req.url.includes("oauth2") ? token : { status: 403 }));
    await expect(validateGcp(makeContext(none.http, cred))).rejects.toThrow(/credentials rejected/);
  });
});
