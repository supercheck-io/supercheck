/** @jest-environment node */
const mockWhere = jest.fn();
jest.mock("@/utils/db", () => ({ db: { select: () => ({ from: () => ({ where: (...a: unknown[]) => mockWhere(...a) }) }) } }));

import { loadCreators } from "./creators";

describe("loadCreators", () => {
  beforeEach(() => mockWhere.mockReset());

  it("loads each distinct creator once and maps rows to name and image", async () => {
    mockWhere.mockResolvedValue([{ id: "u1", name: "Ada", image: "/api/users/u1/avatar?v=x" }]);
    const creatorOf = await loadCreators(["u1", "u1", null, "gone"]);
    expect(mockWhere).toHaveBeenCalledTimes(1);
    expect(creatorOf("u1")).toEqual({ createdByName: "Ada", createdByImage: "/api/users/u1/avatar?v=x" });
    expect(creatorOf("gone")).toEqual({ createdByName: null, createdByImage: null });
    expect(creatorOf(null)).toEqual({ createdByName: null, createdByImage: null });
  });

  it("skips the query when no row has a creator", async () => {
    const creatorOf = await loadCreators([null, undefined]);
    expect(mockWhere).not.toHaveBeenCalled();
    expect(creatorOf(undefined)).toEqual({ createdByName: null, createdByImage: null });
  });
});
