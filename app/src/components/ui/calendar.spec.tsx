import { render } from "@testing-library/react";
import { Calendar } from "./calendar";

describe("Calendar", () => {
  it("lays weeks out on a 7-column grid so days keep their weekday column", () => {
    const { container } = render(<Calendar mode="single" defaultMonth={new Date(2026, 10, 1)} endMonth={new Date(2026, 10, 1)} />);
    const weeks = container.querySelectorAll(".rdp-week");
    expect(weeks[0]).toHaveClass("grid-cols-7");
    // react-day-picker drops the days after endMonth, so the last week has only 29 and 30.
    expect(weeks[weeks.length - 1].querySelectorAll("td")).toHaveLength(2);
  });

  it("reserves an eighth column for week numbers", () => {
    const { container } = render(<Calendar mode="single" showWeekNumber defaultMonth={new Date(2026, 10, 1)} />);
    expect(container.querySelector(".rdp-weekdays")).toHaveClass("grid-cols-8");
    expect(container.querySelector(".rdp-week")).toHaveClass("grid-cols-8");
  });
});
