import { normalizePublicStatusPageId } from "./public-status-page-id";

describe("normalizePublicStatusPageId", () => {
  it("returns canonical UUIDs unchanged", () => {
    expect(
      normalizePublicStatusPageId("019d154a-2800-7a34-9c04-fa382eb0854f")
    ).toBe("019d154a-2800-7a34-9c04-fa382eb0854f");
  });

  it("continues accepting non-versioned canonical UUIDs", () => {
    expect(
      normalizePublicStatusPageId("00000000-0000-0000-0000-000000000123")
    ).toBe("00000000-0000-0000-0000-000000000123");
  });

  it("normalizes compact UUIDs to canonical form", () => {
    expect(
      normalizePublicStatusPageId("019d154a28007a349c04fa382eb0854f")
    ).toBe("019d154a-2800-7a34-9c04-fa382eb0854f");
  });

  it("returns null for invalid values", () => {
    expect(normalizePublicStatusPageId("")).toBeNull();
    expect(normalizePublicStatusPageId("not-a-uuid")).toBeNull();
    expect(
      normalizePublicStatusPageId("019d154a28007a349c04fa382eb085")
    ).toBeNull();
  });
});
