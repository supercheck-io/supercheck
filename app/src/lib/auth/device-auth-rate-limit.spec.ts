/** @jest-environment node */
jest.mock("@/lib/queue", () => ({ getRedisConnection: () => Promise.reject(new Error("ECONNREFUSED")) }));

import { allowDeviceAuthRequest } from "./device-auth-rate-limit";

const limit = { scope: "t", subject: "s", max: 5 };

describe("device auth rate limiter when the backend errors", () => {
  it("fails closed by default", async () => {
    expect(await allowDeviceAuthRequest([limit])).toBe(false);
  });
  it("fails open when asked to", async () => {
    expect(await allowDeviceAuthRequest([limit], { failOpen: true })).toBe(true);
  });
});
