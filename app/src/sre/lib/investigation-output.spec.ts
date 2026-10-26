import {
  formatInvestigationMarkdown,
  parseInvestigationOutput,
  readStoredHypotheses,
} from "./investigation-output";

const E1 = "018f0000-0000-7000-8000-000000000001";
const E2 = "018f0000-0000-7000-8000-000000000002";
const UNKNOWN = "018f0000-0000-7000-8000-0000000000ff";
const known = new Set([E1, E2]);

const base = {
  outcome: "identified",
  confidence: 0.8,
  conclusion: "Checkout latency began after deploy 42.",
  hypotheses: [
    { title: "Deploy 42 regression", state: "validated", rationale: "Latency step at deploy time", evidenceIds: [E1, UNKNOWN] },
    { title: "Database saturation", state: "ruled_out", rationale: "CPU flat", evidenceIds: [E2] },
  ],
  nextChecks: ["Compare p95 before and after deploy 42"],
};

describe("parseInvestigationOutput", () => {
  it("parses a plain JSON answer and drops unknown citations", () => {
    const result = parseInvestigationOutput(JSON.stringify(base), known);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.outcome).toBe("identified");
    expect(result.output.confidence).toBe(0.8);
    expect(result.output.hypotheses[0]).toMatchObject({ key: "h1", state: "validated", evidenceIds: [E1] });
    expect(result.output.hypotheses[1].key).toBe("h2");
    expect(result.output.topEvidenceIds).toEqual([E1]);
  });

  it("accepts a fenced JSON block surrounded by prose", () => {
    const result = parseInvestigationOutput(`Here you go:\n\`\`\`json\n${JSON.stringify(base)}\n\`\`\``, known);
    expect(result.ok).toBe(true);
  });

  it("degrades (ok=false) on prose, schema violations and out-of-range confidence", () => {
    expect(parseInvestigationOutput("The root cause is probably the database.", known).ok).toBe(false);
    expect(parseInvestigationOutput(JSON.stringify({ ...base, confidence: 4 }), known).ok).toBe(false);
    expect(parseInvestigationOutput(JSON.stringify({ ...base, conclusion: "" }), known).ok).toBe(false);
    expect(
      parseInvestigationOutput(JSON.stringify({ ...base, hypotheses: [{ title: "x", state: "maybe" }] }), known).ok,
    ).toBe(false);
  });

  it("never reports an identified cause without a validated, cited hypothesis", () => {
    const uncited = { ...base, hypotheses: [{ title: "Deploy 42", state: "validated", evidenceIds: [UNKNOWN] }] };
    const result = parseInvestigationOutput(JSON.stringify(uncited), known);
    expect(result.ok && result.output).toMatchObject({
      outcome: "inconclusive",
      confidence: 0,
      downgraded: true,
      topEvidenceIds: [],
    });
    if (result.ok) expect(result.output.hypotheses[0].state).toBe("inconclusive");
  });

  it("downgrades low-confidence claims and keeps explicit inconclusive outcomes at zero", () => {
    const low = parseInvestigationOutput(JSON.stringify({ ...base, confidence: 0.1 }), known);
    expect(low.ok && low.output.outcome).toBe("inconclusive");
    const explicit = parseInvestigationOutput(
      JSON.stringify({ ...base, outcome: "inconclusive", confidence: 0.6, hypotheses: [] }),
      known,
    );
    expect(explicit.ok && explicit.output).toMatchObject({ outcome: "inconclusive", confidence: 0, downgraded: false });
  });

  it("caps top citations at three distinct ids", () => {
    const ids = Array.from({ length: 5 }, (_, i) => `018f0000-0000-7000-8000-00000000010${i}`);
    const out = parseInvestigationOutput(
      JSON.stringify({ ...base, hypotheses: [{ title: "x", state: "validated", evidenceIds: ids }] }),
      new Set(ids),
    );
    expect(out.ok && out.output.topEvidenceIds).toHaveLength(3);
  });
});

describe("formatInvestigationMarkdown / readStoredHypotheses", () => {
  it("renders conclusion, hypotheses and next checks", () => {
    const result = parseInvestigationOutput(JSON.stringify(base), known);
    if (!result.ok) throw new Error("expected ok");
    const md = formatInvestigationMarkdown(result.output);
    expect(md).toContain("Checkout latency began");
    expect(md).toContain("Validated: Deploy 42 regression");
    expect(md).toContain("Ruled out: Database saturation");
    expect(md).toContain("Compare p95");
  });

  it("drops malformed stored entries", () => {
    expect(readStoredHypotheses(null)).toEqual([]);
    expect(readStoredHypotheses([{ key: "h1", title: "t", state: "validated" }, { nope: 1 }])).toHaveLength(1);
  });
});
