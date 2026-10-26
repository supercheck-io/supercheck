/** @jest-environment node */
const checkAndIncrement = jest.fn();
jest.mock("@/lib/api-key-rate-limiter", () => ({
  apiKeyRateLimiter: { checkAndIncrement: (...args: unknown[]) => checkAndIncrement(...args) },
}));

import {
  admitMcpCall,
  isMcpRefusal,
  MCP_MAX_BATCH,
  MCP_MAX_CONCURRENT,
  MCP_USER_MAX_CONCURRENT,
  MCP_BODY_READ_TIMEOUT_MS,
  McpBodyTimeoutError,
  readMcpBody,
  type McpCallPermit,
} from "./call-limits";

const ok = { allowed: true, remaining: 10, limit: 300, resetAt: new Date() };
const permits: McpCallPermit[] = [];
const admit = async (user: string, client: string, messages = 1) => {
  const permit = await admitMcpCall({ user, client }, messages);
  if (!isMcpRefusal(permit)) permits.push(permit);
  return permit;
};

beforeEach(() => {
  checkAndIncrement.mockReset().mockResolvedValue(ok);
});
afterEach(() => {
  for (const permit of permits.splice(0)) permit.release();
});

describe("admitMcpCall", () => {
  it("charges the app and then the user's total, each as one atomic call for the whole batch", async () => {
    await admit("alice", "app-1", 3);
    expect(checkAndIncrement.mock.calls.map(([key, , cost]) => [key, cost])).toEqual([
      ["mcp:call:alice:app-1", 3],
      ["mcp:user:alice", 3],
    ]);
  });

  it("does not let a user multiply their quota by registering more apps", async () => {
    // Every app has its own untouched bucket, but the user's bucket is shared and refuses.
    checkAndIncrement.mockImplementation(async (key: string) =>
      key === "mcp:user:alice" ? { ...ok, allowed: false, retryAfter: 12 } : ok,
    );
    for (const client of ["app-1", "app-2", "app-3"]) {
      expect(await admit("alice", client)).toEqual({ status: 429, error: "rate_limited", retryAfter: 12 });
    }
  });

  it("refuses a flooding app at its own bucket without spending the user's shared quota", async () => {
    checkAndIncrement.mockImplementation(async (key: string) =>
      key === "mcp:call:alice:flood" ? { ...ok, allowed: false, retryAfter: 3 } : ok,
    );
    for (let i = 0; i < 5; i += 1) expect(await admit("alice", "flood")).toMatchObject({ status: 429 });
    expect(checkAndIncrement.mock.calls.some(([key]) => key === "mcp:user:alice")).toBe(false);
    // The user's other apps are unaffected.
    expect(isMcpRefusal(await admit("alice", "calm"))).toBe(false);
  });

  it("keeps different users independent", async () => {
    checkAndIncrement.mockImplementation(async (key: string) =>
      key === "mcp:user:alice" ? { ...ok, allowed: false, retryAfter: 1 } : ok,
    );
    expect(await admit("alice", "app-1")).toMatchObject({ status: 429 });
    expect(isMcpRefusal(await admit("bob", "app-1"))).toBe(false);
  });

  it("refuses with 503 when the limiter is down, which is not the caller's quota", async () => {
    checkAndIncrement.mockResolvedValue({ ...ok, allowed: false, retryAfter: 60, unavailable: true });
    expect(await admit("alice", "app-1")).toEqual({ status: 503, error: "rate_limiter_unavailable", retryAfter: 5 });
  });

  it("rejects an oversized batch without touching the limiter", async () => {
    expect(await admit("alice", "app-1", MCP_MAX_BATCH + 1)).toEqual({ status: 400, error: "batch_too_large" });
    expect(checkAndIncrement).not.toHaveBeenCalled();
  });

  it("caps in-flight requests per app and frees the slot when a permit is released", async () => {
    const held = [];
    for (let i = 0; i < MCP_MAX_CONCURRENT; i += 1) held.push(await admit("alice", "app-1"));
    expect(await admit("alice", "app-1")).toMatchObject({ status: 429, error: "too_many_concurrent_requests" });

    (held[0] as McpCallPermit).release();
    expect(isMcpRefusal(await admit("alice", "app-1"))).toBe(false);
  });

  it("caps in-flight requests per user across apps", async () => {
    for (let i = 0; i < MCP_USER_MAX_CONCURRENT; i += 1) await admit("alice", `app-${i % 4}`);
    expect(await admit("alice", "app-new")).toMatchObject({ status: 429, error: "too_many_concurrent_requests" });
    expect(isMcpRefusal(await admit("bob", "app-0"))).toBe(false);
  });

  it("frees the slot when the limiter refuses, so refused calls cannot exhaust concurrency", async () => {
    checkAndIncrement.mockResolvedValue({ ...ok, allowed: false, retryAfter: 1 });
    for (let i = 0; i < MCP_USER_MAX_CONCURRENT * 2; i += 1) {
      expect(await admit("alice", "app-1")).toMatchObject({ status: 429, error: "rate_limited" });
    }
  });

  it("releasing twice does not free a slot that another request holds", async () => {
    const held: McpCallPermit[] = [];
    for (let i = 0; i < MCP_MAX_CONCURRENT; i += 1) held.push((await admit("alice", "app-1")) as McpCallPermit);
    held[0].release();
    held[0].release();
    expect(isMcpRefusal(await admit("alice", "app-1"))).toBe(false); // takes the freed slot
    expect(await admit("alice", "app-1")).toMatchObject({ status: 429, error: "too_many_concurrent_requests" });
  });
});

describe("McpCallPermit.charge", () => {
  const admitted = async (messages = 1) => {
    const permit = await admit("alice", "app-1", messages);
    checkAndIncrement.mockClear();
    return permit as McpCallPermit;
  };

  it("charges only the messages not yet paid for, to the app and then the user", async () => {
    const permit = await admitted(1);
    expect(await permit.charge(5)).toBeNull();
    expect(checkAndIncrement.mock.calls.map(([key, , cost]) => [key, cost])).toEqual([
      ["mcp:call:alice:app-1", 4],
      ["mcp:user:alice", 4],
    ]);
  });

  it.each([0, 1])("charges nothing more for a body of %s message(s) already covered by the admission", async (total) => {
    const permit = await admitted(1);
    expect(await permit.charge(total)).toBeNull();
    expect(checkAndIncrement).not.toHaveBeenCalled();
  });

  it("does not charge the same messages twice when called again", async () => {
    const permit = await admitted(1);
    await permit.charge(5);
    checkAndIncrement.mockClear();
    expect(await permit.charge(5)).toBeNull();
    expect(checkAndIncrement).not.toHaveBeenCalled();
  });

  it("refuses a batch over the limit without touching the limiter", async () => {
    const permit = await admitted(1);
    expect(await permit.charge(MCP_MAX_BATCH + 1)).toEqual({ status: 400, error: "batch_too_large" });
    expect(checkAndIncrement).not.toHaveBeenCalled();
  });

  it("accepts a batch of exactly the limit", async () => {
    const permit = await admitted(1);
    expect(await permit.charge(MCP_MAX_BATCH)).toBeNull();
    expect(checkAndIncrement).toHaveBeenCalledTimes(2);
  });

  it("returns a 429 with Retry-After when the quota cannot cover the rest of the batch", async () => {
    const permit = await admitted(1);
    checkAndIncrement.mockResolvedValue({ ...ok, allowed: false, retryAfter: 12 });
    expect(await permit.charge(5)).toEqual({ status: 429, error: "rate_limited", retryAfter: 12 });
  });

  it("returns a 503, not a 429, when the limiter is down", async () => {
    const permit = await admitted(1);
    checkAndIncrement.mockResolvedValue({ ...ok, allowed: false, unavailable: true });
    expect(await permit.charge(5)).toEqual({ status: 503, error: "rate_limiter_unavailable", retryAfter: 5 });
  });

  it("lets the caller pay again after a refused charge", async () => {
    const permit = await admitted(1);
    checkAndIncrement.mockResolvedValueOnce({ ...ok, allowed: false, retryAfter: 3 });
    expect(await permit.charge(5)).toMatchObject({ status: 429 });
    checkAndIncrement.mockResolvedValue(ok);
    expect(await permit.charge(5)).toBeNull();
    expect(checkAndIncrement.mock.calls.at(-1)?.[2]).toBe(4);
  });
});


describe("readMcpBody deadline", () => {
  afterEach(() => jest.useRealTimers());

  it("cancels the reader and rejects when the client stalls mid-upload", async () => {
    jest.useFakeTimers();
    const cancel = jest.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"jsonrpc":'));
      },
      cancel,
    });
    const request = { body } as unknown as Request;
    const result = readMcpBody(request, 1024).catch((error) => error);
    await jest.advanceTimersByTimeAsync(MCP_BODY_READ_TIMEOUT_MS);
    expect(await result).toBeInstanceOf(McpBodyTimeoutError);
    expect(cancel).toHaveBeenCalled();
  });
});
