import { countSeatsInUse, effectiveMemberLimit, EXTRA_MEMBER_PRICE_CENTS, PRO_INCLUDED_MEMBERS } from "./member-seats";

describe("effectiveMemberLimit", () => {
  const pro = { plan: "pro", maxTeamMembers: 25 };
  it.each([
    [pro, null, 25],
    [pro, undefined, 25],
    [pro, 0, 25],
    [pro, 10, 25], // seats below the included members never lower the limit
    [pro, 40, 40],
    [{ plan: "plus", maxTeamMembers: 5 }, 40, 5], // seats are Pro-only
    [{ plan: "unlimited", maxTeamMembers: 999 }, 1, 999],
  ])("%j with %s seats allows %s members", (plan, units, expected) => {
    expect(effectiveMemberLimit(plan, units)).toBe(expected);
  });

  it("reads the catalog price and included members", () => {
    expect(EXTRA_MEMBER_PRICE_CENTS).toBe(800);
    expect(PRO_INCLUDED_MEMBERS).toBe(25);
  });
});

describe("countSeatsInUse", () => {
  it("adds members and unexpired pending invitations", async () => {
    const counts = [[{ count: "4" }], [{ count: 2 }]];
    const executor = { select: () => ({ from: () => ({ where: async () => counts.shift() }) }) };
    expect(await countSeatsInUse(executor as never, "org-1")).toBe(6);
  });

  it("treats missing rows as zero", async () => {
    const executor = { select: () => ({ from: () => ({ where: async () => [] }) }) };
    expect(await countSeatsInUse(executor as never, "org-1")).toBe(0);
  });
});
