/** @jest-environment node */

jest.mock("@bull-board/api", () => ({ createBullBoard: jest.fn() }));
jest.mock("@bull-board/api/bullMQAdapter", () => ({
  BullMQAdapter: jest.fn((queue) => ({ queue })),
}));
jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn() }));
jest.mock("@/lib/rbac/permissions", () => ({
  Role: { SUPER_ADMIN: "super_admin" },
}));
jest.mock("@/lib/location-registry", () => ({
  getAllEnabledLocationCodes: jest.fn(),
}));
jest.mock("@/lib/queue", () => ({
  getQueues: jest.fn(),
  getQueueLocationSignature: jest.fn(),
  invalidateQueueMaps: jest.fn(),
  locationCodesSignature: (codes: string[]) => [...codes].sort().join("\0"),
}));

import { createBullBoard } from "@bull-board/api";
import type { BullBoardQueues, BullBoardRequest } from "@bull-board/api/typings/app";
import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getAllEnabledLocationCodes } from "@/lib/location-registry";
import {
  getQueues,
  getQueueLocationSignature,
  invalidateQueueMaps,
} from "@/lib/queue";
import { getBullBoardState, invalidateBullBoard } from "@/lib/bull-board/state";
import type { NextBullBoardAdapter } from "@/lib/bull-board/next-adapter";
import { GET } from "./route";

const mockCreateBullBoard = createBullBoard as jest.Mock;
const mockGetCurrentUser = getCurrentUser as jest.Mock;
const mockGetEnabledCodes = getAllEnabledLocationCodes as jest.Mock;
const mockGetQueues = getQueues as jest.Mock;
const mockGetSignature = getQueueLocationSignature as jest.Mock;
const mockInvalidateQueues = invalidateQueueMaps as jest.Mock;
const boardScope = globalThis as typeof globalThis & {
  __SUPERCHECK_BULL_BOARD_STATE__?: unknown;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function queuesFor(codes: string[]) {
  const queue = (name: string) => ({ name });
  return {
    playwrightQueues: { global: queue("playwright") },
    k6Queues: Object.fromEntries(["global", ...codes].map((code) => [code, queue(`k6-${code}`)])),
    monitorExecutionQueue: Object.fromEntries(codes.map((code) => [code, queue(`monitor-${code}`)])),
    jobSchedulerQueue: queue("job-scheduler"),
    k6JobSchedulerQueue: queue("k6-job-scheduler"),
    monitorSchedulerQueue: queue("monitor-scheduler"),
    emailTemplateQueue: queue("email-template"),
    dataLifecycleCleanupQueue: queue("data-lifecycle"),
  };
}

function poll(handler = GET) {
  return handler(
    new NextRequest("http://localhost/api/admin/queues/api/queues"),
    { params: Promise.resolve({ path: ["api", "queues"] }) },
  );
}

describe("Bull Board replica state", () => {
  let enabledCodes: string[];
  let queueSignature: string;

  beforeEach(() => {
    delete boardScope.__SUPERCHECK_BULL_BOARD_STATE__;
    jest.resetAllMocks();
    enabledCodes = ["eu"];
    queueSignature = "eu";
    mockGetCurrentUser.mockResolvedValue({ id: "admin", role: "super_admin" });
    mockGetEnabledCodes.mockImplementation(async () => enabledCodes);
    mockGetSignature.mockImplementation(() => queueSignature);
    mockGetQueues.mockImplementation(async () => queuesFor(enabledCodes));
    mockInvalidateQueues.mockImplementation(async () => {
      queueSignature = [...enabledCodes].sort().join("\0");
    });
    const { BullMQAdapter } = jest.requireMock("@bull-board/api/bullMQAdapter");
    BullMQAdapter.mockImplementation((queue: { name: string }) => ({ queue }));
    mockCreateBullBoard.mockImplementation((options: {
      queues: Array<{ queue: { name: string } }>;
      serverAdapter: NextBullBoardAdapter;
    }) => {
      options.serverAdapter
        .setQueues(Object.fromEntries(options.queues.map((adapter) => [adapter.queue.name, adapter])) as unknown as BullBoardQueues)
        .setViewsPath("/unused/views")
        .setStaticPath("/static", "/unused/assets")
        .setEntryRoute({ method: "get", route: "/", handler: () => ({ name: "index", params: {} }) })
        .setApiRoutes([{
          method: "get",
          route: "/api/queues",
          handler: async ({ queues }: BullBoardRequest) => ({ status: 200, body: { queues: Object.keys(queues) } }),
        }])
        .setErrorHandler(() => ({ status: 500, body: { error: "board error" } }));
    });
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    delete boardScope.__SUPERCHECK_BULL_BOARD_STATE__;
    jest.restoreAllMocks();
  });

  it("shares the cached board with an isolated route bundle", async () => {
    const first = await poll();
    const payload = await first.json();
    const cached = getBullBoardState().cachedState;
    let isolatedGet!: typeof GET;
    jest.isolateModules(() => {
      isolatedGet = require("./route").GET;
      const session = jest.requireMock("@/lib/session");
      session.getCurrentUser.mockResolvedValue({ role: "super_admin" });
      jest.requireMock("@/lib/location-registry").getAllEnabledLocationCodes.mockResolvedValue(["eu"]);
      jest.requireMock("@/lib/queue").getQueueLocationSignature.mockReturnValue("eu");
      expect(require("@/lib/bull-board/state").getBullBoardState().cachedState).toBe(cached);
    });

    const second = await poll(isolatedGet);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(payload);
    expect(mockCreateBullBoard).toHaveBeenCalledTimes(1);
  });

  it("initializes once when cold polls finish their location read concurrently", async () => {
    const locations = deferred<string[]>();
    const queues = deferred<ReturnType<typeof queuesFor>>();
    mockGetEnabledCodes.mockReturnValue(locations.promise);
    mockGetQueues.mockReturnValue(queues.promise);
    const requests = [poll(), poll(), poll()];
    locations.resolve(["eu"]);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(mockGetQueues).toHaveBeenCalledTimes(1);
    expect(mockCreateBullBoard).not.toHaveBeenCalled();

    queues.resolve(queuesFor(["eu"]));
    const responses = await Promise.all(requests);
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    expect(mockCreateBullBoard).toHaveBeenCalledTimes(1);
    expect(getBullBoardState().initializationPromise).toBeNull();
  });

  it("rebuilds from a changed enabled signature without a remote notification", async () => {
    expect((await poll()).status).toBe(200);
    const firstAdapter = mockCreateBullBoard.mock.calls[0][0].serverAdapter;
    enabledCodes = ["us"];

    const response = await poll();
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.queues).toEqual(expect.arrayContaining(["k6-us", "monitor-us"]));
    expect(payload.queues).not.toContain("k6-eu");
    expect(payload.queues).not.toContain("monitor-eu");
    expect(mockInvalidateQueues).toHaveBeenCalledWith({ publish: false });
    expect(mockCreateBullBoard).toHaveBeenCalledTimes(2);
    expect(mockCreateBullBoard.mock.calls[1][0].serverAdapter).not.toBe(firstAdapter);
    expect(getBullBoardState().locationSignature).toBe("us");
  });

  it("preserves the pending initialization when locations invalidate the board", async () => {
    const queues = deferred<ReturnType<typeof queuesFor>>();
    mockGetQueues.mockReturnValue(queues.promise);
    const first = poll();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    const pending = getBullBoardState().initializationPromise;
    expect(pending).not.toBeNull();

    enabledCodes = ["us"];
    queueSignature = "us";
    invalidateBullBoard();
    expect(getBullBoardState().initializationPromise).toBe(pending);
    const second = poll();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(mockGetQueues).toHaveBeenCalledTimes(1);

    queues.resolve(queuesFor(["us"]));
    const responses = await Promise.all([first, second]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    for (const response of responses) {
      expect((await response.json()).queues).toContain("k6-us");
    }
    expect(mockCreateBullBoard).toHaveBeenCalledTimes(1);
    expect(getBullBoardState().locationSignature).toBe("us");
  });

  it("serves the cached board when the location database is unavailable", async () => {
    const first = await poll();
    const payload = await first.json();
    mockGetEnabledCodes.mockRejectedValue(new Error("database unavailable"));

    const response = await poll();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(payload);
    expect(mockCreateBullBoard).toHaveBeenCalledTimes(1);
    expect(mockGetQueues).toHaveBeenCalledTimes(1);
    expect(mockInvalidateQueues).not.toHaveBeenCalled();
  });

  it.each([null, { role: "org_owner" }])("does not initialize for an unauthorized user: %j", async (user) => {
    mockGetCurrentUser.mockResolvedValue(user);
    expect((await poll()).status).toBe(401);
    expect(mockGetEnabledCodes).not.toHaveBeenCalled();
    expect(mockGetQueues).not.toHaveBeenCalled();
    expect(mockCreateBullBoard).not.toHaveBeenCalled();
    expect(boardScope.__SUPERCHECK_BULL_BOARD_STATE__).toBeUndefined();
  });
});
