import { resolveSpendingLimit } from "./spending-limit";

const custom = (over: Partial<Parameters<typeof resolveSpendingLimit>[0] & object> = {}) => ({
  spendingLimitSource: "custom",
  enableSpendingLimit: true,
  monthlySpendingLimitCents: 5000,
  hardStopOnLimit: false,
  ...over,
});

describe("resolveSpendingLimit", () => {
  it.each([
    ["plus", 7000],
    ["pro", 30000],
  ])("%s without settings gets a hard-stop cap at the plan default", (plan, cents) => {
    expect(resolveSpendingLimit(undefined, plan, cents)).toEqual({
      source: "plan_default", enabled: true, limitCents: cents, hardStop: true, planDefaultCents: cents,
    });
  });

  it("plan_default rows ignore stale stored fields", () => {
    const row = custom({ spendingLimitSource: "plan_default", enableSpendingLimit: false });
    expect(resolveSpendingLimit(row, "plus", 7000)).toMatchObject({ enabled: true, limitCents: 7000, hardStop: true });
  });

  it("custom caps win, including a disabled one", () => {
    expect(resolveSpendingLimit(custom(), "pro", 30000)).toEqual({
      source: "custom", enabled: true, limitCents: 5000, hardStop: false, planDefaultCents: 30000,
    });
    expect(resolveSpendingLimit(custom({ enableSpendingLimit: false }), "plus", 7000).enabled).toBe(false);
  });

  it.each([
    ["unlimited", 7000],
    [null, 7000],
    ["plus", null],
    ["plus", 0],
  ])("plan %s with default %s has no cap", (plan, cents) => {
    expect(resolveSpendingLimit(undefined, plan, cents)).toMatchObject({ enabled: false, limitCents: null, hardStop: false });
  });
});
