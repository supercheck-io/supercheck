/** @jest-environment node */
import { assertReadOnlyKql, parseAzureCredential, parseAzureQuery, searchAzure, validateAzure } from "./azure-monitor";
import { makeContext, mockHttp, params } from "./provider-test-utils";

const TENANT = "11111111-1111-1111-1111-111111111111";
const CLIENT = "22222222-2222-2222-2222-222222222222";
const WORKSPACE = "33333333-3333-3333-3333-333333333333";
const cred = { tenantId: TENANT, clientId: CLIENT, secret: "s3cret", workspaceId: WORKSPACE };
const token = { json: { access_token: "az-token", expires_in: 3599 } };
const RESOURCE = "/subscriptions/44444444-4444-4444-4444-444444444444/resourceGroups/rg1/providers/Microsoft.Web/sites/checkout";

describe("azure monitor provider", () => {
  it("validates credential fields", () => {
    expect(parseAzureCredential(cred).workspaceId).toBe(WORKSPACE);
    expect(() => parseAzureCredential({ tenantId: TENANT })).toThrow(/tenant ID, client ID and client secret/);
    expect(() => parseAzureCredential({ ...cred, tenantId: "evil.com/../x" })).toThrow(/tenant ID is not valid/);
    expect(() => parseAzureCredential({ ...cred, clientId: "nope" })).toThrow(/GUID/);
    expect(() => parseAzureCredential({ ...cred, workspaceId: "nope" })).toThrow(/workspace ID/);
  });

  it.each([".drop table T", ".set T <| X", "T | take 1\n.delete table T", "T | take 1; .alter table T", "externaldata(x:string)[h@'https://x']", "T | evaluate http_request('https://x')", 'workspace("other").AppExceptions', 'union app("x").requests', 'cluster("c").database("d").T'])("rejects control command or external read %s", (kql) => {
    expect(() => assertReadOnlyKql(kql)).toThrow();
  });

  it("allows normal KQL with dots inside expressions", () => {
    expect(() => assertReadOnlyKql('AppTraces | where Properties.http.status == 500 | take 5')).not.toThrow();
  });

  it("parses metric queries strictly", () => {
    expect(parseAzureQuery(`metrics: resource=${RESOURCE} names="Http5xx,Requests" agg=Total interval=PT5M`)).toMatchObject({ kind: "metrics", names: ["Http5xx", "Requests"], aggregations: ["Total"], interval: "PT5M" });
    expect(() => parseAzureQuery("metrics: resource=/etc/passwd names=x")).toThrow(/resource=/);
    expect(() => parseAzureQuery(`metrics: resource=${RESOURCE}`)).toThrow(/names=/);
    expect(() => parseAzureQuery(`metrics: resource=${RESOURCE} names=x agg=Evil`)).toThrow(/aggregation/);
    expect(() => parseAzureQuery(`metrics: resource=${RESOURCE} names=x interval=1s`)).toThrow(/interval/);
    expect(parseAzureQuery("logs: AppExceptions | take 1")).toEqual({ kind: "logs", kql: "AppExceptions | take 1" });
  });

  it("runs KQL with client-credentials auth, timespan and take", async () => {
    const { http, calls } = mockHttp((req) => (req.url.includes("login.microsoftonline.com") ? token : { json: { tables: [{ columns: [{ name: "TimeGenerated" }, { name: "Message" }, { name: "SeverityLevel" }], rows: [["2026-10-27T11:10:00Z", "Unhandled exception in checkout", 3], ["2026-10-27T11:11:00Z", "second", 1], ["2026-10-27T11:12:00Z", "third", 1]] }] } }));
    const result = await searchAzure(makeContext(http, cred), params("AppTraces | where SeverityLevel > 1;", { maxRows: 2 }));
    expect(calls[0].url).toBe(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`);
    expect(calls[0].target).toBe("vendor");
    const form = new URLSearchParams(calls[0].body);
    expect(form.get("grant_type")).toBe("client_credentials");
    expect(form.get("scope")).toBe("https://api.loganalytics.azure.com/.default");
    expect(calls[1].url).toBe(`https://api.loganalytics.azure.com/v1/workspaces/${WORKSPACE}/query`);
    expect(calls[1].headers.Authorization).toBe("Bearer az-token");
    const body = JSON.parse(calls[1].body as string);
    expect(body.query).toBe("AppTraces | where SeverityLevel > 1\n| take 3");
    expect(body.timespan).toBe("2026-10-27T11:00:00.000Z/2026-10-27T12:00:00.000Z");
    expect(result.records).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(result.records[0]).toMatchObject({ evidenceType: "log", observedAt: "2026-10-27T11:10:00.000Z" });
  });

  it("requires a workspace for KQL", async () => {
    const { workspaceId: _omit, ...noWorkspace } = cred;
    void _omit;
    await expect(searchAzure(makeContext(mockHttp([token]).http, noWorkspace), params("T | take 1"))).rejects.toThrow(/workspace ID/);
  });

  it("reads metrics from the ARM API", async () => {
    const { http, calls } = mockHttp((req) => (req.url.includes("login.") ? token : { json: { value: [{ name: { value: "Http5xx" }, unit: "Count", timeseries: [{ metadatavalues: [], data: [{ timeStamp: "2026-10-27T11:00:00Z", total: 1 }, { timeStamp: "2026-10-27T11:05:00Z", total: 7 }] }] }] } }));
    const result = await searchAzure(makeContext(http, cred), params(`metrics: resource=${RESOURCE} names=Http5xx agg=Total`));
    expect(form(calls[0]).get("scope")).toBe("https://management.azure.com/.default");
    const url = new URL(calls[1].url);
    expect(url.origin + url.pathname).toBe(`https://management.azure.com${RESOURCE}/providers/microsoft.insights/metrics`);
    expect(url.searchParams.get("api-version")).toBe("2018-01-01");
    expect(url.searchParams.get("timespan")).toBe("2026-10-27T11:00:00.000Z/2026-10-27T12:00:00.000Z");
    expect(url.searchParams.get("interval")).toBe("PT1M");
    expect(JSON.parse(result.records[0].rawContent as string).stats.Total).toMatchObject({ latest: 7, max: 7, min: 1 });
  });

  it("maps sign-in and API failures", async () => {
    await expect(searchAzure(makeContext(mockHttp([{ status: 401, json: { error: "invalid_client", error_description: "AADSTS7000215: Invalid client secret" } }]).http, cred), params("T | take 1"))).rejects.toThrow(/invalid credentials.*AADSTS7000215/);
    const denied = mockHttp((req) => (req.url.includes("login.") ? token : { status: 403 }));
    await expect(searchAzure(makeContext(denied.http, cred), params("T | take 1"))).rejects.toThrow(/credentials rejected with HTTP 403/);
    await expect(searchAzure(makeContext(mockHttp([token]).http, cred), params(".show tables"))).rejects.toThrow(/control commands/);
  });

  it("validates sign-in and the workspace", async () => {
    const { http, calls } = mockHttp((req) => (req.url.includes("login.") ? token : { json: { tables: [] } }));
    await validateAzure(makeContext(http, cred));
    expect(calls.some((c) => c.url.includes("/query"))).toBe(true);
    const arm = mockHttp([token]);
    await validateAzure(makeContext(arm.http, { ...cred, workspaceId: undefined }));
    expect(arm.calls).toHaveLength(1);
  });
});

function form(call: { body?: string }) {
  return new URLSearchParams(call.body);
}
