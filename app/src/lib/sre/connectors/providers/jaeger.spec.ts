/** @jest-environment node */
import { parseJaegerQuery, searchJaeger, validateJaeger } from "./jaeger";
import { makeContext, mockHttp, params } from "./provider-test-utils";

const trace = (id: string, startMs: number, error = false) => ({
  traceID: id,
  processes: { p1: { serviceName: "checkout" }, p2: { serviceName: "db" } },
  spans: [
    { spanID: "a", operationName: "POST /cart", startTime: startMs * 1000, duration: 2_000_000, processID: "p1", tags: [{ key: "http.status_code", value: 500 }, ...(error ? [{ key: "error", value: true }] : [])] },
    { spanID: "b", operationName: "query", startTime: startMs * 1000 + 1000, duration: 500_000, processID: "p2", tags: [] },
  ],
});
const IN_WINDOW = Date.parse("2026-10-27T11:30:00Z");

describe("jaeger provider", () => {
  const endpoint = "https://jaeger.example.com/";

  it("parses structured queries and rejects malformed input", () => {
    expect(parseJaegerQuery('service:checkout operation:"GET /x" error:true minDuration:500ms tag:http.method=GET')).toMatchObject({
      service: "checkout", operation: "GET /x", minDuration: "500ms", tags: { error: "true", "http.method": "GET" },
    });
    expect(parseJaegerQuery("*").listServices).toBe(true);
    expect(parseJaegerQuery("checkout").service).toBe("checkout");
    expect(() => parseJaegerQuery("error:true")).toThrow(/needs service/);
    expect(() => parseJaegerQuery("service:a minDuration:fast")).toThrow(/durations/);
    expect(() => parseJaegerQuery("trace:xyz")).toThrow(/hexadecimal/);
  });

  it("shapes the trace search request with a microsecond window and limit+1", async () => {
    const { http, calls } = mockHttp([{ json: { data: [trace("abc123", IN_WINDOW, true)] } }]);
    const result = await searchJaeger(makeContext(http, { secret: "tok" }, endpoint), params("service:checkout error:true minDuration:1s"));
    const url = new URL(calls[0].url);
    expect(url.origin + url.pathname).toBe("https://jaeger.example.com/api/traces");
    expect(url.searchParams.get("service")).toBe("checkout");
    expect(url.searchParams.get("start")).toBe(String(Date.parse("2026-10-27T11:00:00Z") * 1000));
    expect(url.searchParams.get("end")).toBe(String(Date.parse("2026-10-27T12:00:00Z") * 1000));
    expect(url.searchParams.get("limit")).toBe("11");
    expect(url.searchParams.get("minDuration")).toBe("1s");
    expect(JSON.parse(url.searchParams.get("tags") as string)).toEqual({ error: "true" });
    expect(calls[0].headers.Authorization).toBe("Bearer tok");
    expect(calls[0].target).toBe("endpoint");
    expect(result.records[0]).toMatchObject({ evidenceType: "trace", severity: "error" });
    expect(result.records[0].summary).toContain("2 span(s)");
  });

  it("truncates beyond the row budget", async () => {
    const data = Array.from({ length: 4 }, (_, i) => trace(`t${i}`, IN_WINDOW + i));
    const { http } = mockHttp([{ json: { data } }]);
    const result = await searchJaeger(makeContext(http, {}, endpoint), params("service:a", { maxRows: 3 }));
    expect(result.records).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });

  it("enforces the time window for trace-id lookups and omits auth without a secret", async () => {
    const { http, calls } = mockHttp([{ json: { data: [trace("abc", Date.parse("2026-01-01T00:00:00Z"))] } }]);
    const result = await searchJaeger(makeContext(http, {}, endpoint), params("trace:ABC"));
    expect(calls[0].url).toBe("https://jaeger.example.com/api/traces/abc");
    expect(calls[0].headers.Authorization).toBeUndefined();
    expect(result.records).toHaveLength(0);
  });

  it("lists services for *", async () => {
    const { http } = mockHttp([{ json: { data: ["a", "b"] } }]);
    const result = await searchJaeger(makeContext(http, {}, endpoint), params("*"));
    expect(result.records[0]).toMatchObject({ evidenceType: "topology" });
    expect(result.records[0].summary).toContain("a, b");
  });

  it("maps auth and server errors, and validates", async () => {
    await expect(validateJaeger(makeContext(mockHttp([{ status: 401 }]).http, {}, endpoint))).rejects.toThrow(/credentials rejected/);
    await expect(searchJaeger(makeContext(mockHttp([{ status: 502 }]).http, {}, endpoint), params("service:a"))).rejects.toThrow(/HTTP 502/);
    await expect(validateJaeger(makeContext(mockHttp([{}]).http, {}, null))).rejects.toThrow(/endpoint URL is required/);
    await expect(validateJaeger(makeContext(mockHttp([{ json: { data: [] } }]).http, {}, endpoint))).resolves.toBeUndefined();
  });
});
