import { isAiRateLimitError } from "./ai-rate-limit-error";

describe("isAiRateLimitError", () => {
  it("matches the capitalised message thrown by AuthService.checkRateLimit", () => {
    expect(isAiRateLimitError(new Error("Rate limit exceeded. Please try again in 5 seconds."))).toBe(true);
  });
  it("matches too many requests regardless of case", () => {
    expect(isAiRateLimitError(new Error("Too Many Requests"))).toBe(true);
  });
  it("ignores other errors and non-errors", () => {
    expect(isAiRateLimitError(new Error("boom"))).toBe(false);
    expect(isAiRateLimitError("rate limit")).toBe(false);
  });
});
