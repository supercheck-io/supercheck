import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DeviceApproval } from "./device-approval";

const projects = [
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

  it("handles network failure", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    const { approve, input } = setup();
    fireEvent.change(input, { target: { value: "BCDF-GHJK" } });
    fireEvent.click(approve);
    expect(await screen.findByRole("alert")).toHaveTextContent(/network error/i);
  });
});
