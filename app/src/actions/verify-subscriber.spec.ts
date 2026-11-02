jest.mock("@/utils/db", () => ({
  db: {
    query: {
      statusPageSubscribers: { findFirst: jest.fn() },
      statusPages: { findFirst: jest.fn() },
    },
    transaction: jest.fn(),
    update: jest.fn(),
    select: jest.fn(),
  },
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/middleware/plan-enforcement", () => ({
  checkSubscriberLimit: jest.fn(),
}));

import { db } from "@/utils/db";
import { checkSubscriberLimit } from "@/lib/middleware/plan-enforcement";
import { verifySubscriber } from "./verify-subscriber";

const token = "a".repeat(64);
const mockDb = db as unknown as {
  query: {
    statusPageSubscribers: { findFirst: jest.Mock };
    statusPages: { findFirst: jest.Mock };
  };
  transaction: jest.Mock;
  update: jest.Mock;
  select: jest.Mock;
};
const limit = checkSubscriberLimit as jest.Mock;

const updateWhere = jest.fn().mockResolvedValue(undefined);

function useTransaction(execute: jest.Mock) {
  mockDb.transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
    cb({ execute, select: mockDb.select, update: mockDb.update })
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  mockDb.query.statusPageSubscribers.findFirst.mockResolvedValue({
    id: "sub-1",
    statusPageId: "page-1",
    verifiedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  mockDb.query.statusPages.findFirst.mockResolvedValue({
    organizationId: "org-1",
    language: "en",
  });
  mockDb.select.mockReturnValue({
    from: () => ({ where: () => Promise.resolve([{ value: 1 }]) }),
  });
  mockDb.update.mockReturnValue({ set: () => ({ where: updateWhere }) });
  useTransaction(jest.fn().mockResolvedValue([{ value: "0" }]));
});

afterEach(() => jest.restoreAllMocks());

describe("verifySubscriber", () => {
  it("rejects malformed tokens without touching the database", async () => {
    const result = await verifySubscriber("short");
    expect(result.success).toBe(false);
    expect(mockDb.query.statusPageSubscribers.findFirst).not.toHaveBeenCalled();
  });

  it("activates the subscriber when under the limit", async () => {
    limit.mockResolvedValue({ allowed: true, limit: 5 });
    const result = await verifySubscriber(token);
    expect(result.success).toBe(true);
    expect(updateWhere).toHaveBeenCalledTimes(1);
  });

  it("does not activate when the status page is at its limit", async () => {
    limit
      .mockResolvedValueOnce({ allowed: true, limit: 1 })
      .mockResolvedValueOnce({ allowed: false, error: "Subscriber limit reached." });
    const result = await verifySubscriber(token);
    expect(result).toEqual({ success: false, message: "Subscriber limit reached." });
    expect(updateWhere).not.toHaveBeenCalled();
  });

  it("asks the caller to retry when the lock times out", async () => {
    limit.mockResolvedValue({ allowed: true, limit: 5 });
    useTransaction(
      jest
        .fn()
        .mockResolvedValueOnce([{ value: "0" }])
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(Object.assign(new Error("t"), { code: "55P03" }))
    );
    const result = await verifySubscriber(token);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/retry/i);
    expect(updateWhere).not.toHaveBeenCalled();
  });

  it("activates without a limit check when the page has no organization", async () => {
    mockDb.query.statusPages.findFirst.mockResolvedValue({ organizationId: null, language: "en" });
    const result = await verifySubscriber(token);
    expect(result.success).toBe(true);
    expect(limit).not.toHaveBeenCalled();
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });
});

describe("verification token storage", () => {
  it("looks up by hash first, then by legacy plaintext and migrates it", async () => {
    const findFirst = mockDb.query.statusPageSubscribers.findFirst;
    const row = { id: "sub-1", statusPageId: "page-1", verifiedAt: new Date(), createdAt: new Date(), updatedAt: new Date() };
    findFirst.mockReset();
    findFirst.mockResolvedValueOnce(undefined).mockResolvedValueOnce(row);
    mockDb.query.statusPages.findFirst.mockResolvedValue({ language: "en" });
    const set = jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) });
    mockDb.update.mockReturnValue({ set });
    set.mockReturnValue({ where: jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue([{ id: "sub-1" }]) }) });

    const result = await verifySubscriber(token);

    expect(result.success).toBe(true);
    expect(findFirst).toHaveBeenCalledTimes(2);
    expect(set).toHaveBeenCalledWith({
      verificationTokenHash: require("node:crypto").createHash("sha256").update(token).digest("hex"),
      verificationToken: null,
    });
  });
});

describe("superseded legacy token", () => {
  it("rejects the link when a renewal replaced the plaintext token after the read", async () => {
    const findFirst = mockDb.query.statusPageSubscribers.findFirst;
    findFirst.mockReset();
    findFirst.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ id: "sub-1", statusPageId: "page-1", verifiedAt: null, updatedAt: new Date(), createdAt: new Date() });
    mockDb.update.mockReturnValue({ set: () => ({ where: () => ({ returning: jest.fn().mockResolvedValue([]) }) }) });
    const result = await verifySubscriber(token);
    expect(result.success).toBe(false);
  });
});
