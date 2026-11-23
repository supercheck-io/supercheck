import { render, screen } from "@testing-library/react";
import { Plug, Zap } from "lucide-react";
import { DetailPopoverHeader, DetailStat } from "./detail-popover";

describe("detail popover pieces", () => {
  it("shows the title, the aside and the meta in the header", () => {
    render(<DetailPopoverHeader icon={Plug} title="Tools" aside={<span>4</span>} meta="server 1.0" />);
    expect(screen.getByRole("heading", { name: "Tools" })).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("server 1.0")).toBeInTheDocument();
  });

  it("shows a stat value, and a dash when missing", () => {
    const { rerender } = render(<DetailStat icon={Zap} iconClass="text-sky-500" label="First token" value="420 ms" testId="s" />);
    expect(screen.getByTestId("s")).toHaveTextContent("First token420 ms");
    rerender(<DetailStat icon={Zap} iconClass="text-sky-500" label="First token" value={null} testId="s" />);
    expect(screen.getByTestId("s")).toHaveTextContent("—");
  });
});
