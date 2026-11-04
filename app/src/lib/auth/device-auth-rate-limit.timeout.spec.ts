/** @jest-environment node */
jest.mock("@/lib/queue", () => ({
  getRedisConnection: async () => ({ eval: () => new Promise(() => undefined) }),
}));

import { allowDeviceAuthRequest } from "./device-auth-rate-limit";

const limit = { scope: "t", subject: "s", max: 5 };

describe("device auth rate limiter when Redis hangs", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it.each([false, true])("applies failOpen=%s after the timeout", async (failOpen) => {
    const pending = allowDeviceAuthRequest([limit], { failOpen });
    await jest.advanceTimersByTimeAsync(1000);
    expect(await pending).toBe(failOpen);
  });
});
