import { PRICING_FAQS } from "./pricing-copy";
import {
  DEFAULT_OVERAGE_PRICING,
  DEFAULT_OVERAGE_PRICING_CENTS,
  formatOveragePrice,
} from "./pricing-defaults";

describe("pricing defaults and copy", () => {
  it("keeps fractional K6 display rates consistent with admission cents", () => {
    expect(DEFAULT_OVERAGE_PRICING.plus.k6VuMinutes).toBe(
      DEFAULT_OVERAGE_PRICING_CENTS.plus.k6VuMinutes / 100,
    );
    expect(DEFAULT_OVERAGE_PRICING.pro.k6VuMinutes).toBe(
      DEFAULT_OVERAGE_PRICING_CENTS.pro.k6VuMinutes / 100,
    );
    expect(
      formatOveragePrice(DEFAULT_OVERAGE_PRICING.plus.k6VuMinutes, "VU-min"),
    ).toBe("$2.00 per 1,000 VU-min");
    expect(
      formatOveragePrice(DEFAULT_OVERAGE_PRICING.pro.k6VuMinutes, "VU-min"),
    ).toBe("$1.00 per 1,000 VU-min");
    expect(formatOveragePrice(0.5, "AI SRE investigation")).toBe(
      "$0.50/AI SRE investigation",
    );
  });
  it("formats sub-cent Playwright rates per minute when requested", () => {
    expect(formatOveragePrice(0.01, "min", true)).toBe("$0.01/min");
    expect(formatOveragePrice(0.005, "min", true)).toBe("$0.005/min");
  });

  it("offers a lower browser rate on Pro without billing AI actions", () => {
    expect(DEFAULT_OVERAGE_PRICING.plus.playwrightMinutes).toBe(0.01);
    expect(DEFAULT_OVERAGE_PRICING.pro.playwrightMinutes).toBe(0.005);
    expect(DEFAULT_OVERAGE_PRICING.plus.sreInvestigationUnits).toBe(0.1);
    expect(DEFAULT_OVERAGE_PRICING.pro.sreInvestigationUnits).toBe(0.1);
    expect(DEFAULT_OVERAGE_PRICING.plus.aiCredits).toBe(0);
    expect(DEFAULT_OVERAGE_PRICING.pro.aiCredits).toBe(0);
  });
  it("shares the organization scope and peak VU contract across API and fallback", () => {
    expect(
      PRICING_FAQS.find(
        (f) =>
          f.question ===
          "Does one subscription cover the projects in my organization?",
      )?.answer,
    ).toContain("all projects within it share your monthly subscription");
    expect(
      PRICING_FAQS.find((f) => f.question === "How are load tests measured?")
        ?.answer,
    ).toContain("This can exceed accumulated active VU-time");
  });
});

it.each([
  [0.0125, "$0.0125/VU-min"],
  [0.010001, "$0.010001/VU-min"],
])("preserves custom rate %s", (price, expected) => {
  expect(formatOveragePrice(Number(price), "VU-min")).toBe(expected);
});
