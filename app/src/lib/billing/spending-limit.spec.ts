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

  it("plan_default rows without a stored cap follow the plan", () => {
    const row = custom({ spendingLimitSource: "plan_default", enableSpendingLimit: false, monthlySpendingLimitCents: null, hardStopOnLimit: true });
    expect(resolveSpendingLimit(row, "plus", 7000)).toMatchObject({ source: "plan_default", enabled: true, limitCents: 7000, hardStop: true });
  });

  it("a cap saved by an older app version without the marker stays the owner's cap", () => {
    const row = custom({ spendingLimitSource: "plan_default", monthlySpendingLimitCents: 1000 });
    expect(resolveSpendingLimit(row, "plus", 7000)).toMatchObject({ source: "custom", limitCents: 1000 });
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

describe("worker copy", () => {
  it("keeps the same rules as the worker", () => {
    const { readFileSync } = jest.requireActual<typeof import("node:fs")>("node:fs");
    const { join } = jest.requireActual<typeof import("node:path")>("node:path");
    // Formatting differs between packages (prettier); compare tokens only.
    const body = (file: string) => readFileSync(file, "utf8").split("\n").slice(1).join("\n")
      .replaceAll("'", '"').replace(/\s+/g, "").replace(/,([)\]}])/g, "$1");
    expect(body(join(__dirname, "../../../../worker/src/execution/services/spending-limit.ts")))
      .toBe(body(join(__dirname, "spending-limit.ts")));
  });
});
