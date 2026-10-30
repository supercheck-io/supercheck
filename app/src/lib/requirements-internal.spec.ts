/** @jest-environment node */
jest.mock("@/utils/db", () => ({ db: {} }));

import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { syncRequirementTags, syncRequirementTagsByName, TagLimitError, updateCoverageSnapshot } from "./requirements-internal";

const R = "44444444-4444-4444-8444-444444444444";

function makeExecutor(existing: { id: string; name: string }[]) {
  const inserted: unknown[] = [];
  const wheres: SQL[] = [];
  const executor = {
    select: () => ({
      from: () => ({
        where: (w: SQL) => {
          wheres.push(w);
          return { orderBy: () => Promise.resolve(existing) };
        },
      }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
    insert: () => ({
      values: (v: unknown) => {
        inserted.push(v);
        return {
          returning: () => Promise.resolve((v as { name: string }[]).map((t, i) => ({ id: `new-${i}`, name: t.name }))),
          onConflictDoNothing: () => Promise.resolve(),
        };
      },
    }),
  };
  return { executor: executor as never, inserted, wheres };
}

describe("syncRequirementTagsByName", () => {
  it("looks tags up with lower(name) against lowered names, scoped to the project", async () => {
    const { executor, wheres } = makeExecutor([]);
    await syncRequirementTagsByName(R, ["Smoke"], "o", "p", "u", executor);
    const { sql: text, params } = new PgDialect().sqlToQuery(wheres[0]);
    expect(text).toContain("lower(");
    expect(text).toContain('"project_id"');
    expect(params).toEqual(expect.arrayContaining(["p", "smoke"]));
    expect(params).not.toContain("Smoke");
  });

  it("reuses an existing tag regardless of casing instead of creating a twin", async () => {
    const { executor, inserted } = makeExecutor([{ id: "t1", name: "Smoke" }]);
    await syncRequirementTagsByName(R, ["smoke", "SMOKE"], "o", "p", "u", executor);
    // only the requirement_tags link insert, no tags insert
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toEqual([expect.objectContaining({ requirementId: R, tagId: "t1" })]);
  });

  it("links only the exact-case tag when case-twins are stored", async () => {
    const { executor, inserted } = makeExecutor([
      { id: "old", name: "Smoke" },
      { id: "new", name: "smoke" },
    ]);
    await syncRequirementTagsByName(R, ["smoke"], "o", "p", "u", executor);
    expect(inserted).toEqual([[expect.objectContaining({ tagId: "new" })]]);
  });

  it("links the oldest twin when no exact-case match exists", async () => {
    const { executor, inserted } = makeExecutor([
      { id: "old", name: "Smoke" },
      { id: "newer", name: "SMOKE" },
    ]);
    await syncRequirementTagsByName(R, ["smOKE"], "o", "p", "u", executor);
    expect(inserted).toEqual([[expect.objectContaining({ tagId: "old" })]]);
  });

  it("creates new tags with the first spelling given, deduped case-insensitively", async () => {
    const { executor, inserted } = makeExecutor([]);
    await syncRequirementTagsByName(R, ["Smoke", "smoke", "Auth"], "o", "p", "u", executor);
    expect(inserted[0]).toEqual([
      expect.objectContaining({ name: "Smoke", projectId: "p", organizationId: "o" }),
      expect.objectContaining({ name: "Auth" }),
    ]);
  });
});

describe("syncRequirementTags", () => {
  it("signals the 10-tag cap with a typed error the services map to a validation failure", async () => {
    const { executor } = makeExecutor([]);
    await expect(syncRequirementTags(R, Array.from({ length: 11 }, (_, i) => `t${i}`), executor)).rejects.toBeInstanceOf(
      TagLimitError
    );
  });
});

describe("updateCoverageSnapshot", () => {
  const run = async (rows: { testId: string; status: string | null }[]) => {
    const sets: Record<string, unknown>[] = [];
    const orders: unknown[][] = [];
    const q: Record<string, unknown> = {};
    q.from = () => q;
    q.leftJoin = () => q;
    q.where = () => q;
    q.orderBy = (...o: unknown[]) => { orders.push(o); return Promise.resolve(rows); };
    const executor = {
      selectDistinctOn: () => q,
      update: () => ({ set: (v: Record<string, unknown>) => { sets.push(v); return { where: () => Promise.resolve() }; } }),
    };
    await updateCoverageSnapshot(R, executor as never);
    return { sets, orders };
  };

  it("derives the link count and pass/fail counts from one latest-run-per-test result", async () => {
    const { sets, orders } = await run([
      { testId: "a", status: "failed" },
      { testId: "b", status: "passed" },
      { testId: "c", status: null },
    ]);
    expect(sets[0]).toMatchObject({ status: "failing", linkedTestCount: 3, passedTestCount: 1, failedTestCount: 1 });
    // runs.id is the final ordering key, so equal completedAt values resolve deterministically.
    expect(orders[0]).toHaveLength(3);
  });

  it("marks coverage missing when nothing is linked", async () => {
    const { sets } = await run([]);
    expect(sets[0]).toMatchObject({ status: "missing", linkedTestCount: 0 });
  });
});
