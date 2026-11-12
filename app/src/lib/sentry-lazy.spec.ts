const loaded = jest.fn();
const captureCheckIn = jest.fn();
const getTraceHeaders = jest.fn(() => ({ sentryTrace: "t-s-1", baggage: "b" }));
jest.mock("@/lib/sentry", () => {
  loaded();
  return { initSentry: () => true, captureCheckIn, getTraceHeaders };
});

import { checkedTick, getTraceHeaders as lazyTraceHeaders } from "./sentry-lazy";

const DSN = "https://abc@o1.ingest.sentry.io/1";
const flush = () => new Promise((r) => setTimeout(r, 0));
const schedule = { type: "interval", value: 5, unit: "minute" } as const;

describe("sentry-lazy", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
    jest.clearAllMocks();
  });

  it("never loads the SDK module when self-hosted or without a DSN", async () => {
    process.env.SENTRY_DSN = DSN;
    process.env.SELF_HOSTED = "true";
    expect(await lazyTraceHeaders()).toEqual({});
    await expect(checkedTick("x", schedule, async () => 7)).resolves.toBe(7);
    delete process.env.SENTRY_DSN;
    process.env.SELF_HOSTED = "false";
    expect(await lazyTraceHeaders()).toEqual({});
    await flush();
    expect(loaded).not.toHaveBeenCalled();
    expect(captureCheckIn).not.toHaveBeenCalled();
  });

  it("checks in only when the tick ran, and reports errors", async () => {
    process.env.SENTRY_DSN = DSN;
    process.env.SELF_HOSTED = "false";
    expect(await lazyTraceHeaders()).toEqual({ sentryTrace: "t-s-1", baggage: "b" });
    await checkedTick("skip", schedule, async () => ({ skipped: true }), (r) => !r.skipped);
    await checkedTick("ran", schedule, async () => ({ skipped: false }), (r) => !r.skipped);
    await expect(checkedTick("boom", schedule, async () => { throw new Error("x"); })).rejects.toThrow("x");
    await flush();
    expect(captureCheckIn.mock.calls.map((c) => [c[0], c[2]])).toEqual([
      ["ran", "ok"],
      ["boom", "error"],
    ]);
  });

  it("throttles ok check-ins with minIntervalMs", async () => {
    process.env.SENTRY_DSN = DSN;
    process.env.SELF_HOSTED = "false";
    await checkedTick("fast", schedule, async () => 1, () => true, 60_000);
    await checkedTick("fast", schedule, async () => 1, () => true, 60_000);
    await flush();
    expect(captureCheckIn).toHaveBeenCalledTimes(1);
  });
});
