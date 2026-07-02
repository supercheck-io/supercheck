import { fireEvent, render, screen } from "@testing-library/react";

import { SreAssistantUiModal } from "./sre-assistant-ui-modal";

jest.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

jest.mock("@/components/sre/sre-assistant-ui-thread", () => ({
  SreAssistantUiThread: () => <div>Copilot thread mounted</div>,
}));

describe("SreAssistantUiModal", () => {
  it("renders the floating Copilot launcher and opens the chat panel", async () => {
    render(<SreAssistantUiModal />);

    fireEvent.click(screen.getByRole("button", { name: "Open AI Copilot" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Copilot" })).toBeInTheDocument();
    expect(screen.getByText("Copilot thread mounted")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open/i })).toHaveAttribute("href", "/copilot");
  });
});
