jest.mock("@/utils/db", () => ({ db: { select: jest.fn() } }));
jest.mock("@/lib/location-registry", () => ({
  getEnabledLocations: jest.fn().mockResolvedValue([]),
}));
import { db } from "@/utils/db";
import { GET } from "./route";

describe("Billing pricing configuration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("does not invent a missing paid plan", async () => {
    (db.select as jest.Mock).mockReturnValue({
      from: () => ({ where: async () => [{ plan: "plus" }] }),
    });
    const response = await GET();
    expect(response.status).toBe(503);
  });

  it("preserves configured zero limits in plan comparisons", async () => {
    const plans = ["plus", "pro"].map((plan) => ({
      plan,
      maxMonitors: 0,
      playwrightMinutesIncluded: 0,
      k6VuMinutesIncluded: 0,
      aiCreditsIncluded: 0,
      sreInvestigationUnitsIncluded: "0",
      runningCapacity: 0,
      queuedCapacity: 0,
    }));
    (db.select as jest.Mock)
      .mockReturnValueOnce({ from: () => ({ where: async () => plans }) })
      .mockReturnValueOnce({ from: () => ({ where: async () => [] }) });
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.plans[0].features.monitors).toBe(0);
    expect(body.featureComparison[0].features[0].plus).toBe(0);
    expect(body.featureComparison[1].features[0].plus).toBe("0/month");
  });
  it("exposes the revised allowances while retaining affordable overage", async () => {
    const plans = [
      { plan: "plus", sreInvestigationUnitsIncluded: "25.0000" },
      { plan: "pro", sreInvestigationUnitsIncluded: "100.0000" },
    ];
    (db.select as jest.Mock)
      .mockReturnValueOnce({ from: () => ({ where: async () => plans }) })
      .mockReturnValueOnce({ from: () => ({ where: async () => [] }) });
    const body = await (await GET()).json();
    expect(body.plans.map((plan: { price: number; features: { sreInvestigationUnits: number }; overagePricing: { sreInvestigationUnits: number } }) => [
      plan.price, plan.features.sreInvestigationUnits, plan.overagePricing.sreInvestigationUnits,
    ])).toEqual([[49, 25, 0.5], [149, 100, 0.5]]);
  });

});
