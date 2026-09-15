import { fireEvent, render, screen } from "@testing-library/react";

import { PrivateAgentsAdminView } from "./private-agents-admin-view";

jest.mock("@/actions/private-agents", () => ({
  disablePrivateAgent: jest.fn(),
  registerPrivateAgent: jest.fn(),
  rotatePrivateAgentToken: jest.fn(),
}));

if (!globalThis.ResizeObserver) {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  globalThis.ResizeObserver =
    ResizeObserverMock as unknown as typeof ResizeObserver;
}

describe("PrivateAgentsAdminView", () => {
  it("opens a registration dialog that fits narrow viewports", () => {
    render(<PrivateAgentsAdminView initialAgents={[]} loadError={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Register agent" }));

    const dialog = screen.getByRole("dialog", {
      name: "Register Private Agent",
    });
    expect(dialog).toHaveClass("w-[calc(100vw-1rem)]");
    expect(dialog).not.toHaveClass("min-w-2xl");
  });
});
