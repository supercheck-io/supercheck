/** @jest-environment node */
import { renderToStaticMarkup } from "react-dom/server";
import { UsageNotificationEmail } from "./usage-notification";

// @react-email/render needs a dynamic import Jest cannot run; the markup is
// enough to check which 100% message each meter receives.
const base = {
  organizationName: "Acme",
  notificationType: "usage_100_percent" as const,
  usageAmount: 100,
  usageLimit: 100,
  usagePercentage: 100,
  billingPageUrl: "https://app.supercheck.io/org-admin?tab=subscription",
  periodEndDate: "November 1, 2026",
};

describe("UsageNotificationEmail 100% copy", () => {
  it.each(["playwright", "k6", "sre"] as const)(
    "tells %s users that additional usage is billed at the overage rate",
    (resourceType) => {
      const html = renderToStaticMarkup(UsageNotificationEmail({ ...base, resourceType }));
      expect(html).toContain("overage rate");
      expect(html).not.toContain("AI actions are unavailable");
    },
  );

  it("tells AI users credits are a hard limit, without overage billing", () => {
    const html = renderToStaticMarkup(UsageNotificationEmail({ ...base, resourceType: "ai" }));
    expect(html).toContain("AI actions are unavailable");
    expect(html).not.toContain("overage rate");
  });
});
