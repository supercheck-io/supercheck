/** @jest-environment node */
jest.mock("@/utils/db", () => ({ db: {} }));

import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
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
// `events` records the order of lock, select and insert calls.
function makeExecutor(existing: { id: string; name: string }[], projectTagCount = 0) {
  const inserted: unknown[] = [];
  const wheres: SQL[] = [];
  const locks: SQL[] = [];
  const events: string[] = [];
  const executor = {
    execute: jest.fn((q: SQL) => {
      locks.push(q);
      events.push("lock");
      return Promise.resolve([]);
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
  return { executor: executor as never, raw: executor, inserted, wheres, locks, events };
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
      const { executor, locks, events } = makeExecutor([], 10);
      await syncRequirementTagsByName(R, ["smoke"], "o", "p", "u", executor, lenient);
      expect(events.slice(0, 4)).toEqual(["lock", "select", "select", "insert"]);
      const { sql: text, params } = new PgDialect().sqlToQuery(locks[0]);
      expect(text).toContain("pg_advisory_xact_lock(hashtext(");
      expect(params).toEqual(["project-tags:o:p"]);
    }
  );

  it("does not lock when there is no name to look up", async () => {
    const { executor, raw } = makeExecutor([]);
    await syncRequirementTagsByName(R, ["  "], "o", "p", "u", executor);
    expect(raw.execute).not.toHaveBeenCalled();
  });

  it("does not take a transaction lock on the shared pool, where nothing would hold it", async () => {
    const { db } = jest.requireMock("@/utils/db") as { db: Record<string, unknown> };
    const { raw, inserted } = makeExecutor([]);
    Object.assign(db, raw);
    try {
      await syncRequirementTagsByName(R, ["smoke"], "o", "p", "u");
      expect(raw.execute).not.toHaveBeenCalled();
      expect(inserted).toHaveLength(2);
    } finally {
      for (const key of Object.keys(raw)) delete db[key];
    }
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
