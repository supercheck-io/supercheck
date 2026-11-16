import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import { OptionalSection } from "./optional-section";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <OptionalSection title="Advanced" description="Protocol and more" open={open} onOpenChange={setOpen} testId="toggle">
      <p>inside</p>
    </OptionalSection>
  );
}

describe("OptionalSection", () => {
  it("opens and closes with a click, Enter and Space, and ignores other keys", () => {
    render(<Harness />);
    const header = screen.getByTestId("toggle");
    expect(header).toHaveAttribute("role", "button");
    expect(header).toHaveAttribute("tabindex", "0");
    expect(screen.queryByText("inside")).toBeNull();

    fireEvent.click(header);
    expect(screen.getByText("inside")).toBeInTheDocument();
    fireEvent.keyDown(header, { key: "Enter" });
    expect(screen.queryByText("inside")).toBeNull();
    fireEvent.keyDown(header, { key: " " });
    expect(screen.getByText("inside")).toBeInTheDocument();
    fireEvent.keyDown(header, { key: "a" });
    expect(screen.getByText("inside")).toBeInTheDocument();
  });
});
