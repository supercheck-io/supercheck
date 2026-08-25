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

    expect(screen.getByLabelText("Credential value")).toBeInTheDocument();
    expect(screen.queryByLabelText("Datadog API key")).not.toBeInTheDocument();
  });
});
