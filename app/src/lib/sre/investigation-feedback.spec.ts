/** @jest-environment node */
import { PgDialect } from "drizzle-orm/pg-core";

const ORG = "018f0000-0000-7000-8000-00000000000a";
const PROJECT = "018f0000-0000-7000-8000-00000000000b";
const USER = "018f0000-0000-7000-8000-00000000000c";
const RUN = "018f0000-0000-7000-8000-0000000000d1";
const INCIDENT = "018f0000-0000-7000-8000-0000000000c1";

let selectResult: unknown[] = [];
const wheres: unknown[] = [];
const inserted: unknown[] = [];
const chain: Record<string, unknown> = {};
for (const name of ["from", "innerJoin", "orderBy"]) chain[name] = () => chain;
chain.where = (clause: unknown) => {
  wheres.push(clause);
  return chain;
};
chain.limit = () => Promise.resolve(selectResult);
jest.mock("@/utils/db", () => ({
  db: {
    select: () => chain,
    insert: () => ({ values: (v: unknown) => { inserted.push(v); return Promise.resolve(); } }),
  },
}));

import { normalizeFeedbackNote, submitInvestigationFeedback } from "./investigation-feedback";

const actor = { userId: USER, organizationId: ORG, projectId: PROJECT };
const run = {
  id: RUN,
  incidentId: INCIDENT,
  status: "completed",
  hypotheses: [{ key: "h1", title: "Deploy", state: "validated", rationale: "", evidenceIds: [] }],
};

beforeEach(() => {
  selectResult = [run];
  wheres.length = 0;
  inserted.length = 0;
});

describe("normalizeFeedbackNote", () => {
  it("flattens control characters and bounds to 500", () => {
    expect(normalizeFeedbackNote("  line1\n\nline2\t\u0000x ")).toBe("line1 line2 x");
    expect(normalizeFeedbackNote("a".repeat(900))).toHaveLength(500);
    expect(normalizeFeedbackNote("   ")).toBeNull();
    expect(normalizeFeedbackNote(null)).toBeNull();
  });
});

describe("submitInvestigationFeedback", () => {
  it("looks the run up within the caller's organization and project", async () => {
    await submitInvestigationFeedback(actor, { investigationRunId: RUN, hypothesisKey: null, verdict: "right", note: null });
    const { params } = new PgDialect().sqlToQuery(wheres[0] as never);
    expect(params).toEqual(expect.arrayContaining([RUN, ORG, PROJECT, "investigation"]));
  });

  it("rejects a run outside the tenancy (no row) without inserting", async () => {
    selectResult = [];
    expect(await submitInvestigationFeedback(actor, { investigationRunId: RUN, hypothesisKey: null, verdict: "wrong", note: "x" }))
      .toEqual({ ok: false, error: "Investigation not found" });
    expect(inserted).toHaveLength(0);
  });

  it("rejects unfinished runs and unknown hypothesis keys", async () => {
    selectResult = [{ ...run, status: "running" }];
    expect((await submitInvestigationFeedback(actor, { investigationRunId: RUN, hypothesisKey: null, verdict: "right", note: null })).ok).toBe(false);
    selectResult = [run];
    expect(await submitInvestigationFeedback(actor, { investigationRunId: RUN, hypothesisKey: "h9", verdict: "right", note: null }))
      .toEqual({ ok: false, error: "Hypothesis not found" });
    expect(inserted).toHaveLength(0);
  });

  it("stores the verdict with tenancy ids taken from the run, a sanitized note and the actor", async () => {
    const result = await submitInvestigationFeedback(actor, {
      investigationRunId: RUN, hypothesisKey: "h1", verdict: "wrong", note: "was\nDNS",
    });
    expect(result).toEqual({ ok: true });
    expect(inserted[0]).toEqual({
      organizationId: ORG, projectId: PROJECT, incidentId: INCIDENT, investigationRunId: RUN,
      hypothesisKey: "h1", userId: USER, verdict: "wrong", note: "was DNS",
    });
  });
});
