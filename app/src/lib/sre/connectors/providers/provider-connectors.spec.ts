/** @jest-environment node */
import { EventEmitter } from "node:events";

jest.mock("node:dns/promises", () => ({ lookup: jest.fn() }));
jest.mock("node:https", () => ({ __esModule: true, default: { request: jest.fn() } }));

import { lookup } from "node:dns/promises";
import https from "node:https";
import { createDirectConnector } from "../direct-connectors";
import { sanitizeConnectorEvidence } from "../output-sanitizer";
import { ObservabilityProviderConnector, providerHttp } from "./provider-connectors";
import type { ProviderHttp } from "./provider-core";

const mockLookup = lookup as unknown as jest.Mock;
const mockRequest = https.request as unknown as jest.Mock;

const definition = {
  id: "c1",
  riskLevel: "low" as const,
  permissionLevel: "read" as const,
  sideEffectLevel: "none" as const,
  surfaces: [],
  evidenceTypes: [],
  requires: [],
  status: "configured" as const,
  scopedServiceIds: [],
  defaultTimeWindowMinutes: 60,
  outputLimits: { maxRows: 100, maxBytes: 1_048_576, maxSeconds: 10 },
};
const searchParams = () => ({
  query: "service:checkout",
  serviceId: "s1",
  timeWindow: { start: new Date("2026-10-27T11:00:00Z"), end: new Date("2026-10-27T12:00:00Z") },
  budget: { maxRows: 10, maxBytes: 100_000, maxSeconds: 5, maxCost: 0 },
});

function stubHttps(status: number, body: string) {
  mockRequest.mockImplementation((_url: URL, _opts: unknown, onResponse: (r: EventEmitter) => void) => {
    const request = Object.assign(new EventEmitter(), { end: jest.fn(), write: jest.fn(), destroy: jest.fn() });
    const response = Object.assign(new EventEmitter(), { statusCode: status, headers: {} });
    onResponse(response);
    queueMicrotask(() => { response.emit("data", Buffer.from(body)); response.emit("end"); });
    return request;
  });
}

describe("observability provider connectors", () => {
  const original = process.env.SELF_HOSTED;
  beforeEach(() => { jest.clearAllMocks(); delete process.env.SELF_HOSTED; });
  afterAll(() => { if (original === undefined) delete process.env.SELF_HOSTED; else process.env.SELF_HOSTED = original; });

  it("the factory builds all five providers as read-only connectors", () => {
    for (const type of ["jaeger", "newrelic", "splunk", "gcp_monitoring", "azure_monitor"] as const) {
      const connector = createDirectConnector({ ...definition, type, endpointUrl: "https://x.example.com" });
      expect(connector).toBeInstanceOf(ObservabilityProviderConnector);
      expect(connector.permissionLevel).toBe("read");
      expect(connector.sideEffectLevel).toBe("none");
      expect(connector.metadata().type).toBe(type);
    }
  });

  it("returns sanitized evidence items for a search and redacts secrets in output", async () => {
    const http: ProviderHttp = async () => ({
      status: 200,
      truncated: false,
      text: JSON.stringify({ data: [{ traceID: "abc", processes: { p: { serviceName: "checkout" } }, spans: [{ operationName: "GET /?token=supersecretvalue", startTime: Date.parse("2026-10-27T11:30:00Z") * 1000, duration: 1000, processID: "p", tags: [] }] }] }),
    });
    const connector = new ObservabilityProviderConnector({ ...definition, type: "jaeger", endpointUrl: "https://jaeger.example.com" }, http);
    const items = await connector.search(searchParams());
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ source: "jaeger", evidenceType: "trace", citation: { connectorId: "c1", query: "service:checkout" } });
    const sanitized = sanitizeConnectorEvidence(items, { maxRows: 5, maxBytes: 100_000 });
    expect(JSON.stringify(sanitized.items)).not.toContain("supersecretvalue");
  });

  it("maps validate() results to connector statuses without leaking the secret", async () => {
    const reject: ProviderHttp = async () => ({ status: 401, text: "", truncated: false });
    const invalid = await new ObservabilityProviderConnector({ ...definition, type: "jaeger", endpointUrl: "https://j.example.com", credential: { secret: "s" } }, reject).validate();
    expect(invalid.status).toBe("invalid_credentials");
    const down: ProviderHttp = async () => { throw new Error("connect ECONNREFUSED"); };
    expect((await new ObservabilityProviderConnector({ ...definition, type: "jaeger", endpointUrl: "https://j.example.com" }, down).validate()).status).toBe("unreachable");
    const ok: ProviderHttp = async () => ({ status: 200, text: "{}", truncated: false });
    expect((await new ObservabilityProviderConnector({ ...definition, type: "jaeger", endpointUrl: "https://j.example.com" }, ok).validate()).status).toBe("valid");
  });

  it("merges stored credential fields with the secret", async () => {
    let seen: Record<string, string> = {};
    const http: ProviderHttp = async (request) => { seen = request.headers; return { status: 200, text: JSON.stringify({ data: [] }), truncated: false }; };
    await new ObservabilityProviderConnector({ ...definition, type: "jaeger", endpointUrl: "https://j.example.com", credential: { secret: "tok" } }, http).search(searchParams());
    expect(seen.Authorization).toBe("Bearer tok");
  });

  describe("transport policy", () => {
    const req = (url: string, target: "endpoint" | "vendor") => ({ url, method: "GET" as const, headers: {}, timeoutMs: 1000, maxBytes: 1000, target });

    it("rejects vendor-target requests to any host that is not allowlisted, before DNS", async () => {
      await expect(providerHttp(req("https://evil.example.com/token", "vendor"))).rejects.toThrow(/not allowed/);
      await expect(providerHttp(req("http://api.newrelic.com/graphql", "vendor"))).rejects.toThrow(/not allowed/);
      expect(mockLookup).not.toHaveBeenCalled();
    });

    it("rejects private and reserved customer endpoints in direct (cloud) mode", async () => {
      await expect(providerHttp(req("https://10.0.0.5/api/services", "endpoint"))).rejects.toThrow(/private or reserved/);
      await expect(providerHttp(req("https://169.254.169.254/latest", "endpoint"))).rejects.toThrow(/private or reserved/);
      mockLookup.mockResolvedValueOnce([{ address: "192.168.1.9", family: 4 }]);
      await expect(providerHttp(req("https://jaeger.internal.example.com/api/services", "endpoint"))).rejects.toThrow(/private or reserved/);
      await expect(providerHttp(req("http://jaeger.example.com/api/services", "endpoint"))).rejects.toThrow(/HTTPS/);
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it("pins vendor requests to the validated public address and enforces the byte budget", async () => {
      mockLookup.mockResolvedValue([{ address: "203.0.114.10", family: 4 }]);
      stubHttps(200, "x".repeat(5000));
      const response = await providerHttp(req("https://api.newrelic.com/graphql", "vendor"));
      expect(response.status).toBe(200);
      expect(response.text).toHaveLength(1000);
      expect(response.truncated).toBe(true);
      const options = mockRequest.mock.calls[0][1] as { lookup: (...args: unknown[]) => void };
      const cb = jest.fn();
      options.lookup("api.newrelic.com", {}, cb);
      expect(cb).toHaveBeenCalledWith(null, "203.0.114.10", 4);
    });

    it("vendor requests ignore SELF_HOSTED and still refuse private resolutions", async () => {
      process.env.SELF_HOSTED = "true";
      mockLookup.mockResolvedValueOnce([{ address: "10.1.1.1", family: 4 }]);
      await expect(providerHttp(req("https://api.newrelic.com/graphql", "vendor"))).rejects.toThrow(/private or reserved/);
    });
  });
});
