import { render, screen } from "@testing-library/react";
import { PricingComparisonTable } from "./pricing-comparison-table";

it("displays discounted defaults when overage data is unavailable", () => {
  render(<PricingComparisonTable categories={[]} />);
  expect(screen.getByText("$2.00 per 1,000 VU-min")).toBeVisible();
  expect(screen.getByText("$1.00 per 1,000 VU-min")).toBeVisible();
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
  expect(screen.getAllByText("Included · fair use")).toHaveLength(2);
  expect(screen.queryByText("$0.05/credit")).not.toBeInTheDocument();
});

it("never renders an AI overage price even if the API returns a non-zero aiCredits", () => {
  render(<PricingComparisonTable categories={[]} overagePricing={{
    plus: { playwrightMinutes: 0.01, k6VuMinutes: 0.002, aiCredits: 0.05, sreInvestigationUnits: 0.1 },
    pro: { playwrightMinutes: 0.005, k6VuMinutes: 0.001, aiCredits: 0.03, sreInvestigationUnits: 0.1 },
  }} />);
  expect(screen.queryByText(/\$0\.05/)).not.toBeInTheDocument();
  expect(screen.queryByText(/\$0\.03/)).not.toBeInTheDocument();
  expect(screen.getAllByText("Included · fair use")).toHaveLength(2);
});
