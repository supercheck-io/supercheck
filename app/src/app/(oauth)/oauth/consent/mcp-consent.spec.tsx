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

  it("tells the user a narrower approval keeps the earlier access, only for the chosen project", () => {
    const { unmount } = render(<McpConsent oauthQuery="q" userEmail="me@example.com" projects={projects} client={unverified} navigate={navigate} keepsEarlierAccessProjectIds={[projects[1].id]} />);
    expect(screen.getByText(/keeps the access you approved earlier\. Disconnect it in Connected apps to reduce access/i)).toBeInTheDocument();
    unmount();
    render(<McpConsent oauthQuery="q" userEmail="me@example.com" projects={projects} client={unverified} navigate={navigate} keepsEarlierAccessProjectIds={["other"]} />);
    expect(screen.queryByText(/keeps the access you approved earlier/i)).toBeNull();
  });

  it("lists the optional write and AI SRE access only when requested", () => {
    render(<McpConsent oauthQuery="q" userEmail="me@example.com" projects={projects} client={unverified} navigate={navigate} canWriteIncidents canRunSre />);
    expect(screen.getByText(/assign, acknowledge and resolve incidents/i)).toBeInTheDocument();
    expect(screen.getByText(/start ai sre triage/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot change anything else/i)).toBeInTheDocument();
  });

  it.each([
    ["write only", { canWriteIncidents: true }, /assign, acknowledge and resolve incidents/i, /start ai sre triage/i],
    ["SRE only", { canRunSre: true }, /start ai sre triage/i, /assign, acknowledge and resolve incidents/i],
  ])("discloses only the requested optional access (%s)", (_n, flags, present, absent) => {
    render(<McpConsent oauthQuery="q" userEmail="me@example.com" projects={projects} client={unverified} navigate={navigate} {...flags} />);
    expect(screen.getByText(present)).toBeInTheDocument();
    expect(screen.queryByText(absent)).not.toBeInTheDocument();
  });

  it("warns about an app that registered itself, and names the publisher of a verified one", () => {
    setup(unverified);
    expect(screen.getByText(/unverified app/i)).toBeInTheDocument();
    // The warning is not in the scrolling region, and only errors use role=alert.
    expect(screen.getByText(/unverified app/i).closest(".overflow-y-auto")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
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

  it("names a shared organization once in the legend instead of on every row", () => {
    setup();
    expect(screen.getByText(/^Project/, { selector: "legend" })).toHaveTextContent("Project · Org");
    expect(screen.queryAllByText("Org")).toHaveLength(0);
  });

  it("shows each project's organization on its row when they differ", () => {
    setup(unverified, [
      { id: "p-1", name: "Alpha", organizationName: "Org A", isDefault: true },
      { id: "p-2", name: "Beta", organizationName: "Org B", isDefault: false },
    ]);
    expect(screen.getByText(/^Project/, { selector: "legend" })).not.toHaveTextContent("·");
    expect(screen.getByText("Org A")).toBeInTheDocument();
    expect(screen.getByText("Org B")).toBeInTheDocument();
  });

  it("shows the organization in the legend for a single project, and nothing when it is blank", () => {
    const one = render(<McpConsent oauthQuery="q" userEmail="a@b.c" projects={[projects[0]]} client={unverified} navigate={navigate} />);
    expect(screen.getByText(/^Project/, { selector: "legend" })).toHaveTextContent("Project · Org");
    one.unmount();
    setup(unverified, [{ id: "p-9", name: "Solo", organizationName: "", isDefault: true }]);
    expect(screen.getByText(/^Project/, { selector: "legend" })).not.toHaveTextContent("·");
  });

  it("shows a failed approval next to the buttons, outside the scrolling content", async () => {
    reply(403, { error: "forbidden" });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect((await screen.findByRole("alert")).closest(".overflow-y-auto")).toBeNull();
  });

  it("keeps many projects in a scrolling list and Approve outside it", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `p-${i}`, name: `Project ${i}`, organizationName: "Org", isDefault: i === 0 }));
    setup(unverified, many);
    const list = screen.getByRole("radiogroup");
    expect(list).toHaveClass("overflow-y-auto");
    // Approve, Deny and the error stay outside every scrolling region.
    expect(screen.getByRole("button", { name: "Approve" }).closest(".overflow-y-auto")).toBeNull();
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
    ["consent_scopes_not_restored", /fewer permissions/i],
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
