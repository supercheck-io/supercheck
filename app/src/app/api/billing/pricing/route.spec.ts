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
    expect(body.featureComparison.flatMap((category: { features: { name: string; enterprise: unknown }[] }) => category.features))
      .not.toContainEqual(expect.objectContaining({ name: "SSO/SAML" }));
    expect(body.plans[0].features).not.toHaveProperty("ssoEnabled");
    expect(body.featureComparison.flatMap((category: { features: { enterprise: unknown }[] }) => category.features))
      .not.toContainEqual(expect.objectContaining({ enterprise: "Unlimited" }));
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
    expect(body.plans.map((plan: { overagePricing: { k6VuMinutes: number } }) => plan.overagePricing.k6VuMinutes))
      .toEqual([0.005, 0.0025]);
    expect(body).not.toHaveProperty("enterpriseStartingPrice");
    expect(body.faqs).toContainEqual(expect.objectContaining({
      answer: expect.stringContaining("Get in touch at hello@supercheck.io"),
    }));
    expect(body.faqs).toContainEqual(expect.objectContaining({
      question: "Does one subscription cover multiple organizations?",
      answer: expect.stringContaining("Each cloud organization needs its own subscription"),
    }));
  });

  it.each([null, 0, 0.25])("uses a configured K6 override %s without replacing custom legacy rates", async (override) => {
    const plans = ["plus", "pro"].map((plan) => ({ plan }));
    const prices = plans.map(({ plan }) => ({
      plan, playwrightMinutePriceCents: 3, k6VuMinutePriceCents: 7,
      k6VuMinutePriceCentsOverride: override, aiCreditPriceCents: 5,
      sreInvestigationUnitPriceCents: 50,
    }));
    (db.select as jest.Mock)
      .mockReturnValueOnce({ from: () => ({ where: async () => plans }) })
      .mockReturnValueOnce({ from: () => ({ where: async () => prices }) });
    const body = await (await GET()).json();
    const expected = (override ?? 7) / 100;
    expect(body.plans[0].overagePricing.k6VuMinutes).toBe(expected);
    expect(body.overagePricing.plus.k6VuMinutes).toBe(expected);
    expect(body.overagePricing.pro.k6VuMinutes).toBe(expected);
  });

});
