import { withDeadline } from "./with-deadline";

describe("withDeadline", () => {
  afterEach(() => jest.useRealTimers());

  it("returns the value when the read settles in time", async () => {
    await expect(withDeadline(Promise.resolve(5), 100, null)).resolves.toBe(5);
  });

  it("returns the fallback when the read is too slow", async () => {
    jest.useFakeTimers();
    const result = withDeadline(new Promise(() => {}), 300, "fallback");
    jest.advanceTimersByTime(300);
    await expect(result).resolves.toBe("fallback");
  });

  it("passes a rejection through and clears its timer", async () => {
    jest.useFakeTimers();
    await expect(withDeadline(Promise.reject(new Error("db down")), 300, null)).rejects.toThrow("db down");
    expect(jest.getTimerCount()).toBe(0);
  });
});
