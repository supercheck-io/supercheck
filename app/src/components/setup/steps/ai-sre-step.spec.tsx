import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { SetupDraft } from "@/lib/setup/draft-schema";
import { makeResponse, makeStepProps, PROJECT_ID } from "../test-fixtures";
import { AiSreStep } from "./ai-sre-step";

const mockCreate = jest.fn();
const mockValidate = jest.fn();
const mockList = jest.fn();
jest.mock("@/actions/sre-connectors", () => ({
  getSreConnectors: (...args: unknown[]) => mockList(...args),
  createSreConnector: (...args: unknown[]) => mockCreate(...args),
  validateSreConnector: (...args: unknown[]) => mockValidate(...args),
}));
const CID = "00000000-0000-4000-8000-0000000000c1";

let activeProject: string;
beforeEach(() => {
  mockCreate.mockReset();
  mockValidate.mockReset();
  mockList.mockReset().mockResolvedValue({ success: true, connectors: [] });
  activeProject = PROJECT_ID;
  global.fetch = (async () => ({ ok: true, status: 200, json: async () => ({ project: { id: activeProject } }) })) as unknown as typeof fetch;
});

function drafting(initial: SetupDraft = {}) {
  let draft = initial;
  const patchDraft = jest.fn((fn: (d: SetupDraft) => SetupDraft) => {
    draft = fn(draft);
  });
  return { patchDraft, get: () => draft };
}
const admin = () => {
  const response = makeResponse();
  return { permissions: { ...response.permissions, canConfigureConnectors: true, canCreateServices: true } };
};
const open = (name: RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("AiSreStep permissions", () => {
  const props = (p: { canConfigureConnectors: boolean; canCreateServices: boolean }) =>
    makeStepProps({ permissions: { ...makeResponse().permissions, ...p }, draft: { app: { url: "https://app.example.com" } } });
  it("shows the service only with sre_service:create and the connectors only with sre_connector:configure", () => {
    const { unmount } = render(<AiSreStep {...props({ canConfigureConnectors: true, canCreateServices: false })} />);
    expect(screen.queryByLabelText(/Create a service named/)).toBeNull();
    expect(screen.getByRole("group", { name: "Connector types" })).toBeTruthy();
    unmount();
    const second = render(<AiSreStep {...props({ canConfigureConnectors: false, canCreateServices: true })} />);
    expect(screen.getByLabelText(/Create a service named app.example.com/)).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Connector types" })).toBeNull();
    second.unmount();
    render(<AiSreStep {...props({ canConfigureConnectors: false, canCreateServices: false })} />);
    expect(screen.getByText(/Ask a project admin/)).toBeTruthy();
  });
});

describe("AiSreStep", () => {
  it("a slow save keeps ids added meanwhile and does not close the form opened after it", async () => {
    let finish: (v: unknown) => void = () => {};
    mockCreate.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    mockValidate.mockResolvedValue({ success: true, connector: { lastValidationStatus: "valid" } });
    const OTHER = "00000000-0000-4000-8000-0000000000c2";
    const d = drafting({ aiSre: { connectorIds: [OTHER], services: [] } });
    render(<AiSreStep {...makeStepProps({ ...admin(), patchDraft: d.patchDraft, draft: d.get() })} />);
    open(/GitHub/);
    type("Access token", "ghp_x");
    fireEvent.click(screen.getByRole("button", { name: "Save and test" }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    open(/Sentry/);
    // Another connector lands in the draft while the first save is still running.
    d.patchDraft((x) => ({ ...x, aiSre: { services: [], ...x.aiSre, connectorIds: [OTHER, "00000000-0000-4000-8000-0000000000c3"] } }));
    finish({ success: true, connector: { id: CID } });
    await waitFor(() => expect(d.get().aiSre?.connectorIds).toContain(CID));
    expect(d.get().aiSre?.connectorIds).toEqual([OTHER, "00000000-0000-4000-8000-0000000000c3", CID]);
    expect(screen.getByTestId("setup-connector-form-sentry")).toBeTruthy();
  });

  it("shows Ask a project admin without sre_connector:configure", () => {
    render(<AiSreStep {...makeStepProps()} />);
    expect(screen.getByText(/Ask a project admin/)).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Connector types" })).toBeNull();
  });

  it("saves immediately, then validates, and shows Connected; the draft keeps only the id", async () => {
    mockCreate.mockResolvedValue({ success: true, connector: { id: CID }, message: "ok" });
    mockValidate.mockResolvedValue({ success: true, message: "ok", connector: { lastValidationStatus: "valid" } });
    const d = drafting();
    render(<AiSreStep {...makeStepProps({ ...admin(), patchDraft: d.patchDraft, draft: d.get() })} />);
    open(/GitHub/);
    const save = screen.getByRole("button", { name: "Save and test" });
    expect(save).toBeDisabled();
    type("Access token", "ghp_secret_value");
    fireEvent.click(save);
    expect(await screen.findByText(/GitHub: Connected/)).toBeTruthy();
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ name: "GitHub", type: "github", riskLevel: "low", credential: { credentialType: "api_key", value: { secret: "ghp_secret_value" } } }), PROJECT_ID);
    expect(mockCreate.mock.invocationCallOrder[0]).toBeLessThan(mockValidate.mock.invocationCallOrder[0]);
    expect(mockValidate).toHaveBeenCalledWith({ id: CID }, PROJECT_ID);
    expect(d.get().aiSre?.connectorIds).toEqual([CID]);
    expect(JSON.stringify(d.get())).not.toContain("ghp_secret_value");
    expect(screen.queryByLabelText("Access token")).toBeNull();
  });

  it("adopts a connector that already exists instead of creating a duplicate after a lost answer", async () => {
    mockList.mockResolvedValue({ success: true, connectors: [{ id: CID, name: "GitHub", type: "github", status: "configured" }, { id: "x", name: "GitHub", type: "sentry", status: "configured" }] });
    mockValidate.mockResolvedValue({ success: true, message: "ok", connector: { lastValidationStatus: "valid" } });
    const d = drafting();
    render(<AiSreStep {...makeStepProps({ ...admin(), patchDraft: d.patchDraft, draft: d.get() })} />);
    open(/GitHub/);
    type("Access token", "ghp_x");
    fireEvent.click(screen.getByRole("button", { name: "Save and test" }));
    expect(await screen.findByText(/GitHub: Connected/)).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockValidate).toHaveBeenCalledWith({ id: CID }, PROJECT_ID);
    expect(d.get().aiSre?.connectorIds).toEqual([CID]);
  });

  it("creates the connector when the lookup fails or finds only a disabled one", async () => {
    mockList.mockRejectedValue(new Error("net"));
    mockCreate.mockResolvedValue({ success: true, connector: { id: CID }, message: "ok" });
    mockValidate.mockResolvedValue({ success: true, message: "ok", connector: { lastValidationStatus: "valid" } });
    render(<AiSreStep {...makeStepProps({ ...admin() })} />);
    open(/GitHub/);
    type("Access token", "ghp_x");
    fireEvent.click(screen.getByRole("button", { name: "Save and test" }));
    await screen.findByText(/GitHub: Connected/);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("sends both Datadog keys and an optional endpoint; Prometheus needs a URL and may skip the token", async () => {
    mockCreate.mockResolvedValue({ success: true, connector: { id: CID }, message: "ok" });
    mockValidate.mockResolvedValue({ success: true, message: "ok", connector: { lastValidationStatus: "valid" } });
    render(<AiSreStep {...makeStepProps({ ...admin() })} />);
    open(/Datadog/);
    type("API key", "k1");
    expect(screen.getByRole("button", { name: "Save and test" })).toBeDisabled();
    type("Application key", "k2");
    fireEvent.click(screen.getByRole("button", { name: "Save and test" }));
    await screen.findByText(/Datadog: Connected/);
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ type: "datadog", endpointUrl: "", credential: { value: { apiKey: "k1", applicationKey: "k2" } } });
    open(/Prometheus/);
    expect(screen.getByRole("button", { name: "Save and test" })).toBeDisabled();
    type("Prometheus URL", "https://prom.example.com");
    fireEvent.click(screen.getByRole("button", { name: "Save and test" }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2));
    expect(mockCreate.mock.calls[1][0]).toMatchObject({ type: "prometheus", endpointUrl: "https://prom.example.com", credential: undefined });
  });

  it("keeps the connector and says the token was rejected when validation fails", async () => {
    mockCreate.mockResolvedValue({ success: true, connector: { id: CID }, message: "ok" });
    mockValidate.mockResolvedValue({ success: false, error: "401 Unauthorized." });
    const d = drafting();
    render(<AiSreStep {...makeStepProps({ ...admin(), patchDraft: d.patchDraft, draft: d.get() })} />);
    open(/Sentry/);
    type("Auth token", "bad");
    fireEvent.click(screen.getByRole("button", { name: "Save and test" }));
    expect(await screen.findByText("Sentry: Saved, token rejected")).toBeTruthy();
    expect(screen.getByText(/Saved, but the token was rejected\. 401 Unauthorized\./)).toBeTruthy();
    expect(d.get().aiSre?.connectorIds).toEqual([CID]);
  });

  it("keeps the connector and says the token was rejected when the check ran but failed", async () => {
    mockCreate.mockResolvedValue({ success: true, connector: { id: CID }, message: "ok" });
    mockValidate.mockResolvedValue({ success: true, message: "Connector is missing credentials", connector: { lastValidationStatus: "invalid_credentials" } });
    const d = drafting();
    render(<AiSreStep {...makeStepProps({ ...admin(), patchDraft: d.patchDraft, draft: d.get() })} />);
    open(/Sentry/);
    type("Auth token", "bad");
    fireEvent.click(screen.getByRole("button", { name: "Save and test" }));
    expect(await screen.findByText("Sentry: Saved, token rejected")).toBeTruthy();
    expect(screen.getByText(/Saved, but the token was rejected\. Connector is missing credentials/)).toBeTruthy();
    expect(d.get().aiSre?.connectorIds).toEqual([CID]);
  });

  it("keeps the id and says it could not test when validation throws", async () => {
    mockCreate.mockResolvedValue({ success: true, connector: { id: CID }, message: "ok" });
    mockValidate.mockRejectedValue(new Error("network"));
    const d = drafting();
    render(<AiSreStep {...makeStepProps({ ...admin(), patchDraft: d.patchDraft, draft: d.get() })} />);
    open(/Sentry/);
    type("Auth token", "tok");
    fireEvent.click(screen.getByRole("button", { name: "Save and test" }));
    expect(await screen.findByText("Sentry: Saved, not tested")).toBeTruthy();
    expect(screen.getByText(/Saved, but could not test it/)).toBeTruthy();
    expect(d.get().aiSre?.connectorIds).toEqual([CID]);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("shows a save error and does not validate or record anything", async () => {
    mockCreate.mockResolvedValue({ success: false, error: "Insufficient permissions" });
    const d = drafting();
    render(<AiSreStep {...makeStepProps({ ...admin(), patchDraft: d.patchDraft })} />);
    open(/GitHub/);
    type("Access token", "t");
    fireEvent.click(screen.getByRole("button", { name: "Save and test" }));
    expect(await screen.findByText("Insufficient permissions")).toBeTruthy();
    expect(mockValidate).not.toHaveBeenCalled();
    expect(d.patchDraft).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Access token")).toHaveValue("t");
  });

  it("handles a missing connector id and a thrown action", async () => {
    mockCreate.mockResolvedValueOnce({ success: true, message: "ok" });
    render(<AiSreStep {...makeStepProps({ ...admin() })} />);
    open(/GitHub/);
    type("Access token", "t");
    fireEvent.click(screen.getByRole("button", { name: "Save and test" }));
    expect(await screen.findByText(/could not be read back/)).toBeTruthy();
    mockCreate.mockRejectedValueOnce(new Error("boom"));
    fireEvent.click(screen.getByRole("button", { name: "Save and test" }));
    expect(await screen.findByText(/Could not save the connector/)).toBeTruthy();
  });

  it("refuses to save when the active project changed in another tab", async () => {
    activeProject = "99999999-9999-4999-8999-999999999999";
    render(<AiSreStep {...makeStepProps({ ...admin() })} />);
    open(/Grafana/);
    type("Grafana URL", "https://g.example.com");
    fireEvent.click(screen.getByRole("button", { name: "Save and test" }));
    expect(await screen.findByText("Project changed in another tab")).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("toggling a type closes its form; read-only hides the forms", () => {
    const { rerender } = render(<AiSreStep {...makeStepProps({ ...admin() })} />);
    open(/GitHub/);
    expect(screen.getByTestId("setup-connector-form-github")).toBeTruthy();
    open(/GitHub/);
    expect(screen.queryByTestId("setup-connector-form-github")).toBeNull();
    rerender(<AiSreStep {...makeStepProps({ ...admin(), readOnly: true })} />);
    expect(screen.queryByRole("group", { name: "Connector types" })).toBeNull();
  });

  it("counts connectors saved earlier and links the private agent page and services", () => {
    render(<AiSreStep {...makeStepProps({ ...admin(), draft: { aiSre: { connectorIds: [CID], services: [] } } })} />);
    expect(screen.getByText("1 saved earlier")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Set up a private agent" }).getAttribute("href")).toBe("/org-admin?tab=private-agents");
    expect(screen.getByRole("link", { name: "Manage services" }).getAttribute("href")).toBe("/services");
  });

  it("suggests one service from the app host and stores it in the draft", () => {
    const d = drafting({ app: { url: "https://app.example.com/" } });
    const { rerender } = render(<AiSreStep {...makeStepProps({ ...admin(), patchDraft: d.patchDraft, draft: d.get() })} />);
    fireEvent.click(screen.getByLabelText("Create a service named app.example.com"));
    expect(d.get().aiSre?.services).toEqual([{ name: "app.example.com" }]);
    rerender(<AiSreStep {...makeStepProps({ ...admin(), patchDraft: d.patchDraft, draft: d.get() })} />);
    expect(screen.getByLabelText("Create a service named app.example.com")).toBeChecked();
    fireEvent.click(screen.getByLabelText("Create a service named app.example.com"));
    expect(d.get().aiSre?.services).toEqual([]);
  });

  it("asks for an app URL when there is none", () => {
    render(<AiSreStep {...makeStepProps({ ...admin() })} />);
    expect(screen.getByText(/Add your app URL in the first step/)).toBeTruthy();
  });
});
