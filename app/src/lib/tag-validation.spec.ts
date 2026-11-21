import { tagColorError, tagNameError } from "./tag-validation";

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

describe("tagColorError", () => {
  it.each([undefined, null, "", "#3B82F6", "#abcdef"])("accepts %p", (color) => {
    expect(tagColorError(color)).toBeNull();
  });

  it.each(["red", "#FFF", "#3B82F6AA", "#GGGGGG", 123, "x".repeat(60)])("rejects %p", (color) => {
    expect(tagColorError(color)).toBe("Tag color must be a hex color like #3B82F6");
  });
});
