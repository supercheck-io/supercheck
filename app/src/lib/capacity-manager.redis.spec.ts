/** @jest-environment node */
import { randomUUID } from "node:crypto";
import Redis from "ioredis";
jest.mock("@/utils/db", () => ({ db: { update: jest.fn() } }));
jest.mock("./middleware/plan-enforcement", () => ({
  checkCapacityLimits: async () => ({ runningCapacity: 1, queuedCapacity: 10 }),
}));
jest.mock("./execution/execution-policy", () => ({
  getExecutionPolicy: jest.fn(),
  assertExecutionWorkload: jest.fn(),
  ExecutionWorkloadError: class extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  },
}));
jest.mock("./queue", () => ({ getQueues: jest.fn() }));
import { db } from "@/utils/db";
import {
  CapacityManager,
  setCapacityLogger,
  type QueuedJobData,
} from "./capacity-manager";
import {
  getExecutionPolicy,
  assertExecutionWorkload,
  ExecutionWorkloadError,
} from "./execution/execution-policy";
import { getQueues } from "./queue";

const suite = process.env.TEST_REDIS_URL ? describe : describe.skip;
suite("promotion ownership (real Redis)", () => {
  let redis: Redis;
  let manager: CapacityManager;
  let queued: QueuedJobData;
  let keys: string[];
  const add = jest.fn();
  const where = jest.fn();
  beforeAll(async () => {
    redis = new Redis(process.env.TEST_REDIS_URL!, {
      lazyConnect: true,
      maxRetriesPerRequest: 0,
    });
    await redis.connect();
    setCapacityLogger({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    });
  });
  afterAll(async () => {
    await redis?.quit();
  });
  beforeEach(async () => {
    jest.clearAllMocks();
    queued = {
      organizationId: randomUUID(),
      projectId: randomUUID(),
      runId: randomUUID(),
      jobId: randomUUID(),
      type: "playwright",
      taskData: { code: "test()" },
      queuedAt: 1234,
    };
    keys = [
      `capacity:running:${queued.organizationId}`,
      `capacity:queued:${queued.organizationId}`,
      `capacity:job:${queued.jobId}`,
      `capacity:org:${queued.jobId}`,
      `capacity:released:${queued.jobId}`,
    ];
    await redis.zadd(keys[1], queued.queuedAt, queued.jobId);
    await redis.set(keys[2], JSON.stringify(queued));
    await redis.set(keys[3], queued.organizationId);
    manager = new CapacityManager(redis);
    jest
      .mocked(getExecutionPolicy)
      .mockResolvedValue({
        tier: "paid",
        priority: 0,
        runningCapacity: 1,
        queuedCapacity: 10,
      });
    jest.mocked(assertExecutionWorkload).mockResolvedValue(undefined);
    add.mockResolvedValue({});
    jest
      .mocked(getQueues)
      .mockResolvedValue({ playwrightQueues: { global: { add } } } as never);
    where.mockResolvedValue(undefined);
    jest.mocked(db.update).mockReturnValue({ set: () => ({ where }) } as never);
  });
  afterEach(async () => {
    await redis.del(...keys);
  });

  it("keeps the payload and queue position after a temporary policy outage, then promotes once", async () => {
    jest
      .mocked(getExecutionPolicy)
      .mockRejectedValueOnce(new Error("policy database unavailable"));
    expect(
      await manager["promoteJob"](queued.organizationId, queued.jobId),
    ).toBe(false);
    expect(await redis.zscore(keys[1], queued.jobId)).toBe(
      String(queued.queuedAt),
    );
    expect(await redis.get(keys[2])).toBe(JSON.stringify(queued));
    expect(await redis.get(keys[0])).toBeNull();
    expect(
      await manager["promoteJob"](queued.organizationId, queued.jobId),
    ).toBe(true);
    expect(add).toHaveBeenCalledTimes(1);
    expect(await redis.get(keys[0])).toBe("1");
    expect(await redis.zscore(keys[1], queued.jobId)).toBeNull();
  });

  it("releases a newly promoted slot even if a prior promotion left its release marker", async () => {
    await redis.set(keys[4], "1");
    expect(
      await manager["promoteJob"](queued.organizationId, queued.jobId),
    ).toBe(true);
    expect(await redis.get(keys[0])).toBe("1");
    await manager.releaseRunningSlot(queued.organizationId, queued.jobId);
    await manager.releaseRunningSlot(queued.organizationId, queued.jobId);
    expect(await redis.get(keys[0])).toBeNull();
  });

  it("a losing rejector cannot fail or delete the winning promoter's run", async () => {
    let entered!: () => void;
    let release!: () => void;
    const enteredQueue = new Promise<void>((r) => {
      entered = r;
    });
    const gate = new Promise<void>((r) => {
      release = r;
    });
    add.mockImplementation(async () => {
      entered();
      await gate;
      return {};
    });
    const winner = manager["promoteJob"](queued.organizationId, queued.jobId);
    await enteredQueue;
    try {
      jest
        .mocked(getExecutionPolicy)
        .mockRejectedValueOnce(new ExecutionWorkloadError("expired", 402));
      const loser = new CapacityManager(redis);
      expect(
        await loser["promoteJob"](queued.organizationId, queued.jobId),
      ).toBe(false);
      expect(db.update).not.toHaveBeenCalled();
      expect(await redis.get(keys[0])).toBe("1");
      expect(await redis.get(keys[2])).toBe(JSON.stringify(queued));
    } finally {
      release();
      await winner;
    }
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("restores the original queue position and payload when terminal persistence fails", async () => {
    jest
      .mocked(getExecutionPolicy)
      .mockRejectedValueOnce(new ExecutionWorkloadError("expired", 402));
    where.mockRejectedValueOnce(new Error("database unavailable"));
    expect(
      await manager["promoteJob"](queued.organizationId, queued.jobId),
    ).toBe(false);
    expect(await redis.zscore(keys[1], queued.jobId)).toBe(
      String(queued.queuedAt),
    );
    expect(await redis.get(keys[2])).toBe(JSON.stringify(queued));
    expect(await redis.get(keys[0])).toBeNull();
  });
});
