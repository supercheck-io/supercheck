import { tagNameError } from "./tag-validation";

describe("tagNameError", () => {
  it.each(["abc", "a".repeat(20), "release_1", "eu-west"])("accepts %p", (name) => {
    expect(tagNameError(name)).toBeNull();
  });

  it.each([
    ["", "Tag name cannot be empty"],
    ["ab", "Tag name must be between 3 and 20 characters"],
    ["a".repeat(21), "Tag name must be between 3 and 20 characters"],
    ["has space", "Tag name cannot contain spaces"],
    ["bad!char", "Tag name can only contain letters, numbers, underscores, and hyphens"],
  ])("rejects %p", (name, message) => {
    expect(tagNameError(name)).toBe(message);
  });
});
