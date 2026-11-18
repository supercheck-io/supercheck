import { fireEvent, render, screen } from "@testing-library/react";
import { Bell } from "lucide-react";

import { InfoPopover } from "./info-popover";

const renderIt = () =>
  render(
    <InfoPopover
      label="About alerts"
      title="Alerts"
      icon={Bell}
      items={[{ icon: Bell, title: "Channels", description: "Where alerts go" }]}
      bullets={["Managed per project"]}
      learnMoreHref="https://example.com/docs"
    />,
  );

describe("InfoPopover", () => {
  it("opens on click, not on hover, and exposes aria state", () => {
    renderIt();
    const trigger = screen.getByRole("button", { name: "About alerts" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.pointerEnter(trigger);
    fireEvent.mouseOver(trigger);
    expect(screen.queryByText("Channels")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: "About alerts" })).toBeInTheDocument();
  });

  it("renders the header, items, bullets and docs link", () => {
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "About alerts" }));
    expect(screen.getByRole("heading", { name: "Alerts" })).toBeInTheDocument();
    expect(screen.getByText("Channels")).toBeInTheDocument();
    expect(screen.getByText("Where alerts go")).toBeInTheDocument();
    expect(screen.getByText("Managed per project")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Learn more" })).toHaveAttribute("href", "https://example.com/docs");
  });

  it("closes on Escape", () => {
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "About alerts" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByText("Channels")).not.toBeInTheDocument();
  });

  it("reports open changes when controlled", () => {
    const onOpenChange = jest.fn();
    render(<InfoPopover label="About alerts" title="Alerts" open={false} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole("button", { name: "About alerts" }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("renders items with duplicate titles without key warnings", () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    render(<InfoPopover label="About x" title="X" items={[{ title: "Same" }, { title: "Same" }]} bullets={["a", "a"]} />);
    fireEvent.click(screen.getByRole("button", { name: "About x" }));
    expect(screen.getAllByText("Same")).toHaveLength(2);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
