import { fireEvent, render, screen } from "@testing-library/react";

import { ConnectorFormDialog } from "./connector-form-dialog";

jest.mock("@/actions/sre-connectors", () => ({
  createSreConnector: jest.fn(),
}));

const setupOptions = {
  services: [],
  privateAgents: [],
};

describe("ConnectorFormDialog credentials", () => {
  it("shows Datadog API and application key fields", () => {
    render(
      <ConnectorFormDialog
        open
        onOpenChange={jest.fn()}
        setupOptions={setupOptions}
        onSaved={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText("Connector type"));
    fireEvent.click(screen.getByRole("option", { name: "Datadog" }));

    expect(screen.getByLabelText("Datadog API key")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Datadog application key"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Credential value")).not.toBeInTheDocument();
  });

  it("keeps a single credential value for GitHub", () => {
    render(
      <ConnectorFormDialog
        open
        onOpenChange={jest.fn()}
        setupOptions={setupOptions}
        onSaved={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText("Connector type"));
    fireEvent.click(screen.getByRole("option", { name: "GitHub" }));

    expect(screen.getByLabelText("Credential value")).toBeInTheDocument();
    expect(screen.queryByLabelText("Datadog API key")).not.toBeInTheDocument();
  });

  it("warns when a Private Agent endpoint uses plain HTTP, and only then", () => {
    render(
      <ConnectorFormDialog
        open
        onOpenChange={jest.fn()}
        setupOptions={{
          services: [],
          privateAgents: [{ id: "agent-1", name: "vpc-agent", status: "connected", version: null, region: null, networkLabel: null, lastHeartbeatAt: null }],
        }}
        onSaved={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("Connector type"));
    fireEvent.click(screen.getByRole("option", { name: "MCP" }));
    const endpoint = screen.getByLabelText("Endpoint URL *");

    fireEvent.change(endpoint, { target: { value: "http://mcp.internal:8080/mcp" } });
    expect(screen.getByText(/uses plain HTTP/)).toBeInTheDocument();

    fireEvent.change(endpoint, { target: { value: "https://mcp.internal/mcp" } });
    expect(screen.queryByText(/uses plain HTTP/)).not.toBeInTheDocument();
  });

  it("does not show the plain HTTP warning for a direct connector", () => {
    render(
      <ConnectorFormDialog
        open
        onOpenChange={jest.fn()}
        setupOptions={setupOptions}
        onSaved={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("Connector type"));
    fireEvent.click(screen.getByRole("option", { name: "Prometheus" }));
    fireEvent.change(screen.getByLabelText("Endpoint URL *"), { target: { value: "http://prometheus.example.com" } });
    expect(screen.queryByText(/uses plain HTTP/)).not.toBeInTheDocument();
  });
});
