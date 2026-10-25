import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { McpConsent, type McpConsentProject } from "./mcp-consent";

const projects: McpConsentProject[] = [
  { id: "p-1", name: "Alpha", organizationName: "Org", isDefault: false },
  { id: "p-2", name: "Default Project", organizationName: "Org", isDefault: true },
];
type ClientProp = React.ComponentProps<typeof McpConsent>["client"];
const unverified: ClientProp = { name: "My Agent", verifiedHost: null, redirectHost: "127.0.0.1:8765" };
const fetchMock = jest.fn();
const navigate = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  navigate.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

function setup(client: ClientProp = unverified, list = projects) {
  render(
    <McpConsent oauthQuery="client_id=c&sig=s&exp=1" userEmail="me@example.com" projects={list} client={client} navigate={navigate} />,
  );
}
const reply = (status: number, body: unknown) =>
  fetchMock.mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });

describe("McpConsent", () => {
  it("says what the app can and cannot do", () => {
    setup();
    expect(screen.getByRole("heading", { name: /connect my agent/i })).toBeInTheDocument();
    expect(screen.getByText(/read tests, jobs, runs, monitors, requirements, status pages, services, incidents and investigations/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot change anything, run tests, or read secrets/i)).toBeInTheDocument();
    expect(screen.getByText(/signed in as me@example.com/i)).toBeInTheDocument();
    expect(screen.getByText(/127\.0\.0\.1:8765/)).toBeInTheDocument();
  });

  it("warns about an app that registered itself, and names the publisher of a verified one", () => {
    setup(unverified);
    expect(screen.getByText(/unverified app/i)).toBeInTheDocument();
  });

  it("shows the publisher host for a metadata-document client", () => {
    setup({ name: "Agent Co", verifiedHost: "agent.example.com", clientIdUrl: "https://agent.example.com/client.json", redirectHost: "agent.example.com" });
    expect(screen.getByText("agent.example.com", { selector: "span.font-medium" })).toBeInTheDocument();
    // The whole identifier, not just a host a user might trust (raw.githubusercontent.com, gist, vercel.app).
    expect(screen.getByText("https://agent.example.com/client.json")).toBeInTheDocument();
    expect(screen.queryByText(/unverified app/i)).not.toBeInTheDocument();
  });

  it("renders a hostile app name as text, never as markup", () => {
    setup({ name: "<img src=x onerror=alert(1)>", verifiedHost: null, redirectHost: null });
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByRole("heading", { name: /<img src=x onerror=alert\(1\)>/ })).toBeInTheDocument();
  });

  it("preselects the default project and approves the chosen one", async () => {
    reply(200, { url: "http://127.0.0.1:8765/callback?code=abc" });
    setup();
    expect(screen.getByRole("radio", { name: /default project/i })).toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: /alpha/i }));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("http://127.0.0.1:8765/callback?code=abc"));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/oauth/mcp/consent");
    expect(JSON.parse(init.body)).toEqual({ accept: true, oauth_query: "client_id=c&sig=s&exp=1", projectId: "p-1" });
  });

  it("denies without sending a project", async () => {
    reply(200, { url: "http://127.0.0.1:8765/callback?error=access_denied" });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ accept: false, oauth_query: "client_id=c&sig=s&exp=1" });
  });

  it.each([
    ["forbidden", /no longer have access/i],
    ["impersonation_not_allowed", /impersonating/i],
    ["consent_failed", /expired or was already used/i],
    ["something_new", /something went wrong/i],
  ])("explains %s and lets the user try again", async (error, message) => {
    reply(error === "forbidden" ? 403 : 400, { error });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
  });

  it("recovers from a network failure", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/network error/i);
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
  });

  it("does not send twice while a decision is in flight", async () => {
    let resolve: (v: unknown) => void = () => undefined;
    fetchMock.mockReturnValue(new Promise((r) => { resolve = r; }));
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(screen.getByRole("button", { name: /connecting/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Deny" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /connecting/i }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve({ ok: true, status: 200, json: async () => ({ url: "http://127.0.0.1:8765/callback?code=abc" }) });
    await waitFor(() => expect(navigate).toHaveBeenCalled());
  });
});
