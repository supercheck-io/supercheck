/** @jest-environment node */
const tx = { update: jest.fn(), delete: jest.fn() };
const set = jest.fn();
const where = jest.fn().mockResolvedValue(undefined);
jest.mock("@/utils/db", () => ({ db: { transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } }));
jest.mock("drizzle-orm", () => ({ ...jest.requireActual("drizzle-orm"), eq: (column: unknown, value: unknown) => ({ column, value }) }));

import { oauthAccessToken, oauthRefreshToken, session, user } from "@/db/schema";
import { suspendAccount } from "./suspend-account";

describe("suspendAccount", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    set.mockReturnValue({ where });
    tx.update.mockReturnValue({ set });
    tx.delete.mockReturnValue({ where });
  });

  it("bans the user, expires every session and deletes OAuth tokens in one transaction", async () => {
    const until = new Date("2026-11-01T00:00:00Z");
    await suspendAccount("user-1", "abuse", until);
    expect(tx.update).toHaveBeenCalledWith(user);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ banned: true, banReason: "abuse", banExpires: until }));
    expect(tx.update).toHaveBeenCalledWith(session);
    expect(set).toHaveBeenCalledWith({ expiresAt: new Date(0) });
    expect(tx.delete).toHaveBeenCalledWith(oauthAccessToken);
    expect(tx.delete).toHaveBeenCalledWith(oauthRefreshToken);
    expect(where).toHaveBeenCalledWith({ column: session.userId, value: "user-1" });
    expect(where).toHaveBeenCalledWith({ column: oauthRefreshToken.userId, value: "user-1" });
  });
});
