/** @jest-environment node */
jest.mock("@/utils/db", () => ({
  db: { query: { statusPageSubscribers: { findFirst: jest.fn() } }, update: jest.fn() },
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("next/headers", () => ({ headers: jest.fn() }));
jest.mock("@/lib/api-key-rate-limiter", () => ({
  apiKeyRateLimiter: { checkAndIncrement: jest.fn() },
}));

import { headers } from "next/headers";
import { db } from "@/utils/db";
import { apiKeyRateLimiter } from "@/lib/api-key-rate-limiter";
import { signUnsubscribeToken } from "@/lib/subscriber-tokens";
import { getSubscriberByToken, unsubscribeFromStatusPage } from "./unsubscribe-from-status-page";

const limiter = apiKeyRateLimiter.checkAndIncrement as jest.Mock;
const findFirst = db.query.statusPageSubscribers.findFirst as jest.Mock;
const token = signUnsubscribeToken("550e8400-e29b-41d4-a716-446655440000");

describe("unsubscribe rate limit", () => {
  const originalHops = process.env.TRUSTED_PROXY_HOPS;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TRUSTED_PROXY_HOPS = "0";
    (headers as jest.Mock).mockResolvedValue(new Headers({ "x-forwarded-for": "203.0.113.7" }));
    findFirst.mockResolvedValue(null);
  });

  afterAll(() => {
    if (originalHops === undefined) delete process.env.TRUSTED_PROXY_HOPS;
    else process.env.TRUSTED_PROXY_HOPS = originalHops;
  });

  it("rejects over-limit callers before any token lookup", async () => {
    limiter.mockResolvedValue({ allowed: false });

    expect(await unsubscribeFromStatusPage(token)).toMatchObject({ success: false, rateLimited: true, retryAfter: 600 });
    expect(await getSubscriberByToken(token)).toEqual({ success: false, subscriber: null });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("keys the bucket by a hash of the client IP, never the raw IP", async () => {
    limiter.mockResolvedValue({ allowed: true });

    await unsubscribeFromStatusPage(token);

    const [key, config] = limiter.mock.calls[0];
    expect(key).toMatch(/^status-unsubscribe:[a-f0-9]{64}$/);
    expect(key).not.toContain("203.0.113.7");
    expect(config).toMatchObject({ maxRequests: 120, timeWindow: 600 });
    expect(findFirst).toHaveBeenCalled();
  });

  it("gives callers with an unresolved IP a larger shared bucket", async () => {
    (headers as jest.Mock).mockResolvedValue(new Headers());
    limiter.mockResolvedValue({ allowed: true });

    await unsubscribeFromStatusPage(token);

    expect(limiter.mock.calls[0][1]).toMatchObject({ maxRequests: 600 });
  });

  it("fails open when the limiter is unavailable", async () => {
    limiter.mockResolvedValue({ allowed: false, unavailable: true });

    await unsubscribeFromStatusPage(token);

    expect(findFirst).toHaveBeenCalled();
  });

  it("fails open when the limit check itself throws", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    limiter.mockRejectedValue(new Error("redis exploded"));

    await getSubscriberByToken(token);

    expect(findFirst).toHaveBeenCalled();
  });
});
