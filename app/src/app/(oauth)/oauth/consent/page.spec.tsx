import { render, screen } from "@testing-library/react";

const mockGetSession = jest.fn();
const mockSecret = "test-secret";
const mockVerify = jest.fn();
const mockImpersonated = jest.fn();
const mockClient = jest.fn();
const mockProjects = jest.fn();
const mockRedirect = jest.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
let mockEnabled = true;

jest.mock("next/headers", () => ({ headers: async () => new Headers() }));
jest.mock("next/navigation", () => ({ redirect: (url: string) => mockRedirect(url) }));
jest.mock("@better-auth/oauth-provider", () => ({ verifyOAuthQueryParams: (...a: unknown[]) => mockVerify(...a) }));
jest.mock("@/utils/auth", () => ({
  auth: { $context: Promise.resolve({ secret: "test-secret" }), api: { getSession: (...a: unknown[]) => mockGetSession(...a) } },
}));
jest.mock("@/lib/rbac/middleware", () => ({ isImpersonatedSession: (...a: unknown[]) => mockImpersonated(...a) }));
jest.mock("@/lib/mcp/config", () => ({ MCP_READ_SCOPE: "mcp:read", isMcpServerEnabled: () => mockEnabled }));
jest.mock("@/lib/mcp/auth-api", () => ({ mcpAuthApi: () => ({ getOAuthClientPublic: (...a: unknown[]) => mockClient(...a) }) }));
jest.mock("@/lib/mcp/project-selection", () => ({ listConnectableProjects: (...a: unknown[]) => mockProjects(...a) }));
jest.mock("./mcp-consent", () => ({
  McpConsent: (props: unknown) => <pre data-testid="consent">{JSON.stringify(props)}</pre>,
}));

import McpConsentPage from "./page";

const signed = {
  response_type: "code",
  client_id: "https://agent.example.com/client.json",
  redirect_uri: "https://agent.example.com/cb",
  scope: "mcp:read offline_access",
  exp: "1792580000",
  sig: "abc",
  ba_param: ["client_id", "sig"],
};

async function renderPage(params: Record<string, string | string[] | undefined> = signed) {
  render(await McpConsentPage({ searchParams: Promise.resolve(params) }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockEnabled = true;
  mockVerify.mockResolvedValue(true);
  mockGetSession.mockResolvedValue({ user: { id: "u1", email: "me@example.com" }, session: { id: "s1" } });
  mockImpersonated.mockResolvedValue(false);
  mockClient.mockResolvedValue({ client_id: signed.client_id, client_name: "Agent Co" });
  mockProjects.mockResolvedValue([
    { id: "p1", name: "Alpha", organizationName: "Org", isDefault: true },
    { id: "p2", name: "Beta", organizationName: "Org", isDefault: false },
  ]);
});

describe("MCP consent page", () => {
  it("shows the connect screen with the user's projects and the verified publisher", async () => {
    await renderPage();
    const props = JSON.parse(screen.getByTestId("consent").textContent as string);
    expect(props.userEmail).toBe("me@example.com");
    expect(props.projects.map((p: { id: string }) => p.id)).toEqual(["p1", "p2"]);
    expect(props.client).toEqual({
      name: "Agent Co",
      verifiedHost: "agent.example.com",
      clientIdUrl: "https://agent.example.com/client.json",
      redirectHost: "agent.example.com",
    });
    expect(mockProjects).toHaveBeenCalledWith("u1");
  });

  it("rebuilds the signed query with repeated keys and verifies it against the auth secret", async () => {
    await renderPage();
    const [query, secret] = mockVerify.mock.calls[0] as [string, string];
    expect(secret).toBe(mockSecret);
    const params = new URLSearchParams(query);
    expect(params.getAll("ba_param")).toEqual(["client_id", "sig"]);
    expect(params.get("sig")).toBe("abc");
    expect(JSON.parse(screen.getByTestId("consent").textContent as string).oauthQuery).toBe(query);
  });

  it("does not exist when the MCP server is disabled", async () => {
    mockEnabled = false;
    await renderPage();
    expect(screen.getByText(/connecting apps is not enabled/i)).toBeInTheDocument();
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("rejects a request whose signature does not verify, before looking anything up", async () => {
    mockVerify.mockResolvedValue(false);
    await renderPage();
    expect(screen.getByText(/no longer valid/i)).toBeInTheDocument();
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(mockClient).not.toHaveBeenCalled();
  });

  it("rejects a request with no query at all", async () => {
    await renderPage({});
    expect(screen.getByText(/no longer valid/i)).toBeInTheDocument();
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("sends an anonymous visitor to sign in carrying the signed request so it can resume", async () => {
    mockGetSession.mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow(/^REDIRECT:\/sign-in\?/);
    expect(mockRedirect.mock.calls[0][0]).toContain("sig=abc");
  });

  it("refuses to connect an app while impersonating", async () => {
    mockImpersonated.mockResolvedValue(true);
    await renderPage();
    expect(screen.getByText(/unavailable while impersonating/i)).toBeInTheDocument();
    expect(mockProjects).not.toHaveBeenCalled();
  });

  it("rejects an unknown client", async () => {
    mockClient.mockResolvedValue(null);
    await renderPage();
    expect(screen.getByText(/unknown application/i)).toBeInTheDocument();
  });

  it("rejects a request that does not ask for the read scope", async () => {
    await renderPage({ ...signed, scope: "offline_access" });
    expect(screen.getByText(/nothing to approve/i)).toBeInTheDocument();
    expect(mockProjects).not.toHaveBeenCalled();
  });

  it("explains when the user has no project to share", async () => {
    mockProjects.mockResolvedValue([]);
    await renderPage();
    expect(screen.getByText(/no project to connect/i)).toBeInTheDocument();
  });

  it("treats a dynamically registered client as unverified and truncates a long name", async () => {
    mockClient.mockResolvedValue({ client_name: `  ${"x".repeat(200)}  ` });
    await renderPage({ ...signed, client_id: "randomDcrId123" });
    const props = JSON.parse(screen.getByTestId("consent").textContent as string);
    expect(props.client.verifiedHost).toBeNull();
    expect(props.client.name.length).toBeLessThanOrEqual(80);
    expect(props.client.name.endsWith("…")).toBe(true);
  });

  it("strips invisible control and bidirectional characters from the app name", async () => {
    mockClient.mockResolvedValue({ client_name: "Sup\u202Eercheck\u200B Official\u0000" });
    await renderPage({ ...signed, client_id: "randomDcrId123" });
    const props = JSON.parse(screen.getByTestId("consent").textContent as string);
    expect(props.client.name).toBe("Supercheck Official");
  });

  it("falls back to a generic name when nothing printable remains", async () => {
    mockClient.mockResolvedValue({ client_name: "\u200B\u202E" });
    await renderPage({ ...signed, client_id: "randomDcrId123" });
    expect(JSON.parse(screen.getByTestId("consent").textContent as string).client.name).toBe("An application");
  });

  it("falls back to the scheme for a custom-scheme redirect", async () => {
    await renderPage({ ...signed, redirect_uri: "cursor://anysphere.cursor-mcp/oauth/callback" });
    const props = JSON.parse(screen.getByTestId("consent").textContent as string);
    expect(props.client.redirectHost).toBe("anysphere.cursor-mcp");
  });
});
