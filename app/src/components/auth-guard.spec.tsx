import { render, screen } from "@testing-library/react";
import { AuthGuard } from "./auth-guard";

const replace = jest.fn();
let mockSession: { data: unknown; isPending: boolean; error: unknown };
jest.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
jest.mock("@/utils/auth-client", () => ({ useSession: () => mockSession }));
jest.mock("@/components/shared/supercheck-loading", () => ({
  SupercheckLoading: ({ message }: { message: string }) => <div>{message}</div>,
}));

const initialSession = { user: { id: "u1", name: "Ada", email: "ada@example.com" } };
const renderGuard = (initial: typeof initialSession | null = initialSession) =>
  render(<AuthGuard initialSession={initial}><div>protected</div></AuthGuard>);

describe("AuthGuard", () => {
  beforeEach(() => replace.mockReset());

  it("keeps the server-validated session when the client check fails, instead of looping to sign-in", () => {
    mockSession = { data: null, isPending: false, error: { status: 0, message: "Failed to fetch" } };
    renderGuard();
    expect(screen.getByText("protected")).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it("redirects when the check completes without a session (expired)", () => {
    mockSession = { data: null, isPending: false, error: null };
    renderGuard();
    expect(screen.queryByText("protected")).toBeNull();
    expect(replace).toHaveBeenCalledWith("/sign-in");
  });

  it("redirects when the check fails and the server had no session either", () => {
    mockSession = { data: null, isPending: false, error: { status: 500 } };
    renderGuard(null);
    expect(screen.queryByText("protected")).toBeNull();
    expect(replace).toHaveBeenCalledWith("/sign-in");
  });

  it("renders for a confirmed session", () => {
    mockSession = { data: initialSession, isPending: false, error: null };
    renderGuard(null);
    expect(screen.getByText("protected")).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });
});
