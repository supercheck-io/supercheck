/** @jest-environment node */
jest.mock("@/utils/db", () => ({ db: {} }));

import { syncRequirementTagsByName } from "./requirements-internal";

const R = "44444444-4444-4444-8444-444444444444";

function makeExecutor(existing: { id: string; name: string }[]) {
  const inserted: unknown[] = [];
  const executor = {
    select: () => ({ from: () => ({ where: () => Promise.resolve(existing) }) }),
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
  return { executor: executor as never, inserted };
}

describe("syncRequirementTagsByName", () => {
  it("reuses an existing tag regardless of casing instead of creating a twin", async () => {
    const { executor, inserted } = makeExecutor([{ id: "t1", name: "Smoke" }]);
    await syncRequirementTagsByName(R, ["smoke", "SMOKE"], "o", "p", "u", executor);
    // only the requirement_tags link insert, no tags insert
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toEqual([expect.objectContaining({ requirementId: R, tagId: "t1" })]);
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
