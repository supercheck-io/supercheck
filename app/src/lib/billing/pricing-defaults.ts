// Browser-safe defaults; database pricing remains authoritative.

export const DEFAULT_OVERAGE_PRICING_CENTS = {
  plus: {
    playwrightMinutes: 1,
    k6VuMinutes: 0.2,
    aiCredits: 0,
    sreInvestigationUnits: 10,
  },
  pro: {
    playwrightMinutes: 0.5,
    k6VuMinutes: 0.1,
    aiCredits: 0,
    sreInvestigationUnits: 10,
  },
} as const;

export const DEFAULT_OVERAGE_PRICING = {
  plus: {
    playwrightMinutes:
      DEFAULT_OVERAGE_PRICING_CENTS.plus.playwrightMinutes / 100,
    k6VuMinutes: DEFAULT_OVERAGE_PRICING_CENTS.plus.k6VuMinutes / 100,
    aiCredits: DEFAULT_OVERAGE_PRICING_CENTS.plus.aiCredits / 100,
    sreInvestigationUnits:
      DEFAULT_OVERAGE_PRICING_CENTS.plus.sreInvestigationUnits / 100,
  },
  pro: {
    playwrightMinutes:
      DEFAULT_OVERAGE_PRICING_CENTS.pro.playwrightMinutes / 100,
    k6VuMinutes: DEFAULT_OVERAGE_PRICING_CENTS.pro.k6VuMinutes / 100,
    aiCredits: DEFAULT_OVERAGE_PRICING_CENTS.pro.aiCredits / 100,
    sreInvestigationUnits:
      DEFAULT_OVERAGE_PRICING_CENTS.pro.sreInvestigationUnits / 100,
  },
};

export function formatOveragePrice(price: number, unit: string, perUnit = false) {
  if (price < 0.01 && !perUnit) {
    return `$${(price * 1000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} per 1,000 ${unit}`;
  }
  return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}/${unit}`;
}

