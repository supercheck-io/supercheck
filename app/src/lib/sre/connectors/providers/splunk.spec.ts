/** @jest-environment node */
import { assertReadOnlySpl, prepareSpl, searchSplunk, splStatisticsError, validateSplunk } from "./splunk";
import { makeContext, mockHttp, params } from "./provider-test-utils";

const endpoint = "https://splunk.example.com:8089";
const ndjson = (...rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

describe("splunk provider", () => {
  it.each([
    "index=main error | delete",
    "index=main | outputlookup bad.csv",
    "index=main | collect index=summary",
    "index=main | sendemail to=a@b.c",
    "index=main |OUTPUTLOOKUP x",
    "index=main | rest /services/server/info",
    "index=main [ | delete ]",
    "index=main | map search=\"search x\"",
    "index=main `macro`",
    "index=main | loadjob 1234.5",
    "| inputcsv secrets.csv",
    "index=a | fit LinearRegression x into m",
    "| from savedsearch:mysearch",
  ])("rejects write or unsafe search %s", (spl) => {
    expect(() => assertReadOnlySpl(spl)).toThrow();
  });

  it("allows ordinary read commands and does not trip on words in strings", () => {
    expect(() => assertReadOnlySpl('index=main "please delete me" | stats count by host | sort - count')).not.toThrow();
  });

  it("strips user time modifiers and prefixes search", () => {
    expect(prepareSpl("index=main earliest=-30d latest=now error")).toBe("search index=main error");
    expect(prepareSpl("| tstats count where index=main")).toBe("| tstats count where index=main");
    expect(splStatisticsError("index=a error")).toMatch(/aggregate/);
    expect(splStatisticsError("index=a | stats count")).toBeNull();
  });

  it("posts a bounded export with token auth", async () => {
    const { http, calls } = mockHttp([{ text: ndjson({ preview: false, result: { _raw: "ERROR db timeout", _time: "2026-10-27T11:20:00.000+00:00", index: "main", sourcetype: "app", host: "h1" } }) }]);
    const result = await searchSplunk(makeContext(http, { secret: "tok" }, endpoint), params("index=main error"));
    expect(calls[0].url).toBe(`${endpoint}/services/search/jobs/export`);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers.Authorization).toBe("Bearer tok");
    const body = new URLSearchParams(calls[0].body);
    expect(body.get("search")).toBe("search index=main error");
    expect(body.get("earliest_time")).toBe(String(Date.parse("2026-10-27T11:00:00Z") / 1000));
    expect(body.get("latest_time")).toBe(String(Date.parse("2026-10-27T12:00:00Z") / 1000));
    expect(body.get("output_mode")).toBe("json");
    expect(body.get("count")).toBe("11");
    expect(body.get("max_time")).toBe("9");
    expect(calls[0].target).toBe("endpoint");
    expect(result.records[0]).toMatchObject({ evidenceType: "log", severity: "error" });
    expect(result.records[0].tags).toEqual(expect.arrayContaining(["index:main", "host:h1"]));
  });

  it("skips previews, tolerates partial lines, and flags truncation", async () => {
    const text = ndjson({ preview: true, result: { _raw: "preview" } }, { result: { _raw: "a" } }, { result: { _raw: "b" } }) + '{"result":{"_raw":"cut';
    const { http } = mockHttp([{ text, truncated: true }]);
    const result = await searchSplunk(makeContext(http, { secret: "t" }, endpoint), params("index=x"));
    expect(result.records.map((r) => r.rawContent)).toEqual(["a", "b"]);
    expect(result.truncated).toBe(true);
  });

  it("applies the row budget", async () => {
    const { http } = mockHttp([{ text: ndjson(...Array.from({ length: 5 }, (_, i) => ({ result: { count: String(i) } }))) }]);
    const result = await searchSplunk(makeContext(http, { secret: "t" }, endpoint), params("index=x | stats count", { maxRows: 2 }));
    expect(result.records).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(result.records[0].evidenceType).toBe("metric");
  });

  it("maps fatal messages, auth failures and missing tokens", async () => {
    const fatal = { text: ndjson({ messages: [{ type: "FATAL", text: "Unknown search command 'foo'" }] }) };
    await expect(searchSplunk(makeContext(mockHttp([fatal]).http, { secret: "t" }, endpoint), params("index=x | foo"))).rejects.toThrow(/Unknown search command/);
    await expect(searchSplunk(makeContext(mockHttp([{ status: 401 }]).http, { secret: "t" }, endpoint), params("index=x"))).rejects.toThrow(/credentials rejected/);
    await expect(searchSplunk(makeContext(mockHttp([{}]).http, {}, endpoint), params("index=x"))).rejects.toThrow(/authentication token/);
    await expect(searchSplunk(makeContext(mockHttp([{}]).http, { secret: "t" }, endpoint), params("index=x | delete"))).rejects.toThrow(/not allowed/);
  });

  it("validates through current-context", async () => {
    const { http, calls } = mockHttp([{ json: { entry: [] } }]);
    await validateSplunk(makeContext(http, { secret: "t" }, endpoint));
    expect(calls[0].url).toContain("/services/authentication/current-context?output_mode=json");
    await expect(validateSplunk(makeContext(http, {}, endpoint))).rejects.toThrow(/token/);
  });
});
