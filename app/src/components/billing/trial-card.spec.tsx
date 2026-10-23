import { fireEvent, render, screen } from "@testing-library/react";
import { PricingFaqs } from "./pricing-faqs";
import { TrialCard } from "./trial-card";

describe("TrialCard", () => {
  it("lists what the trial includes", () => {
    render(<TrialCard durationDays={14} highlights={["5 monitors", "30 browser minutes"]} />);
    expect(screen.getByRole("heading", { name: "What your free trial includes" })).toBeInTheDocument();
    expect(screen.getByText(/14 days, no card required/)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["5 monitors", "30 browser minutes"]);
  });
});

describe("PricingFaqs", () => {
  it("expands an answer on click", () => {
    render(<PricingFaqs faqs={[{ question: "Is there a free trial?", answer: "Yes, 14 days." }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Is there a free trial?" }));
    expect(screen.getByText("Yes, 14 days.")).toBeVisible();
  });
});
