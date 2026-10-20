import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DeviceApproval, type DeviceProjectOption } from "./device-approval";

const projects: DeviceProjectOption[] = [
  { id: "p-1", name: "Alpha", organizationName: "Org", isDefault: false },
  { id: "p-2", name: "Default Project", organizationName: "Org", isDefault: true },
];
const client = { name: "supercheck-cli", version: "0.4.0", hostname: "laptop", requestIp: "203.0.113.9" };
const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

function setup() {
  render(<DeviceApproval userCode="BCDF-GHJK" userEmail="me@example.com" projects={projects} client={client} />);
  const approve = screen.getByRole("button", { name: "Approve" });
  const input = screen.getByLabelText(/type the code/i);
  return { approve, input };
}

describe("DeviceApproval plan step", () => {
  const withPlan = (a: DeviceProjectOption["plan"], b: DeviceProjectOption["plan"] = { active: true, canPurchase: true }): DeviceProjectOption[] => [
    { ...projects[0], plan: a },
    { ...projects[1], plan: b },
  ];
  const view = (list: DeviceProjectOption[]) =>
    render(<DeviceApproval userCode="BCDF-GHJK" userEmail="me@example.com" projects={list} client={client} />);

  it("shows nothing when the plan is active, unknown or not reported", () => {
    for (const plan of [{ active: true, canPurchase: true }, { active: null, canPurchase: true }, undefined]) {
      const { unmount } = view(withPlan(plan, plan));
      expect(screen.queryByRole("note")).not.toBeInTheDocument();
      unmount();
    }
  });

  it("explains a missing plan without blocking approval", () => {
    view(withPlan({ active: false, canPurchase: true }, { active: false, canPurchase: true }));
    expect(screen.getByRole("note")).toHaveTextContent(/no active plan/i);
    expect(screen.getByRole("note")).toHaveTextContent(/approving does not depend on it/i);
    fireEvent.change(screen.getByLabelText(/type the code/i), { target: { value: "BCDF-GHJK" } });
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
  });

  it("follows the selected project's organization", () => {
    view(withPlan({ active: false, canPurchase: true }, { active: true, canPurchase: true }));
    // default project (index 1) is active, so no notice until the inactive one is chosen
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Alpha/));
    expect(screen.getByRole("note")).toHaveTextContent(/no active plan/i);
  });

  it("switches to the selected project's organization before opening checkout in a new tab", async () => {
    const tab = { opener: "parent", location: { href: "about:blank" }, close: jest.fn() } as unknown as Window;
    const open = jest.spyOn(window, "open").mockReturnValue(tab);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    view(withPlan({ active: false, canPurchase: true }, { active: true, canPurchase: true }));
    fireEvent.click(screen.getByLabelText(/Alpha/));
    fireEvent.click(screen.getByRole("button", { name: "Choose a plan" }));
    await waitFor(() => expect(tab.location.href).toBe("/subscribe"));
    // opened synchronously in the click (popup-blocker safe); navigated only after the switch succeeded
    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(tab.opener).toBeNull();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/projects/switch");
    expect(JSON.parse(init.body)).toEqual({ projectId: "p-1" });
    expect(await screen.findByText(/billing opened in a new tab/i)).toBeInTheDocument();
    // the consent page is untouched: no approval was sent
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/device/approve"))).toBe(false);
    open.mockRestore();
  });

  it("never shows a billing message for a different project than the one it was opened for", async () => {
    const tab = { opener: "parent", location: { href: "about:blank" }, close: jest.fn() } as unknown as Window;
    const open = jest.spyOn(window, "open").mockReturnValue(tab);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    view(withPlan({ active: false, canPurchase: true }, { active: false, canPurchase: true }));
    fireEvent.click(screen.getByLabelText(/Alpha/));
    fireEvent.click(screen.getByRole("button", { name: "Choose a plan" }));
    expect(await screen.findByText(/billing opened in a new tab/i)).toBeInTheDocument();
    // choosing the other project must clear the message: billing was opened for the first organization only
    fireEvent.click(screen.getByLabelText(/Default Project/));
    expect(screen.queryByText(/billing opened in a new tab/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose a plan" })).toBeEnabled();
    open.mockRestore();
  });

  it("locks the project choice while billing is being opened", async () => {
    let release: (v: unknown) => void = () => {};
    fetchMock.mockReturnValue(new Promise((r) => { release = r; }));
    jest.spyOn(window, "open").mockReturnValue({ location: { href: "" } } as unknown as Window);
    view(withPlan({ active: false, canPurchase: true }, { active: false, canPurchase: true }));
    fireEvent.click(screen.getByRole("button", { name: "Choose a plan" }));
    expect(screen.getByRole("button", { name: /opening/i })).toBeDisabled();
    expect(screen.getByLabelText(/Alpha/)).toBeDisabled();
    release({ ok: true, json: async () => ({}) });
    await waitFor(() => expect(screen.getByLabelText(/Alpha/)).toBeEnabled());
  });

  it("offers a link when the browser blocks the new tab, and reports a failed switch", async () => {
    const open = jest.spyOn(window, "open").mockReturnValue(null);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    const { unmount } = view(withPlan({ active: false, canPurchase: true }, { active: false, canPurchase: true }));
    fireEvent.click(screen.getByRole("button", { name: "Choose a plan" }));
    expect(await screen.findByRole("link", { name: /open billing/i })).toHaveAttribute("href", "/subscribe");
    unmount();
    const tab = { location: { href: "about:blank" }, close: jest.fn() } as unknown as Window;
    open.mockReturnValue(tab);
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    view(withPlan({ active: false, canPurchase: true }, { active: false, canPurchase: true }));
    fireEvent.click(screen.getByRole("button", { name: "Choose a plan" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not open billing/i);
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.href).toBe("about:blank");
    open.mockRestore();
  });

  it("falls back to the link when the blank tab is closed or refuses navigation after the switch", async () => {
    const tab = { closed: false, close: jest.fn() } as unknown as Window;
    Object.defineProperty(tab, "location", { get: () => { throw new Error("closed"); } });
    const open = jest.spyOn(window, "open").mockReturnValue(tab);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    view(withPlan({ active: false, canPurchase: true }, { active: false, canPurchase: true }));
    fireEvent.click(screen.getByRole("button", { name: "Choose a plan" }));
    expect(await screen.findByRole("link", { name: /open billing/i })).toHaveAttribute("href", "/subscribe");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    open.mockRestore();
  });

  it("tells non-owners to ask an owner and offers no purchase button", () => {
    view(withPlan({ active: false, canPurchase: false }, { active: false, canPurchase: false }));
    expect(screen.queryByRole("button", { name: "Choose a plan" })).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/only an organization owner/i);
  });
});

describe("DeviceApproval", () => {
  it("shows who is asking and keeps Approve disabled until the code is retyped", () => {
    const { approve, input } = setup();
    expect(screen.getByText("me@example.com")).toBeInTheDocument();
    expect(screen.getByText("laptop")).toBeInTheDocument();
    expect(screen.getByText(/not verified/i)).toBeInTheDocument();
    expect(approve).toBeDisabled();
    fireEvent.change(input, { target: { value: "WRONG-CODE" } });
    expect(approve).toBeDisabled();
    fireEvent.change(input, { target: { value: "bcdf ghjk" } });
    expect(approve).toBeEnabled();
  });

  it("preselects the default project and approves exactly that project", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    const { approve, input } = setup();
    fireEvent.change(input, { target: { value: "BCDF-GHJK" } });
    fireEvent.click(approve);
    await waitFor(() => expect(screen.getByText(/you're connected/i)).toBeInTheDocument());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/auth/device/approve");
    expect(JSON.parse(init.body)).toEqual({ user_code: "BCDF-GHJK", project_id: "p-2" });
    expect(init.method).toBe("POST");
  });

  it("lets the person choose a different project", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    const { approve, input } = setup();
    fireEvent.click(screen.getByLabelText(/Alpha/));
    fireEvent.change(input, { target: { value: "BCDF-GHJK" } });
    fireEvent.click(approve);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).project_id).toBe("p-1");
  });

  it("denies without needing the code and sends no project", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    await waitFor(() => expect(screen.getByText(/request denied/i)).toBeInTheDocument());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/device/deny");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ user_code: "BCDF-GHJK" });
  });

  it.each([
    ["expired", /expired/i],
    ["forbidden", /not allowed/i],
    ["rate_limited", /too many requests/i],
    ["something_else", /something went wrong/i],
  ])("shows friendly copy for %s and allows retrying", async (code, copy) => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: code }) });
    const { approve, input } = setup();
    fireEvent.change(input, { target: { value: "BCDF-GHJK" } });
    fireEvent.click(approve);
    expect(await screen.findByRole("alert")).toHaveTextContent(copy);
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
  });

  it("explains impersonation refusals in plain words", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "impersonation_not_allowed" }) });
    const { approve, input } = setup();
    fireEvent.change(input, { target: { value: "BCDF-GHJK" } });
    fireEvent.click(approve);
    expect(await screen.findByRole("alert")).toHaveTextContent(/stop impersonating/i);
  });

  it("handles network failure", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    const { approve, input } = setup();
    fireEvent.change(input, { target: { value: "BCDF-GHJK" } });
    fireEvent.click(approve);
    expect(await screen.findByRole("alert")).toHaveTextContent(/network error/i);
  });
});
