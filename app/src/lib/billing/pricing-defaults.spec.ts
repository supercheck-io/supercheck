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
    ).toBe("$5.00 per 1,000 VU-min");
    expect(
      formatOveragePrice(DEFAULT_OVERAGE_PRICING.pro.k6VuMinutes, "VU-min"),
    ).toBe("$2.50 per 1,000 VU-min");
    expect(formatOveragePrice(0.5, "AI SRE investigation")).toBe(
      "$0.50/AI SRE investigation",
    );
  });
  it("shares the organization scope and peak VU contract across API and fallback", () => {
    expect(
      PRICING_FAQS.find(
        (f) =>
          f.question === "Does one subscription cover multiple organizations?",
      )?.answer,
    ).toContain("team members, projects");
    expect(
      PRICING_FAQS.find((f) => f.question === "How is usage tracked?")?.answer,
    ).toContain("rather than accumulated active VU-time");
  });
});
