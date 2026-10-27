import { fireEvent, render, screen, within } from "@testing-library/react";

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

  it("lists agents on one line per row and opens a read-only details dialog", async () => {
    const agent = {
      id: "018f0000-0000-7000-8000-000000000002",
      name: "prod-vpc-agent",
      status: "disconnected" as const,
      version: "1.4.0",
      agentMode: "connector_proxy" as const,
      supportsSreConnectors: true,
      region: "local",
      networkLabel: "seed-vpn",
      lastHeartbeatAt: new Date("2026-06-27T10:00:00.000Z"),
      lastError: "Heartbeat missed",
      projectScoped: true,
      createdAt: new Date("2026-06-27T09:00:00.000Z"),
      updatedAt: new Date("2026-06-27T10:00:00.000Z"),
    };
    render(
      <PrivateAgentsAdminView
        initialAgents={[agent]}
        loadError={null}
        connectors={[
          { id: "c1", name: "CloudWatch prod", privateAgent: { id: agent.id } },
        ] as never}
      />,
    );

    const row = (await screen.findByText("prod-vpc-agent")).closest("tr")!;
    expect(within(row).getByText("1.4.0")).toBeInTheDocument();
    expect(within(row).getByText("seed-vpn")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search agents...")).toBeInTheDocument();
    expect(screen.queryByText("Heartbeat missed")).not.toBeInTheDocument();

    fireEvent.click(row);
    const dialog = screen.getByRole("dialog", { name: "prod-vpc-agent" });
    expect(within(dialog).getAllByText("Heartbeat missed")).toHaveLength(2);
    expect(within(dialog).getByText("CloudWatch prod")).toBeInTheDocument();
  });
});
