jest.mock("@/lib/services/polar-usage.service", () => ({
  polarUsageService: { shouldBlockUsage: jest.fn() },
}));

import { polarUsageService } from "@/lib/services/polar-usage.service";
import { heldComponentIds, isSyntheticBillingHold } from "./billing-hold";

describe("billing hold", () => {
  it("holds only components built entirely from browser checks", () => {
    expect(heldComponentIds([
      { componentId: "browser", monitorType: "synthetic_test" },
      { componentId: "browser", monitorType: "synthetic_test" },
      { componentId: "mixed", monitorType: "synthetic_test" },
      { componentId: "mixed", monitorType: "http_request" },
      { componentId: "api", monitorType: "http_request" },
    ])).toEqual(new Set(["browser"]));
  });

  it("reports no hold when the billing lookup fails", async () => {
    (polarUsageService.shouldBlockUsage as jest.Mock).mockRejectedValueOnce(new Error("db down"));
    await expect(isSyntheticBillingHold("org")).resolves.toBe(false);
    (polarUsageService.shouldBlockUsage as jest.Mock).mockResolvedValueOnce({ blocked: true });
    await expect(isSyntheticBillingHold("org")).resolves.toBe(true);
  });
});
