import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import InvitePage from "./page";

const mockReload = jest.fn();
const mockPush = jest.fn();
const mockSignOut = jest.fn(async (): Promise<{ error?: { message?: string } } | undefined> => undefined);
let mockSession: { user: { email: string } } | null = null;
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/utils/auth-client", () => ({
  useSession: () => ({ data: mockSession }),
  signOut: () => mockSignOut(),
}));
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
    render(<InvitePage params={Promise.resolve({ token: "t" })} />);
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

  function mockInvite(opts: { hasAccount?: boolean; post?: { status: number; body: Record<string, unknown> } }) {
    global.fetch = jest.fn(async (_url: string, init?: { method?: string }) =>
      init?.method === "POST"
        ? { status: opts.post?.status ?? 401, json: async () => opts.post?.body ?? { success: false, error: "Please sign in first to accept the invitation" } }
        : { status: 200, json: async () => ({ success: true, data: { organizationName: "Acme", role: "project_editor", expiresAt: "2099-01-01T00:00:00Z", hasAccount: opts.hasAccount } }) },
    ) as unknown as typeof fetch;
  }
  async function clickAccept() {
    render(<InvitePage params={Promise.resolve({ token: "t" })} />);
    fireEvent.click(await screen.findByRole("button", { name: /accept invitation/i }));
  }

  it("sends a signed-out invitee with an existing account to sign-in", async () => {
    mockInvite({ hasAccount: true });
    await clickAccept();
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/sign-in?invite=t"));
  });

  it("sends a signed-out first-time invitee to sign-up", async () => {
    mockInvite({ hasAccount: false });
    await clickAccept();
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/sign-up?invite=t"));
  });

  it("shows a sign-out state, and never redirects, when signed in as another account", async () => {
    mockSession = { user: { email: "other@example.com" } };
    mockInvite({ hasAccount: false, post: { status: 400, body: { success: false, error: "This invitation is for a different email address", code: "EMAIL_MISMATCH" } } });
    await clickAccept();
    expect(await screen.findByText("other@example.com")).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: /accept invitation/i })).toBeInTheDocument();
  });

  it("drops the token from the links when the invitation itself is invalid", async () => {
    global.fetch = jest.fn(async () => ({ json: async () => ({ success: false, error: "Invitation has expired" }) })) as unknown as typeof fetch;
    render(<InvitePage params={Promise.resolve({ token: "t" })} />);
    fireEvent.click(await screen.findByRole("button", { name: /go to sign in/i }));
    expect(mockPush).toHaveBeenCalledWith("/sign-in");
    fireEvent.click(screen.getByRole("button", { name: /create new account/i }));
    expect(mockPush).toHaveBeenCalledWith("/sign-up");
  });

  it("keeps the token on the links when a valid invitation fails to accept", async () => {
    mockInvite({ post: { status: 400, body: { success: false, error: "Member limit reached" } } });
    await clickAccept();
    fireEvent.click(await screen.findByRole("button", { name: /go to sign in/i }));
    expect(mockPush).toHaveBeenCalledWith("/sign-in?invite=t");
  });

  it("stays on the wrong-account state when sign-out fails", async () => {
    mockSession = { user: { email: "other@example.com" } };
    mockSignOut.mockResolvedValueOnce({ error: { message: "nope" } } as never);
    mockInvite({ post: { status: 400, body: { success: false, error: "x", code: "EMAIL_MISMATCH" } } });
    await clickAccept();
    fireEvent.click(await screen.findByRole("button", { name: /sign out/i }));
    expect(await screen.findByText("nope")).toBeInTheDocument();
  });
});
