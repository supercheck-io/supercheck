import { fireEvent, render, screen } from "@testing-library/react";

import { SreAssistantUiModal } from "./sre-assistant-ui-modal";

let mockPathname = "/dashboard";

jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

jest.mock("@/components/sre/sre-assistant-ui-thread", () => ({
  SreAssistantUiThread: ({ incidentId }: { incidentId?: string | null }) => (
    <div data-incident-id={incidentId ?? ""}>Copilot thread mounted</div>
  ),
}));

describe("SreAssistantUiModal", () => {
  beforeEach(() => {
    mockPathname = "/dashboard";
  });

  it("renders the floating Copilot launcher and opens the chat panel", async () => {
    render(<SreAssistantUiModal />);

    const launcher = screen.getByRole("button", { name: "Open Copilot" });
    expect(launcher).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(launcher);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(launcher).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("heading", { name: "Copilot" })).toBeInTheDocument();
    expect(screen.getByText("Copilot thread mounted")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open/i })).toHaveAttribute("href", "/copilot");
  });

  it("passes incident context to the floating Copilot on incident detail pages", async () => {
    const incidentId = "019f4256-106b-75c1-8671-acd6d7bfaea4";
    mockPathname = `/incidents/${incidentId}`;

    render(<SreAssistantUiModal />);

    fireEvent.click(screen.getByRole("button", { name: "Open Copilot" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Copilot thread mounted")).toHaveAttribute(
      "data-incident-id",
      incidentId,
    );
  });
});
