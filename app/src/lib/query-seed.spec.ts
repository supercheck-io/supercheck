import { SEED_FRESH_MS, seededQueryOptions } from "./query-seed";

describe("seededQueryOptions", () => {
  it("changes nothing without a server value", () => {
    expect(seededQueryOptions(undefined, 123)).toEqual({});
  });

  it("starts from the server value, fresh from when it was read", () => {
    expect(seededQueryOptions({ a: 1 }, 123)).toEqual({
      initialData: { a: 1 },
      initialDataUpdatedAt: 123,
      staleTime: SEED_FRESH_MS,
      refetchOnMount: true,
    });
  });

  it("keeps falsy server values such as false", () => {
    expect(seededQueryOptions(false, 1)).toMatchObject({ initialData: false });
  });
});
