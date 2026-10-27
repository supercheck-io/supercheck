/** @jest-environment node */
import { PgDialect } from "drizzle-orm/pg-core";

const ctx = {
  userId: "018f0000-0000-7000-8000-00000000000c",
  organizationId: "018f0000-0000-7000-8000-00000000000a",
  project: { id: "018f0000-0000-7000-8000-00000000000b" },
};
jest.mock("@/lib/project-context", () => ({ requireProjectContext: jest.fn(async () => ctx) }));
const perm = jest.fn();
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: (...a: unknown[]) => perm(...a) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/logger/index", () => ({ createLogger: () => ({ error: jest.fn() }) }));
const rate = jest.fn();
jest.mock("@/lib/sre/sre-rate-limiter", () => ({ checkSrePostmortemRateLimit: (...a: unknown[]) => rate(...a) }));
const subscription = jest.fn();
jest.mock("@/app/api/sre/_auth", () => ({ requireSreSubscription: (...a: unknown[]) => subscription(...a) }));
const generate = jest.fn();
jest.mock("@/lib/sre/postmortem", () => ({
  ...jest.requireActual("@/lib/sre/postmortem"),
  generatePostmortemDraft: (...a: unknown[]) => generate(...a),
}));

const queue: unknown[][] = [];
const wheres: unknown[] = [];
const updates: unknown[] = [];
function chain(result: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const n of ["from", "leftJoin", "orderBy"]) c[n] = () => c;
  c.where = (w: unknown) => { wheres.push(w); return c; };
  c.limit = () => Promise.resolve(result);
  c.then = (r: (v: unknown[]) => unknown) => Promise.resolve(result).then(r);
  return c;
}
jest.mock("@/utils/db", () => ({
  db: {
    select: () => chain(queue.shift() ?? []),
    update: () => ({ set: (v: unknown) => { updates.push(v); return { where: (w: unknown) => { wheres.push(w); return Promise.resolve(); } }; } }),
  },
}));

import { generateSrePostmortem, saveSrePostmortem } from "./sre-postmortem";

const incidentId = "018f0000-0000-7000-8000-0000000000d1";
const resolved = {
  id: incidentId, incidentNumber: 4, title: "T", severity: "sev2", status: "resolved",
  createdAt: new Date("2026-10-01T10:00:00Z"), resolvedAt: new Date("2026-10-01T11:00:00Z"),
  resolutionSummary: "fixed", rootCauseSummary: "cause", confidenceScore: "0.8000", postmortem: null, serviceName: "svc",
};
const sections = { summary: "S", impact: "", timeline: "", root_cause: "", contributing_factors: "", follow_ups: "" };

beforeEach(() => {
  jest.clearAllMocks();
  queue.length = 0; wheres.length = 0; updates.length = 0;
  perm.mockReturnValue(true);
  rate.mockResolvedValue({ allowed: true, remaining: 4 });
  generate.mockResolvedValue({ sections, source: "template" });
  subscription.mockResolvedValue(null);
});

describe("generateSrePostmortem", () => {
  it("requires update permission before any data access", async () => {
    perm.mockReturnValue(false);
    expect(await generateSrePostmortem({ incidentId })).toEqual({ success: false, error: expect.stringContaining("Insufficient permissions") });
    expect(rate).not.toHaveBeenCalled();
  });

  it("is tenancy scoped and rejects unknown incidents and unresolved incidents", async () => {
    queue.push([]);
    expect((await generateSrePostmortem({ incidentId })).success).toBe(false);
    const params = new PgDialect().sqlToQuery(wheres[0] as never).params;
    expect(params).toEqual(expect.arrayContaining([incidentId, ctx.organizationId, ctx.project.id]));
    queue.push([{ ...resolved, status: "investigating" }]);
    expect(await generateSrePostmortem({ incidentId })).toEqual({ success: false, error: expect.stringContaining("Resolve the incident") });
    expect(generate).not.toHaveBeenCalled();
  });

  it("rate limits, then stores the generated draft", async () => {
    queue.push([resolved]);
    rate.mockResolvedValueOnce({ allowed: false, remaining: 0 });
    expect(await generateSrePostmortem({ incidentId })).toEqual({ success: false, error: expect.stringContaining("Too many drafts") });

    queue.push([resolved], [], [], []);
    const result = await generateSrePostmortem({ incidentId });
    expect(result).toMatchObject({ success: true, source: "template" });
    expect(updates[0]).toEqual(expect.objectContaining({ postmortem: expect.objectContaining({ generatedAt: expect.any(String) }) }));
  });
});

describe("generateSrePostmortem usage gate", () => {
  it("skips the model call (template only) when the usage gate is closed", async () => {
    queue.push([resolved], [], [], []);
    subscription.mockResolvedValue({ status: 402 });
    const result = await generateSrePostmortem({ incidentId });
    expect(result.success).toBe(true);
    expect(generate).toHaveBeenCalledWith(expect.anything(), { useAi: false, organizationId: ctx.organizationId });
    expect(subscription).toHaveBeenCalledWith(ctx.organizationId, { allowTrial: false });
  });
  it("uses the model when the gate is open", async () => {
    queue.push([resolved], [], [], []);
    await generateSrePostmortem({ incidentId });
    expect(generate).toHaveBeenCalledWith(expect.anything(), { useAi: true, organizationId: ctx.organizationId });
  });
});

describe("saveSrePostmortem", () => {
  it("rejects oversized sections and unresolved incidents", async () => {
    expect((await saveSrePostmortem({ incidentId, sections: { ...sections, summary: "x".repeat(4001) } })).success).toBe(false);
    queue.push([{ ...resolved, status: "triggered" }]);
    expect((await saveSrePostmortem({ incidentId, sections })).success).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("saves edited sections within the caller's tenancy", async () => {
    queue.push([resolved]);
    const result = await saveSrePostmortem({ incidentId, sections: { ...sections, follow_ups: "- a" } });
    expect(result.success).toBe(true);
    expect(updates[0]).toEqual(expect.objectContaining({ postmortem: expect.objectContaining({ sections: expect.objectContaining({ follow_ups: "- a" }) }) }));
    const updateWhere = new PgDialect().sqlToQuery(wheres.at(-1) as never).params;
    expect(updateWhere).toEqual(expect.arrayContaining([incidentId, ctx.organizationId, ctx.project.id]));
  });
});
