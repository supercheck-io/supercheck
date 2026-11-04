import {
  SRE_CHART_LIMITS,
  SRE_CHART_PROMPT_LINES,
  SRE_CHART_SAMPLE_JSON,
  SRE_CHART_TYPES,
} from "./chart-contract";

describe("SRE chart contract", () => {
  it("ships a sample that parses and sits within its own limits", () => {
    const sample = JSON.parse(SRE_CHART_SAMPLE_JSON);
    expect(SRE_CHART_TYPES).toContain(sample.type);
    expect(sample.series.length).toBeLessThanOrEqual(SRE_CHART_LIMITS.maxSeries);
    expect(sample.data.length).toBeLessThanOrEqual(SRE_CHART_LIMITS.maxRows);
    expect(sample.sources.length).toBeLessThanOrEqual(SRE_CHART_LIMITS.maxSources);
    expect(sample.data[0]).toHaveProperty(sample.series[0].key);
    expect(sample.data[0]).toHaveProperty(sample.xKey);
  });

  it("states the limits in the prompt text", () => {
    const text = SRE_CHART_PROMPT_LINES.join("\n");
    expect(text).toContain("bar, line, and area");
    expect(text).toContain(`at most ${SRE_CHART_LIMITS.maxSeries} series and ${SRE_CHART_LIMITS.maxRows} data rows`);
  });
});
