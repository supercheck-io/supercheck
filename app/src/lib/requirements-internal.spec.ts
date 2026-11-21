/** @jest-environment node */
jest.mock("@/utils/db", () => ({ db: {} }));

import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { db } from "@/utils/db";
import { PlanLimitBusyError } from "@/lib/middleware/plan-limit-lock";
import {
  normalizeTagName,
  syncRequirementTags,
  syncRequirementTagsByName,
  TagLimitError,
  TagRuleError,
  updateCoverageSnapshot,
} from "./requirements-internal";

const R = "44444444-4444-4444-8444-444444444444";

// `projectTagCount` answers the per-project count, which is queried only when a tag would be created.
// `events` records the order of execute (lock), select and insert calls.
function makeExecutor(existing: { id: string; name: string }[], projectTagCount = 0) {
  const inserted: unknown[] = [];
  const wheres: SQL[] = [];
  const executed: { sql: string; params: unknown[] }[] = [];
  const events: string[] = [];
  const executor = {
    execute: jest.fn(async (q: SQL) => {
      executed.push(new PgDialect().sqlToQuery(q));
      events.push("execute");
      return [];
    }),
    select: () => ({
      from: () => ({
        where: (w: SQL) => {
          wheres.push(w);
          events.push("select");
          return Object.assign(Promise.resolve([{ count: projectTagCount }]), { orderBy: () => Promise.resolve(existing) });
        },
      }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
    insert: () => ({
      values: (v: unknown) => {
        inserted.push(v);
        events.push("insert");
        return {
          returning: () => Promise.resolve((v as { name: string }[]).map((t, i) => ({ id: `new-${i}`, name: t.name }))),
          onConflictDoNothing: () => Promise.resolve(),
        };
      },
    }),
  };
  return { executor: executor as never, inserted, wheres, executed, events, raw: executor };
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

describe("syncRequirementTagsByName cap and project-tag lock", () => {
  const created = (inserted: unknown[]) =>
    inserted.length > 1 ? (inserted[0] as { name: string }[]).map((t) => t.name) : [];

  it("lenient: names that normalise alike count once, so a later distinct tag is kept", async () => {
    const { executor, inserted } = makeExecutor([]);
    const names = [...Array.from({ length: 11 }, (_, i) => `smoke${"!".repeat(i + 1)}`), "ai"];
    await syncRequirementTagsByName(R, names, "o", "p", "u", executor, true);
    expect(created(inserted)).toEqual(["smoke", "ai"]);
  });

  it("lenient: links two distinct stored tags whose names normalise alike", async () => {
    const { executor, inserted } = makeExecutor([
      { id: "spaced", name: "Login Flow" },
      { id: "dashed", name: "login-flow" },
    ]);
    await syncRequirementTagsByName(R, ["Login Flow", "login-flow"], "o", "p", "u", executor, true);
    expect(inserted).toEqual([[expect.objectContaining({ tagId: "spaced" }), expect.objectContaining({ tagId: "dashed" })]]);
  });

  it("strict: case-twins count once, so a later distinct tag is kept", async () => {
    const { executor, inserted } = makeExecutor([]);
    const names = [...Array.from({ length: 11 }, (_, i) => (i % 2 ? "SMOKE" : "smoke")), "auth"];
    await syncRequirementTagsByName(R, names, "o", "p", "u", executor);
    expect(created(inserted)).toEqual(["smoke", "auth"]);
  });

  it("still stops past 10 distinct tags (the requirement cap rejects 11)", async () => {
    const { executor, inserted } = makeExecutor([]);
    const names = Array.from({ length: 15 }, (_, i) => `tag${i}`);
    await expect(syncRequirementTagsByName(R, names, "o", "p", "u", executor)).rejects.toBeInstanceOf(TagLimitError);
    expect(inserted[0]).toHaveLength(11); // the lookup and creates were bounded at 11, not 15
  });

  it("takes the project-tag advisory lock on the same executor before the lookup", async () => {
    const { executor, executed, wheres } = makeExecutor([]);
    await syncRequirementTagsByName(R, ["smoke"], "o", "p", "u", executor);
    const lock = executed.find((q) => q.sql.includes("pg_advisory_xact_lock"));
    expect(lock?.params).toEqual(["project-tags:o:p"]);
    expect(executed.some((q) => q.sql.includes("lock_timeout"))).toBe(true);
    expect(wheres).toHaveLength(2); // lookup + count both ran after the lock
  });

  it("surfaces a lock timeout as PlanLimitBusyError before any write", async () => {
    const { executor, inserted, raw } = makeExecutor([]);
    raw.execute.mockImplementation(async (q: SQL) => {
      if (new PgDialect().sqlToQuery(q).sql.includes("pg_advisory_xact_lock")) {
        throw Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" });
      }
      return [];
    });
    await expect(syncRequirementTagsByName(R, ["smoke"], "o", "p", "u", executor)).rejects.toBeInstanceOf(PlanLimitBusyError);
    expect(inserted).toHaveLength(0);
  });

  it("opens its own transaction when called on the shared pool, so the lock spans the writes", async () => {
    const { executor, executed, inserted } = makeExecutor([]);
    const transaction = jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(executor));
    Object.assign(db, { transaction });
    try {
      await syncRequirementTagsByName(R, ["smoke"], "o", "p", "u");
    } finally {
      delete (db as { transaction?: unknown }).transaction;
    }
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(executed.some((q) => q.sql.includes("pg_advisory_xact_lock"))).toBe(true);
    expect(created(inserted)).toEqual(["smoke"]);
  });
});

describe("syncRequirementTagsByName tag rules (only for tags it would create)", () => {
  const created = (inserted: unknown[]) =>
    inserted.length > 1 ? (inserted[0] as { name: string }[]).map((t) => t.name) : [];

  it("strict: links an existing tag whose name predates the rules", async () => {
    const { executor, inserted, wheres } = makeExecutor([{ id: "legacy", name: "login flow" }]);
    await syncRequirementTagsByName(R, ["Login Flow"], "o", "p", "u", executor);
    expect(inserted).toEqual([[expect.objectContaining({ tagId: "legacy" })]]);
    expect(wheres).toHaveLength(1); // no count query when nothing is created
  });

  it.each(["ab", "login flow!", "x".repeat(21)])("strict: rejects creating %p before any write", async (name) => {
    const { executor, inserted } = makeExecutor([]);
    await expect(syncRequirementTagsByName(R, [name], "o", "p", "u", executor)).rejects.toThrow(TagRuleError);
    await expect(syncRequirementTagsByName(R, [name], "o", "p", "u", executor)).rejects.toThrow(`Invalid tag "${name}"`);
    expect(inserted).toHaveLength(0);
  });

  it("strict: one invalid new name fails the whole set before the count or any insert", async () => {
    const { executor, inserted, wheres } = makeExecutor([]);
    await expect(syncRequirementTagsByName(R, ["smoke", "ab"], "o", "p", "u", executor)).rejects.toThrow(TagRuleError);
    expect(inserted).toHaveLength(0);
    expect(wheres).toHaveLength(1);
  });

  it("strict: rejects creating past the project's 50-tag limit, counted in the project", async () => {
    const { executor, inserted, wheres } = makeExecutor([], 49);
    await expect(syncRequirementTagsByName(R, ["smoke", "auth"], "o", "p", "u", executor)).rejects.toThrow(
      "Maximum of 50 tags allowed per project"
    );
    expect(inserted).toHaveLength(0);
    const { sql: text, params } = new PgDialect().sqlToQuery(wheres[1]);
    expect(text).toContain('"organization_id"');
    expect(params).toEqual(["o", "p"]);
  });

  it("strict: creates up to the limit", async () => {
    const { executor, inserted } = makeExecutor([], 48);
    await syncRequirementTagsByName(R, ["smoke", "auth"], "o", "p", "u", executor);
    expect(created(inserted)).toEqual(["smoke", "auth"]);
  });

  it("lenient: normalises new names, drops what is still too short, and keeps the extraction marker", async () => {
    const { executor, inserted } = makeExecutor([]);
    await syncRequirementTagsByName(R, ["ai", "login flow!", "x", "a very long tag name that goes on"], "o", "p", "u", executor, true);
    expect(created(inserted)).toEqual(["ai", "login-flow", "a-very-long-tag-name"]);
  });

  it("lenient: reuses an existing tag that matches the normalised name, and dedupes names that normalise alike", async () => {
    const { executor, inserted, wheres } = makeExecutor([{ id: "t1", name: "login-flow" }]);
    await syncRequirementTagsByName(R, ["login flow", "login  flow", "new tag", "new-tag"], "o", "p", "u", executor, true);
    expect(new PgDialect().sqlToQuery(wheres[0]).params).toEqual(expect.arrayContaining(["login flow", "login-flow"]));
    expect(created(inserted)).toEqual(["new-tag"]);
    expect(inserted[1]).toEqual([expect.objectContaining({ tagId: "t1" }), expect.objectContaining({ tagId: "new-0" })]);
  });

  it("lenient: an unchanged legacy name is still linked as-is", async () => {
    const { executor, inserted } = makeExecutor([{ id: "legacy", name: "qa" }]);
    await syncRequirementTagsByName(R, ["qa"], "o", "p", "u", executor, true);
    expect(inserted).toEqual([[expect.objectContaining({ tagId: "legacy" })]]);
  });

  it("lenient: skips new tags past the project limit instead of failing", async () => {
    const full = makeExecutor([], 50);
    await syncRequirementTagsByName(R, ["smoke"], "o", "p", "u", full.executor, true);
    expect(full.inserted).toHaveLength(0);

    const oneLeft = makeExecutor([], 49);
    await syncRequirementTagsByName(R, ["smoke", "auth"], "o", "p", "u", oneLeft.executor, true);
    expect(created(oneLeft.inserted)).toEqual(["smoke"]);
  });

  it("lenient: a name with nothing usable left is dropped", async () => {
    const { executor, inserted } = makeExecutor([]);
    await syncRequirementTagsByName(R, ["!!!"], "o", "p", "u", executor, true);
    expect(inserted).toHaveLength(0);
  });
});

describe("syncRequirementTagsByName 10-name cap", () => {
  const created = (inserted: unknown[]) =>
    inserted.length > 1 ? (inserted[0] as { name: string }[]).map((t) => t.name) : [];
  const lookupParams = (wheres: SQL[]) => new PgDialect().sqlToQuery(wheres[0]).params.slice(2);

  it("lenient: names that normalise alike count once, so a later distinct name is kept", async () => {
    const { executor, inserted, wheres } = makeExecutor([]);
    const variants = Array.from({ length: 11 }, (_, i) => `smoke${"!".repeat(i + 1)}`);
    await syncRequirementTagsByName(R, [...variants, "ai"], "o", "p", "u", executor, true);
    expect(created(inserted)).toEqual(["smoke", "ai"]);
    expect(lookupParams(wheres)).toEqual(expect.arrayContaining(["smoke!", "smoke", "ai"]));
  });

  it("lenient: names with nothing usable left do not take a cap slot from a later valid name", async () => {
    const { executor, inserted } = makeExecutor([]);
    const valid = Array.from({ length: 10 }, (_, i) => `t${i + 1}-tag`);
    await syncRequirementTagsByName(R, ["!!!", "@@@", ...valid], "o", "p", "u", executor, true);
    expect(created(inserted)).toEqual(valid);
    expect(inserted[1]).toHaveLength(10);
  });

  it("lenient: a stored legacy tag whose name normalises to nothing is still linked", async () => {
    const { executor, inserted } = makeExecutor([{ id: "legacy", name: "テスト" }]);
    await syncRequirementTagsByName(R, ["テスト"], "o", "p", "u", executor, true);
    expect(inserted).toEqual([[expect.objectContaining({ tagId: "legacy" })]]);
  });

  it("lenient: looks up at most 10 names that normalise to nothing", async () => {
    const { executor, wheres } = makeExecutor([]);
    const junk = Array.from({ length: 15 }, (_, i) => "!".repeat(i + 1));
    await syncRequirementTagsByName(R, [...junk, "smoke"], "o", "p", "u", executor, true);
    expect(lookupParams(wheres)).toEqual([...junk.slice(0, 10), "smoke"]);
  });

  it("lenient: the lookup stays bounded to 11 distinct names", async () => {
    const { executor, wheres } = makeExecutor([]);
    const names = Array.from({ length: 30 }, (_, i) => `tag-${i}`);
    await expect(syncRequirementTagsByName(R, names, "o", "p", "u", executor, true)).rejects.toBeInstanceOf(TagLimitError);
    expect(lookupParams(wheres)).toHaveLength(11);
  });

  it("strict: still rejects more than 10 requested names, with a bounded lookup", async () => {
    const { executor, wheres } = makeExecutor([]);
    const names = Array.from({ length: 12 }, (_, i) => `tag-${i}`);
    await expect(syncRequirementTagsByName(R, names, "o", "p", "u", executor)).rejects.toBeInstanceOf(TagLimitError);
    expect(lookupParams(wheres)).toHaveLength(11);
  });

  it("strict: dedupes raw names only, so variants that would normalise alike are still rejected", async () => {
    const { executor, inserted } = makeExecutor([]);
    await expect(syncRequirementTagsByName(R, ["smoke", "smoke!"], "o", "p", "u", executor)).rejects.toThrow(
      'Invalid tag "smoke!"'
    );
    expect(inserted).toHaveLength(0);
  });
});

describe("syncRequirementTagsByName project tag lock", () => {
  it.each([false, true])(
    "takes a per-project transaction lock before the lookup, count and insert (lenient=%p)",
    async (lenient) => {
      const { executor, executed, events } = makeExecutor([], 10);
      await syncRequirementTagsByName(R, ["smoke"], "o", "p", "u", executor, lenient);
      // Every lock statement (timeout, lock, restore) runs before the lookup, the count and the insert.
      const firstSelect = events.indexOf("select");
      expect(firstSelect).toBeGreaterThan(0);
      expect(events.slice(0, firstSelect).every((e) => e === "execute")).toBe(true);
      expect(events.slice(firstSelect, firstSelect + 3)).toEqual(["select", "select", "insert"]);
      const lock = executed.find((q) => q.sql.includes("pg_advisory_xact_lock"));
      expect(lock?.sql).toContain("hashtext(");
      expect(lock?.params).toEqual(["project-tags:o:p"]);
    }
  );

  it("does not lock when there is no name to look up", async () => {
    const { executor, raw } = makeExecutor([]);
    await syncRequirementTagsByName(R, ["  "], "o", "p", "u", executor);
    expect(raw.execute).not.toHaveBeenCalled();
  });
});

describe("normalizeTagName", () => {
  it.each([
    [" Login Flow ", "Login-Flow"],
    ["a\tb", "a-b"],
    ["bad!char", "badchar"],
    ["x".repeat(30), "x".repeat(20)],
  ])("%p -> %p", (input, output) => {
    expect(normalizeTagName(input)).toBe(output);
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
    const locks: unknown[] = [];
    const executor = {
      select: () => ({ from: () => ({ where: () => ({ for: (mode: string) => { locks.push(mode); return Promise.resolve([]); } }) }) }),
      selectDistinctOn: () => q,
      update: () => ({ set: (v: Record<string, unknown>) => { sets.push(v); return { where: () => Promise.resolve() }; } }),
    };
    await updateCoverageSnapshot(R, executor as never);
    return { sets, orders, locks };
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

  it("locks the snapshot row before reading coverage inputs", async () => {
    const { locks } = await run([]);
    expect(locks).toEqual(["update"]);
  });

  it("marks coverage missing when nothing is linked", async () => {
    const { sets } = await run([]);
    expect(sets[0]).toMatchObject({ status: "missing", linkedTestCount: 0 });
  });
});
