import {
  insertWithinPlanLimit,
  PlanLimitBusyError,
  withPlanLimitLock,
} from "./plan-limit-lock";

const mockExecute = jest.fn();
const mockTransaction = jest.fn();
const mockTx = { execute: mockExecute };

jest.mock("@/utils/db", () => ({
  db: {
    transaction: (cb: (tx: unknown) => Promise<unknown>) =>
      mockTransaction(cb),
  },
}));

describe("withPlanLimitLock", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecute.mockResolvedValue(undefined);
    mockTransaction.mockImplementation((cb) => cb(mockTx));
  });

  it("takes the advisory lock before running the callback, passing tx", async () => {
    const order: string[] = [];
    mockExecute.mockImplementation(async () => {
      order.push("lock");
    });
    const fn = jest.fn(async () => {
      order.push("fn");
    });

    await withPlanLimitLock("org-1", "monitors", fn);

    // read lock_timeout, set it, take the lock, restore it, then run the callback
    expect(order).toEqual(["lock", "lock", "lock", "lock", "fn"]);
    expect(mockExecute).toHaveBeenCalledTimes(4);
    expect(fn).toHaveBeenCalledWith(mockTx);
  });

  it("maps a lock_timeout (55P03) failure to PlanLimitBusyError", async () => {
    mockExecute
      .mockResolvedValueOnce([{ value: "0" }])
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error("timeout"), { code: "55P03" }));
    const fn = jest.fn();
    await expect(withPlanLimitLock("org-1", "monitors", fn)).rejects.toBeInstanceOf(
      PlanLimitBusyError
    );
    expect(fn).not.toHaveBeenCalled();
  });

  it("finds the 55P03 code on error.cause too", async () => {
    mockExecute
      .mockResolvedValueOnce([{ value: "0" }])
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        new Error("wrapped", { cause: { code: "55P03" } })
      );
    await expect(
      withPlanLimitLock("org-1", "monitors", jest.fn())
    ).rejects.toBeInstanceOf(PlanLimitBusyError);
  });

  it("propagates callback errors so the transaction rolls back", async () => {
    await expect(
      withPlanLimitLock("org-1", "projects", async () => {
        throw new Error("insert failed");
      })
    ).rejects.toThrow("insert failed");
  });

  it("restores the session's previous lock_timeout for the callback", async () => {
    mockExecute.mockResolvedValueOnce([{ value: "30s" }]);
    await withPlanLimitLock("org-1", "monitors", async () => undefined);
    const restore = JSON.stringify(mockExecute.mock.calls[3][0]);
    expect(restore).toContain("30s");
  });

  it("does not report busy when the callback itself raises 55P03", async () => {
    await expect(
      withPlanLimitLock("org-1", "monitors", async () => {
        throw Object.assign(new Error("row lock"), { code: "55P03" });
      })
    ).rejects.not.toBeInstanceOf(PlanLimitBusyError);
  });

  it("does not run the callback when acquiring the lock fails", async () => {
    mockExecute.mockRejectedValue(new Error("lock failed"));
    const fn = jest.fn();
    await expect(withPlanLimitLock("org-1", "monitors", fn)).rejects.toThrow(
      "lock failed"
    );
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("insertWithinPlanLimit", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecute.mockResolvedValue(undefined);
    mockTransaction.mockImplementation((cb) => cb(mockTx));
  });

  it("returns the plan denial without locking or inserting", async () => {
    const denied = { allowed: false, error: "Subscription required" };
    const insert = jest.fn();
    const result = await insertWithinPlanLimit({
      organizationId: "org-1",
      resource: "monitors",
      check: jest.fn().mockResolvedValue(denied),
      countRows: jest.fn(),
      insert,
    });
    expect(result).toEqual({ ok: false, check: denied });
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("skips the lock when no limit applies", async () => {
    const insert = jest.fn().mockResolvedValue({ id: "m1" });
    const result = await insertWithinPlanLimit({
      organizationId: "org-1",
      resource: "monitors",
      check: jest.fn().mockResolvedValue({ allowed: true }),
      countRows: jest.fn(),
      insert,
    });
    expect(result).toEqual({ ok: true, row: { id: "m1" } });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("inserts on the transaction when under the limit", async () => {
    const insert = jest.fn().mockResolvedValue({ id: "m1" });
    const countRows = jest.fn().mockResolvedValue(2);
    const result = await insertWithinPlanLimit({
      organizationId: "org-1",
      resource: "monitors",
      check: jest.fn().mockResolvedValue({ allowed: true, limit: 3 }),
      countRows,
      insert,
    });
    expect(result).toEqual({ ok: true, row: { id: "m1" } });
    expect(countRows).toHaveBeenCalledWith(mockTx);
    expect(insert).toHaveBeenCalledWith(mockTx);
  });

  it("returns busy when the lock times out", async () => {
    mockExecute
      .mockResolvedValueOnce([{ value: "0" }])
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error("t"), { code: "55P03" }));
    const insert = jest.fn();
    const result = await insertWithinPlanLimit({
      organizationId: "org-1",
      resource: "monitors",
      check: jest.fn().mockResolvedValue({ allowed: true, limit: 3 }),
      countRows: jest.fn(),
      insert,
    });
    expect(result).toEqual({ ok: false, busy: true });
    expect(insert).not.toHaveBeenCalled();
  });

  it("denies with the real count and never inserts when at the limit", async () => {
    const denied = { allowed: false, error: "Monitor limit reached", limit: 3 };
    const check = jest
      .fn()
      .mockResolvedValueOnce({ allowed: true, limit: 3 })
      .mockResolvedValueOnce(denied);
    const insert = jest.fn();
    const result = await insertWithinPlanLimit({
      organizationId: "org-1",
      resource: "monitors",
      check,
      countRows: jest.fn().mockResolvedValue(3),
      insert,
    });
    expect(result).toEqual({ ok: false, check: denied });
    expect(check).toHaveBeenLastCalledWith("org-1", 3);
    expect(insert).not.toHaveBeenCalled();
  });
});
