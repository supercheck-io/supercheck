import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import InvitePage from "./page";

const mockReload = jest.fn();
const mockPush = jest.fn();
const mockSignOut = jest.fn(async (): Promise<{ error?: { message?: string } } | undefined> => undefined);
let mockSession: { user: { email: string } } | null = null;
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/utils/auth-client", () => ({ useSession: () => ({ data: mockSession }) }));
jest.mock("@/lib/auth/sign-out", () => ({ signOutAndClear: () => mockSignOut() }));
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
jest.mock("@/hooks/use-app-config", () => ({ useAppConfig: () => ({ isCloudHosted: false, isFetched: true, error: null }) }));
jest.mock("@/hooks/use-project-context", () => ({ clearProjectsCache: jest.fn() }));
jest.mock("@/lib/project-navigation", () => ({
  announceProjectChange: jest.fn(),
  reloadProjectContext: (...args: unknown[]) => mockReload(...args),
}));

const TOKEN = "01a149f7-ce26-70e2-997b-806e9f48d9de";

describe("invite accept page", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    jest.useFakeTimers();
    mockReload.mockReset();
    mockPush.mockReset();
    mockSignOut.mockClear();
    mockSession = null;
    global.fetch = jest.fn(async (_url: string, init?: { method?: string }) => ({
      json: async () =>
        init?.method === "POST"
          ? { success: true, data: { organizationName: "Acme", role: "project_editor", message: "ok" } }
          : { success: true, data: { organizationName: "Acme", role: "project_editor", expiresAt: "2099-01-01T00:00:00Z" } },
    })) as unknown as typeof fetch;
  });
  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
  });

  async function accept() {
    render(<InvitePage params={Promise.resolve({ token: TOKEN })} />);
    fireEvent.click(await screen.findByRole("button", { name: /accept invitation/i }));
    await screen.findByRole("button", { name: /go to dashboard/i });
  }

  it("lands on persona selection after the automatic redirect", async () => {
    await accept();
    expect(mockReload).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(3000); });
    expect(mockReload).toHaveBeenCalledWith(expect.any(Function), "/setup/welcome");
  });

  it("lands on persona selection from the button", async () => {
    await accept();
    fireEvent.click(screen.getByRole("button", { name: /go to dashboard/i }));
    expect(mockReload).toHaveBeenCalledWith(expect.any(Function), "/setup/welcome");
  });

  function mockInvite(opts: { post?: { status: number; body: Record<string, unknown> } }) {
    global.fetch = jest.fn(async (_url: string, init?: { method?: string }) =>
      init?.method === "POST"
        ? { status: opts.post?.status ?? 401, json: async () => opts.post?.body ?? { success: false, error: "Please sign in first to accept the invitation" } }
        : { status: 200, json: async () => ({ success: true, data: { organizationName: "Acme", role: "project_editor", expiresAt: "2099-01-01T00:00:00Z"} }) },
    ) as unknown as typeof fetch;
  }
  async function clickAccept() {
    render(<InvitePage params={Promise.resolve({ token: TOKEN })} />);
    fireEvent.click(await screen.findByRole("button", { name: /accept invitation/i }));
  }

  it("sends a signed-out invitee to sign-up without revealing whether an account exists", async () => {
    mockInvite({});
    await clickAccept();
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith(`/sign-up?invite=${TOKEN}`));
  });

  it("shows a sign-out state, and never redirects, when signed in as another account", async () => {
    mockSession = { user: { email: "other@example.com" } };
    mockInvite({ post: { status: 400, body: { success: false, error: "This invitation is for a different email address", code: "EMAIL_MISMATCH" } } });
    await clickAccept();
    expect(await screen.findByText("other@example.com")).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: /accept invitation/i })).toBeInTheDocument();
  });

  it("drops the token from the links when the invitation itself is invalid", async () => {
    global.fetch = jest.fn(async () => ({ json: async () => ({ success: false, error: "Invitation has expired", code: "INVITE_UNAVAILABLE" }) })) as unknown as typeof fetch;
    render(<InvitePage params={Promise.resolve({ token: TOKEN })} />);
    fireEvent.click(await screen.findByRole("button", { name: /go to sign in/i }));
    expect(mockPush).toHaveBeenCalledWith("/sign-in");
    fireEvent.click(screen.getByRole("button", { name: /create new account/i }));
    expect(mockPush).toHaveBeenCalledWith("/sign-up");
  });

  it("shows the sign-out error when the sign-out request rejects", async () => {
    mockSession = { user: { email: "other@example.com" } };
    mockSignOut.mockRejectedValueOnce(new Error("network down"));
    mockInvite({ post: { status: 400, body: { success: false, error: "x", code: "EMAIL_MISMATCH" } } });
    await clickAccept();
    fireEvent.click(await screen.findByRole("button", { name: /sign out/i }));
    expect(await screen.findByText("network down")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });

  it("keeps the token on the links when a valid invitation fails to accept", async () => {
    mockInvite({ post: { status: 400, body: { success: false, error: "Member limit reached" } } });
    await clickAccept();
    fireEvent.click(await screen.findByRole("button", { name: /go to sign in/i }));
    expect(mockPush).toHaveBeenCalledWith(`/sign-in?invite=${TOKEN}`);
  });

  it("stays on the wrong-account state when sign-out fails", async () => {
    mockSession = { user: { email: "other@example.com" } };
    mockSignOut.mockResolvedValueOnce({ error: { message: "nope" } } as never);
    mockInvite({ post: { status: 400, body: { success: false, error: "x", code: "EMAIL_MISMATCH" } } });
    await clickAccept();
    fireEvent.click(await screen.findByRole("button", { name: /sign out/i }));
    expect(await screen.findByText("nope")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });

  it("drops the token when accepting finds the invitation expired or used", async () => {
    mockInvite({ post: { status: 400, body: { success: false, error: "Invitation has expired", code: "INVITE_UNAVAILABLE" } } });
    await clickAccept();
    fireEvent.click(await screen.findByRole("button", { name: /go to sign in/i }));
    expect(mockPush).toHaveBeenCalledWith("/sign-in");
  });

  it("keeps the token on the recovery links after a transient load failure", async () => {
    global.fetch = jest.fn(async () => ({ status: 500, json: async () => ({ error: "Failed to fetch invitation details" }) })) as unknown as typeof fetch;
    render(<InvitePage params={Promise.resolve({ token: TOKEN })} />);
    fireEvent.click(await screen.findByRole("button", { name: /go to sign in/i }));
    expect(mockPush).toHaveBeenCalledWith(`/sign-in?invite=${TOKEN}`);
  });

  it("drops the token when the invitation no longer exists (404)", async () => {
    global.fetch = jest.fn(async () => ({ status: 404, json: async () => ({ error: "Invitation not found", code: "INVITE_UNAVAILABLE" }) })) as unknown as typeof fetch;
    render(<InvitePage params={Promise.resolve({ token: TOKEN })} />);
    fireEvent.click(await screen.findByRole("button", { name: /go to sign in/i }));
    expect(mockPush).toHaveBeenCalledWith("/sign-in");
  });

  it("treats a malformed token as a dead invitation without calling the API", async () => {
    render(<InvitePage params={Promise.resolve({ token: "../x" })} />);
    fireEvent.click(await screen.findByRole("button", { name: /go to sign in/i }));
    expect(mockPush).toHaveBeenCalledWith("/sign-in");
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
