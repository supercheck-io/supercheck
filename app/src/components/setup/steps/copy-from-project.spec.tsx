import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CopyFromProject } from "./copy-from-project";

const TARGET = "11111111-1111-4111-8111-111111111111";
const OTHER = "33333333-3333-4333-8333-333333333333";
const proj = (id: string, name: string, userRole = "project_admin", organizationId = "org-1") => ({ id, name, organizationId, isDefault: false, userRole });
let projects = [proj(TARGET, "Web"), proj(OTHER, "Prod")];
jest.mock("@/hooks/use-project-context", () => ({ useProjectContextSafe: () => ({ projects }) }));

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
});
const fetchMock = jest.fn();
const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });
beforeEach(() => {
  projects = [proj(TARGET, "Web"), proj(OTHER, "Prod")];
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});
const pickSource = (kind: string) => {
  fireEvent.keyDown(screen.getByLabelText("Project"), { key: "Enter" });
  fireEvent.click(screen.getByRole("option", { name: "Prod" }));
  return screen.getByRole("button", { name: new RegExp(`Copy all ${kind} from Prod`) });
};
const renderIt = (kind: "providers" | "connectors" = "providers", onCopied = jest.fn()) => {
  render(<CopyFromProject kind={kind} setupProjectId={TARGET} disabled={false} onCopied={onCopied} />);
  return onCopied;
};

describe("CopyFromProject", () => {
  it("renders nothing when the org has no other project the user can copy from", () => {
    projects = [proj(TARGET, "Web")];
    const { container } = render(<CopyFromProject kind="providers" setupProjectId={TARGET} disabled={false} onCopied={jest.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("ignores other orgs and viewers; editors cannot copy connectors", () => {
    projects = [proj(TARGET, "Web"), proj(OTHER, "Prod", "project_viewer"), proj("p3", "Foreign", "project_admin", "org-2")];
    const { container } = render(<CopyFromProject kind="providers" setupProjectId={TARGET} disabled={false} onCopied={jest.fn()} />);
    expect(container.firstChild).toBeNull();
    projects = [proj(TARGET, "Web"), proj(OTHER, "Prod", "project_editor")];
    const again = render(<CopyFromProject kind="connectors" setupProjectId={TARGET} disabled={false} onCopied={jest.fn()} />);
    expect(again.container.firstChild).toBeNull();
  });

  it("copies all alert channels, shows per-item results and reports copied and adopted ids", async () => {
    fetchMock.mockReturnValue(json({ providers: [{ sourceId: "a", id: "n1", status: "copied" }, { sourceId: "b", id: "n2", status: "adopted" }, { sourceId: "c", status: "failed", error: "Provider not found in the source project" }], connectors: [] }));
    const onCopied = renderIt();
    expect(screen.getByRole("button", { name: "Copy all alert channels" })).toBeDisabled();
    fireEvent.click(pickSource("alert channels"));
    await screen.findByText("Copied");
    expect(fetchMock).toHaveBeenCalledWith(`/api/projects/${TARGET}/setup/copy`, expect.objectContaining({ body: JSON.stringify({ sourceProjectId: OTHER, allProviders: true }) }));
    expect(screen.getByText("Already there")).toBeTruthy();
    expect(screen.getByText("Failed")).toBeTruthy();
    expect(screen.getByText("Provider not found in the source project")).toBeTruthy();
    expect(onCopied).toHaveBeenCalledWith(["n1", "n2"]);
  });

  it("limits the request to the remaining capacity and disables copying when there is none", async () => {
    fetchMock.mockReturnValue(json({ providers: [{ sourceId: "a", id: "n1", status: "copied" }], connectors: [] }));
    const { rerender } = render(<CopyFromProject kind="providers" setupProjectId={TARGET} disabled={false} capacity={2} onCopied={jest.fn()} />);
    expect(screen.getByText(/at most 2 will be copied/)).toBeTruthy();
    fireEvent.click(pickSource("alert channels"));
    await screen.findByText("Copied");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ sourceProjectId: OTHER, allProviders: true, limit: 2 });
    rerender(<CopyFromProject kind="providers" setupProjectId={TARGET} disabled={false} capacity={0} onCopied={jest.fn()} />);
    expect(screen.getByText(/limit is reached/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Copy all alert channels from Prod/ })).toBeDisabled();
  });

  it("copies all connectors with allConnectors", async () => {
    fetchMock.mockReturnValue(json({ providers: [], connectors: [{ sourceId: "a", id: "c1", status: "copied" }] }));
    const onCopied = renderIt("connectors");
    fireEvent.click(pickSource("connectors"));
    await waitFor(() => expect(onCopied).toHaveBeenCalledWith(["c1"]));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ sourceProjectId: OTHER, allConnectors: true });
  });

  it("shows item names, falling back to a numbered label", async () => {
    fetchMock.mockReturnValue(json({ providers: [], connectors: [{ sourceId: "a", id: "c1", status: "copied", name: "GitHub (copied)" }, { sourceId: "b", status: "failed", error: "x" }] }));
    renderIt("connectors");
    fireEvent.click(pickSource("connectors"));
    expect(await screen.findByText("GitHub (copied)")).toBeTruthy();
    expect(screen.getByText("Connector 2")).toBeTruthy();
  });

  it("says when the source has nothing to copy", async () => {
    fetchMock.mockReturnValue(json({ providers: [], connectors: [] }));
    renderIt();
    fireEvent.click(pickSource("alert channels"));
    expect(await screen.findByText(/has no alert channels to copy/)).toBeTruthy();
  });

  it("shows the server error (403) and a network failure, without calling onCopied", async () => {
    fetchMock.mockReturnValueOnce(json({ error: "Insufficient permissions" }, 403));
    const onCopied = renderIt();
    const button = pickSource("alert channels");
    fireEvent.click(button);
    expect(await screen.findByText("Insufficient permissions")).toBeTruthy();
    fetchMock.mockReturnValueOnce(Promise.reject(new Error("net")));
    fireEvent.click(button);
    expect(await screen.findByText(/Check your connection/)).toBeTruthy();
    expect(onCopied).not.toHaveBeenCalled();
  });
});
