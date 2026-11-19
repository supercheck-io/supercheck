import { fireEvent, render, screen } from "@testing-library/react";

import { FoldedResults, groupEvidence } from "./investigation-report";

const item = (id: string, sourceType: string, title: string, evidenceType = "log") => ({
  id,
  sourceType,
  title,
  summary: null,
  sourceUri: "",
  evidenceType,
  severity: null,
  confidence: null,
  rawContentExcerpt: null,
  citationQuery: null,
  observedAt: null,
  createdAt: new Date(0),
});

describe("groupEvidence", () => {
  it("groups by source with catalog labels and folds repeated titles, newest first", () => {
    const groups = groupEvidence([
      item("a", "loki", "Pool exhausted"),
      item("b", "jaeger", "POST /v1/bookings", "trace"),
      item("c", "loki", "pool exhausted "),
      item("d", "native", "Monitor failed", "event"),
      item("e", "jaeger", "POST /v1/bookings", "trace"),
    ]);
    expect(groups.map((group) => group.label)).toEqual(["Loki", "Jaeger", "Supercheck"]);
    expect(groups[0]!.rows.map((row) => row.map((entry) => entry.id))).toEqual([["a", "c"]]);
    expect(groups[1]!.rows.map((row) => row.map((entry) => entry.id))).toEqual([["b", "e"]]);
  });
});

describe("FoldedResults", () => {
  it("lets each folded result open on its own", () => {
    render(<FoldedResults items={[item("a", "loki", "Pool exhausted"), item("b", "loki", "Pool exhausted")]} />);
    fireEvent.click(screen.getByRole("button", { name: "Show all 2 results" }));
    expect(screen.getAllByRole("button", { name: /^View evidence: Pool exhausted/ })).toHaveLength(2);
  });
});
