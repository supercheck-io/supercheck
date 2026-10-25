import { render, screen } from "@testing-library/react";

import { DateTimeCell } from "./date-time-cell";

describe("DateTimeCell", () => {
  it("shows the date and a muted time", () => {
    render(<DateTimeCell value="2026-10-24T22:56:00Z" />);

    expect(screen.getByText(/^[A-Z][a-z]{2} \d{1,2}, 2026$/)).toBeInTheDocument();
    expect(screen.getByText(/^\d{2}:\d{2}\s?(AM|PM)$/)).toBeInTheDocument();
  });

  it("falls back to the empty label for missing or invalid values", () => {
    const { rerender } = render(<DateTimeCell value={null} emptyLabel="Never" />);
    expect(screen.getByText("Never")).toBeInTheDocument();

    rerender(<DateTimeCell value="not-a-date" emptyLabel="Unknown" />);
    expect(screen.getByText("Unknown")).toBeInTheDocument();

    rerender(<DateTimeCell value={undefined} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
