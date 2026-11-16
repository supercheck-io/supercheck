import { isSetupStepKey, isUserPersona, sidebarLayout, stepOrder } from "./persona";

describe("stepOrder (spec 4.2)", () => {
  it("uses the default order without a persona and ends with review", () => {
    expect(stepOrder(null)).toEqual(["app", "alerts", "monitors", "statusPage", "tests", "aiSre", "review"]);
  });
  it.each([
    ["sre", ["app", "alerts", "monitors", "aiSre", "statusPage", "tests", "review"]],
    ["qa", ["app", "tests", "alerts", "monitors", "statusPage", "aiSre", "review"]],
    ["developer", ["developer", "app", "monitors", "alerts", "tests", "statusPage", "aiSre", "review"]],
    ["leader", ["invite", "app", "alerts", "monitors", "statusPage", "tests", "aiSre", "review"]],
  ] as const)("orders %s", (persona, expected) => {
    expect(stepOrder(persona)).toEqual(expected);
  });
  it("drops unavailable steps but keeps review", () => {
    expect(stepOrder("sre", (s) => s !== "aiSre")).not.toContain("aiSre");
    expect(stepOrder("sre", () => false)).toEqual(["review"]);
  });
});

describe("guards and sidebar", () => {
  it("validates personas and step keys", () => {
    expect(isUserPersona("qa")).toBe(true);
    expect(isUserPersona("ceo")).toBe(false);
    expect(isUserPersona(3)).toBe(false);
    expect(isSetupStepKey("review")).toBe(true);
    expect(isSetupStepKey("nope")).toBe(false);
  });
  it("keeps today's sidebar without a persona", () => {
    expect(sidebarLayout(null)).toEqual({ order: ["Respond", "Communicate", "Automate", "Monitor"], expanded: null });
    expect(sidebarLayout("sre").expanded).toBe("Respond");
  });
});
