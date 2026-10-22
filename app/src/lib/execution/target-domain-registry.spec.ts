import { db } from "@/utils/db";
import { verifyTargetDns, TargetDnsUnavailableError } from "./target-domain";
import {
  TargetDomainError,
  registerTargetDomain,
  requireVerifiedTarget,
  verifyRegisteredTarget,
} from "./target-domain-registry";

jest.mock("./target-domain", () => ({
  ...jest.requireActual("./target-domain"),
  verifyTargetDns: jest.fn(),
}));
jest.mock("@/utils/db", () => ({
  db: {
    transaction: jest.fn(),
    update: jest.fn(),
    query: { executionTargetDomains: { findFirst: jest.fn() } },
  },
}));

/** A chainable, awaitable stand-in for a drizzle query builder. */
function chain<T>(result: T) {
  const builder: Record<string, unknown> = {};
  for (const method of ["from", "where", "for", "set", "values", "returning"]) builder[method] = jest.fn(() => builder);
  builder.then = (resolve: (value: T) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

const findFirst = db.query.executionTargetDomains.findFirst as jest.Mock;
const row = { id: "11111111-1111-4111-8111-111111111111", organizationId: "org", hostname: "target.example.com", verificationToken: "proof", verifiedAt: null, verifiedUntil: null };

function useTransaction(tx: Record<string, unknown>) {
  (db.transaction as jest.Mock).mockImplementation(async (callback: (tx: unknown) => unknown) => callback(tx));
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe("registerTargetDomain", () => {
  it("rejects values that are not exact public hostnames before touching the database", async () => {
    await expect(registerTargetDomain("org", "http://10.0.0.1")).rejects.toMatchObject({ status: 400 });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("returns 404 when the organization does not exist", async () => {
    useTransaction({ select: jest.fn(() => chain([])) });
    await expect(registerTargetDomain("org", "Target.Example.com")).rejects.toMatchObject({ status: 404 });
  });

  it("is idempotent for an already registered hostname", async () => {
    const select = jest.fn(() => chain([{ id: "org" }]));
    const insert = jest.fn();
    useTransaction({ select, insert, query: { executionTargetDomains: { findFirst: jest.fn().mockResolvedValue(row) } } });
    await expect(registerTargetDomain("org", "target.example.com")).resolves.toBe(row);
    expect(insert).not.toHaveBeenCalled();
  });

  it("enforces the per-organization registration limit", async () => {
    const select = jest.fn().mockReturnValueOnce(chain([{ id: "org" }])).mockReturnValueOnce(chain([{ value: 20 }]));
    useTransaction({ select, insert: jest.fn(), query: { executionTargetDomains: { findFirst: jest.fn().mockResolvedValue(undefined) } } });
    await expect(registerTargetDomain("org", "target.example.com")).rejects.toMatchObject({ status: 409 });
  });

  it("inserts a normalized hostname with a fresh random verification token", async () => {
    const insertBuilder = chain([row]);
    const insert = jest.fn(() => insertBuilder);
    const select = jest.fn().mockReturnValueOnce(chain([{ id: "org" }])).mockReturnValueOnce(chain([{ value: 19 }]));
    useTransaction({ select, insert, query: { executionTargetDomains: { findFirst: jest.fn().mockResolvedValue(undefined) } } });
    await expect(registerTargetDomain("org", "TARGET.example.com")).resolves.toBe(row);
    const values = (insertBuilder.values as jest.Mock).mock.calls[0][0];
    expect(values).toMatchObject({ organizationId: "org", hostname: "target.example.com" });
    expect(values.verificationToken).toMatch(/^[0-9a-f]{48}$/);
  });
});

describe("verifyRegisteredTarget", () => {
  it("returns 404 for a target the organization does not own", async () => {
    findFirst.mockResolvedValue(undefined);
    await expect(verifyRegisteredTarget("org", row.id)).rejects.toMatchObject({ status: 404 });
    expect(verifyTargetDns).not.toHaveBeenCalled();
  });

  it("clears verification and reports a 400 when DNS proof fails", async () => {
    findFirst.mockResolvedValue(row);
    jest.mocked(verifyTargetDns).mockRejectedValue(new Error("no txt record"));
    const update = chain(undefined);
    (db.update as jest.Mock).mockReturnValue(update);
    await expect(verifyRegisteredTarget("org", row.id)).rejects.toMatchObject({ status: 400 });
    expect(update.set).toHaveBeenCalledWith({ verifiedAt: null, verifiedUntil: null });
  });

  it("keeps stored verification and reports 503 when the resolver is unavailable", async () => {
    findFirst.mockResolvedValue({ ...row, verifiedAt: new Date() });
    jest.mocked(verifyTargetDns).mockRejectedValue(new TargetDnsUnavailableError());
    await expect(verifyRegisteredTarget("org", row.id)).rejects.toMatchObject({ status: 503 });
    expect(db.update).not.toHaveBeenCalled();
  });

  it("marks the target verified for 24 hours", async () => {
    findFirst.mockResolvedValue(row);
    jest.mocked(verifyTargetDns).mockResolvedValue(undefined as never);
    const verified = { ...row, verifiedAt: new Date() };
    const update = chain([verified]);
    (db.update as jest.Mock).mockReturnValue(update);
    await expect(verifyRegisteredTarget("org", row.id)).resolves.toBe(verified);
    const { verifiedAt, verifiedUntil } = (update.set as jest.Mock).mock.calls[0][0];
    expect(verifiedUntil.getTime() - verifiedAt.getTime()).toBe(86400000);
  });

  it("asks the caller to retry when the row changed during verification", async () => {
    findFirst.mockResolvedValue(row);
    jest.mocked(verifyTargetDns).mockResolvedValue(undefined as never);
    (db.update as jest.Mock).mockReturnValue(chain([]));
    await expect(verifyRegisteredTarget("org", row.id)).rejects.toMatchObject({ status: 409 });
  });
});

describe("requireVerifiedTarget", () => {
  it("refuses hosts that were never verified without running DNS checks", async () => {
    findFirst.mockResolvedValue(row);
    await expect(requireVerifiedTarget("org", "target.example.com")).rejects.toBeInstanceOf(TargetDomainError);
    expect(verifyTargetDns).not.toHaveBeenCalled();
  });

  it("refuses unknown hosts", async () => {
    findFirst.mockResolvedValue(undefined);
    await expect(requireVerifiedTarget("org", "target.example.com")).rejects.toMatchObject({ status: 400 });
  });

  it("re-verifies DNS at use time for previously verified hosts", async () => {
    const verifiedRow = { ...row, verifiedAt: new Date() };
    findFirst.mockResolvedValue(verifiedRow);
    jest.mocked(verifyTargetDns).mockResolvedValue(undefined as never);
    (db.update as jest.Mock).mockReturnValue(chain([verifiedRow]));
    await expect(requireVerifiedTarget("org", "target.example.com")).resolves.toBe(verifiedRow);
    expect(verifyTargetDns).toHaveBeenCalledWith("target.example.com", "proof");
  });
});
