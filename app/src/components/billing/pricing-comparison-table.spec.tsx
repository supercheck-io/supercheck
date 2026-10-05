import { render, screen } from "@testing-library/react";
import { PricingComparisonTable } from "./pricing-comparison-table";

it("displays discounted defaults when overage data is unavailable", () => {
  render(<PricingComparisonTable categories={[]} />);
  expect(screen.getByText("$5.00 per 1,000 VU-min")).toBeVisible();
  expect(screen.getByText("$2.50 per 1,000 VU-min")).toBeVisible();
});

it("provides keyboard scrolling, row headers, and meaningful feature availability", () => {
  render(<PricingComparisonTable categories={[{
    category: "Support", features: [{ name: "Custom SLA", plus: false, pro: false, enterprise: true }],
  }]} />);
  expect(screen.getByRole("region", { name: "Plan comparison" })).toHaveAttribute("tabindex", "0");
  expect(screen.getByRole("table", { name: "Hosted plan features and overage rates" })).toBeVisible();
  expect(screen.getByRole("rowheader", { name: "Custom SLA" })).toHaveAttribute("scope", "row");
  expect(screen.getAllByText("Not included")).toHaveLength(2);
  expect(screen.getByText("Included")).toBeInTheDocument();
  expect(screen.getAllByText("Hard limit (no overage)")).toHaveLength(2);
  expect(screen.queryByText("$0.05/credit")).not.toBeInTheDocument();
});
