import { statusCardsGridClass } from "./status-cards-grid";

describe("statusCardsGridClass", () => {
  it("sizes the grid to the cards shown, so a missing Job ID card leaves no gap", () => {
    expect(statusCardsGridClass(true)).toContain("md:grid-cols-7");
    expect(statusCardsGridClass(false)).toContain("md:grid-cols-6");
    expect(statusCardsGridClass(false)).not.toContain("md:grid-cols-7");
  });
});
