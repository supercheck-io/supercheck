import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { registerPrivateAgent } from "@/actions/private-agents";

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

it("shows the env var names and keeps the one-time token dialog open on Escape and outside click", async () => {
(registerPrivateAgent as jest.Mock).mockResolvedValue({
success: true,
message: "Registered",
registrationToken: "scpa_token_value",
agent: { id: "018f0000-0000-7000-8000-000000000002", name: "edge" },
});
render(<PrivateAgentsAdminView initialAgents={[]} loadError={null} />);
fireEvent.click(screen.getByRole("button", { name: "Register agent" }));
fireEvent.change(screen.getByLabelText("Agent name *"), { target: { value: "edge" } });
const dialog = screen.getByRole("dialog", { name: "Register Private Agent" });
fireEvent.click(within(dialog).getByRole("button", { name: "Register agent" }));
await screen.findByText("PRIVATE_AGENT_TOKEN");
for (const text of ["SUPERCHECK_API_URL", "PRIVATE_AGENT_ID", "deploy/docker/docker-compose-private-agent.yml"]) {
expect(screen.getByText(text)).toBeInTheDocument();
}
fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
fireEvent.pointerDown(document.body);
await waitFor(() => expect(screen.getByRole("dialog", { name: "Register Private Agent" })).toBeInTheDocument());
fireEvent.click(screen.getByRole("button", { name: "Done" }));
await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});
});
