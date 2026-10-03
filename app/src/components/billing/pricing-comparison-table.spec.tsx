import { render, screen } from "@testing-library/react";
import { PricingComparisonTable } from "./pricing-comparison-table";

it("displays discounted defaults when overage data is unavailable", () => {
  render(<PricingComparisonTable categories={[]} />);
  expect(screen.getByText("$5.00 per 1,000 VU-min")).toBeVisible();
  expect(screen.getByText("$2.50 per 1,000 VU-min")).toBeVisible();
});
