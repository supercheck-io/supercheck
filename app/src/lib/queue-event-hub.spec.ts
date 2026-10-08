/** @jest-environment node */

jest.mock("bullmq", () => ({
  QueueEvents: jest.fn((name, opts) => {
    const { EventEmitter } = jest.requireActual("node:events");
    const events = Object.assign(new EventEmitter(), {
      name,
      opts,
      closed: false,
      waitUntilReady: jest.fn().mockResolvedValue(undefined),
      close: jest.fn(),
    });
    events.close.mockImplementation(async () => { events.closed = true; });
    return events;
  }),
}));
jest.mock("@/lib/queue", () => ({
  getQueues: jest.fn(),
  buildRedisOptions: jest.fn((overrides) => ({ host: "localhost", maxRetriesPerRequest: null, ...overrides })),
  PLAYWRIGHT_QUEUE: "playwright",
  k6QueueName: (code: string) => `k6-${code}`,
  monitorQueueName: (code: string) => `monitor-${code}`,
}));
jest.mock("@/utils/db", () => ({ db: { query: { runs: { findFirst: jest.fn() } } } }));
jest.mock("@/db/schema", () => ({ runs: { id: "id" } }));
jest.mock("./logger/index", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

import type { EventEmitter } from "node:events";
import { QueueEvents } from "bullmq";
import { getQueues, buildRedisOptions } from "@/lib/queue";
import { getQueueEventHub, invalidateQueueEventHub } from "./queue-event-hub";

type EventClient = EventEmitter & {
  name: string;
  opts: { connection: Record<string, unknown> };
  closed: boolean;
  waitUntilReady: jest.Mock;
  close: jest.Mock;
};
const mockGetQueues = getQueues as jest.Mock;
const mockQueueEvents = QueueEvents as unknown as jest.Mock<EventClient, [string, EventClient["opts"]]>;
const createEvents = mockQueueEvents.getMockImplementation()!;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function queuesFor(codes = ["eu"]) {
  const queue = (name: string) => ({ name });
  return {
    playwrightQueues: { global: queue("playwright") },
    k6Queues: Object.fromEntries(["global", ...codes].map((code) => [code, queue(`k6-${code}`)])),
    monitorExecutionQueue: Object.fromEntries(codes.map((code) => [code, queue(`monitor-${code}`)])),
  };
}

function clients() {
  return mockQueueEvents.mock.results.map((result) => result.value as EventClient);
}

function expectOneSourcePerQueue() {
  const live = clients().filter((client) => !client.closed);
  expect(live.map((client) => client.name).sort()).toEqual(["k6-eu", "k6-global", "monitor-eu", "playwright"]);
  for (const client of live) {
    expect(client.opts.connection).toEqual({ host: "localhost", maxRetriesPerRequest: null, lazyConnect: false });
    expect(client.opts.connection).not.toHaveProperty("duplicate");
    for (const event of ["waiting", "active", "completed", "failed", "stalled"]) {
      expect(client.listenerCount(event)).toBe(1);
    }
  }
}

describe("queue event hub refresh", () => {
  beforeEach(() => {
    delete globalThis.__SUPER_CHECK_QUEUE_EVENT_HUB__;
    jest.clearAllMocks();
    mockQueueEvents.mockImplementation(createEvents);
    mockGetQueues.mockResolvedValue(queuesFor());
    // Keep test hubs from registering shutdown hooks on the Jest process.
    jest.spyOn(process, "once").mockImplementation(() => process);
  });

  afterEach(() => {
    delete globalThis.__SUPER_CHECK_QUEUE_EVENT_HUB__;
    jest.restoreAllMocks();
  });

  it("gives BullMQ owned connection options and shares the hub singleton", async () => {
    const hub = getQueueEventHub();
    await hub.ready();
    expect(getQueueEventHub()).toBe(hub);
    expect(mockQueueEvents).toHaveBeenCalledTimes(4);
    expectOneSourcePerQueue();
    expect(buildRedisOptions).toHaveBeenCalledTimes(4);
  });

  it("serializes overlapping refreshes without duplicate listeners", async () => {
    const hub = getQueueEventHub();
    await hub.ready();
    const initial = clients();
    const closing = deferred<void>();
    initial[0].close.mockImplementation(async () => {
      await closing.promise;
      initial[0].closed = true;
    });
    const listener = jest.fn();
    const unsubscribe = hub.subscribe(listener);
    const first = invalidateQueueEventHub();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(initial[0].close).toHaveBeenCalledTimes(1);
    const second = invalidateQueueEventHub();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(mockGetQueues).toHaveBeenCalledTimes(1);
    expect(mockQueueEvents).toHaveBeenCalledTimes(4);

    closing.resolve(undefined);
    await Promise.all([first, second]);
    expect(mockGetQueues).toHaveBeenCalledTimes(3);
    expect(mockQueueEvents).toHaveBeenCalledTimes(12);
    expectOneSourcePerQueue();
    for (const client of clients().filter((source) => source.closed)) {
      expect(client.close).toHaveBeenCalledTimes(1);
    }
    for (const client of clients().filter((source) => !source.closed)) {
      client.emit("active", { jobId: "run-1" });
    }
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(4);
    unsubscribe();
    expect(hub.listenerCount("event")).toBe(0);
  });

  it("drains pending initial event attachment before refreshing", async () => {
    const ready = deferred<void>();
    mockQueueEvents.mockImplementation((name, opts) => {
      const client = createEvents(name, opts);
      client.waitUntilReady.mockReturnValue(ready.promise);
      return client;
    });
    const hub = getQueueEventHub();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    const initial = clients();
    expect(initial).toHaveLength(4);
    const refreshing = invalidateQueueEventHub();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(mockGetQueues).toHaveBeenCalledTimes(1);
    for (const client of initial) expect(client.close).not.toHaveBeenCalled();

    ready.resolve(undefined);
    await hub.ready();
    await refreshing;
    expect(mockQueueEvents).toHaveBeenCalledTimes(8);
    for (const client of initial) expect(client.close).toHaveBeenCalledTimes(1);
    expectOneSourcePerQueue();
  });

  it("does not create an unused hub during invalidation", async () => {
    await invalidateQueueEventHub();
    expect(mockGetQueues).not.toHaveBeenCalled();
    expect(mockQueueEvents).not.toHaveBeenCalled();
  });
});
