import { render, screen } from "@testing-library/react";

import { DateCell } from "./table-cells";

describe("DateCell", () => {
  it("drops the year for dates in the current year", () => {
    const value = new Date(new Date().getFullYear(), 8, 16, 18, 47);
    const { container } = render(<DateCell value={value} />);

    expect(container.querySelector("time")).toHaveAttribute("dateTime", value.toISOString());
    expect(screen.getByText(/^Sep 16/)).toBeInTheDocument();
    expect(screen.getByText("6:47 PM")).toBeInTheDocument();
    expect(container.textContent).not.toContain(String(value.getFullYear()));
  });

  it("keeps the year for other years and puts the full timestamp in the title", () => {
    const { container } = render(<DateCell value="2020-03-21T12:03:00Z" showTime={false} />);

    expect(screen.getByText("Mar 21, 2020")).toBeInTheDocument();
    expect(container.querySelector("time")?.getAttribute("title")).toMatch(/Mar 21, 2020, \d{1,2}:\d{2} (AM|PM) \S+/);
  });

  it("falls back to the empty label for missing or invalid values", () => {
    const { rerender } = render(<DateCell value={null} />);
    expect(screen.getByText("Never")).toBeInTheDocument();

    rerender(<DateCell value="not-a-date" empty="Unknown" />);
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });
});
