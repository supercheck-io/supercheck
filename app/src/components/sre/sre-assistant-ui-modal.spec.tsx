import { fireEvent, render, screen } from "@testing-library/react";

import { SreAssistantUiModal } from "./sre-assistant-ui-modal";

jest.mock("next/navigation", () => ({
  usePathname: () => "/copilot",
}));

jest.mock("@/components/sre/sre-assistant-ui-thread", () => ({
  SreAssistantUiThread: () => <div>AISRE thread mounted</div>,
}));

describe("SreAssistantUiModal", () => {
  it("renders the floating AISRE launcher and opens the chat panel", async () => {
    render(<SreAssistantUiModal />);

    fireEvent.click(screen.getByRole("button", { name: "Open AISRE Copilot" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("AISRE Copilot")).toBeInTheDocument();
    expect(screen.getByText("AISRE thread mounted")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open/i })).toHaveAttribute("href", "/copilot");
  });
});
