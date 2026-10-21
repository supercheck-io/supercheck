import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { signUp } from "@/utils/auth-client";
import SignUpPage from "./page";

const push = jest.fn();
const mockQuery = { value: "" };
const assign = jest.fn();
jest.mock("@/lib/auth/hard-navigate", () => ({ hardNavigate: (url: string) => assign(url) }));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(mockQuery.value),
}));
jest.mock("@/utils/auth-client", () => ({
  signUp: { email: jest.fn() },
  sendVerificationEmail: jest.fn(),
}));
jest.mock("@/hooks/use-project-context", () => ({ clearProjectsCache: jest.fn() }));
jest.mock("@/lib/project-navigation", () => ({ announceProjectChange: jest.fn(), reloadProjectContext: jest.fn() }));
jest.mock("@/hooks/use-app-config", () => ({
  useAppConfig: () => ({
    isCloudHosted: false,
    isSelfHosted: true,
    isFetched: true,
    error: null,
    isSignupEnabled: true,
    allowedEmailDomains: [],
  }),
}));
jest.mock("@/components/auth/turnstile-captcha", () => ({ TurnstileCaptcha: () => null }));
jest.mock("@/hooks/use-captcha", () => ({
  useCaptcha: () => ({
    captchaToken: null, captchaError: null, captchaRef: { current: null },
    handleCaptchaSuccess: jest.fn(), handleCaptchaError: jest.fn(), handleCaptchaExpire: jest.fn(),
  }),
}));

const signedRequest = new URLSearchParams({
  response_type: "code",
  client_id: "client-1",
  redirect_uri: "http://127.0.0.1:8765/callback",
  scope: "mcp:read",
  exp: "1792580000",
  sig: "abc",
});

describe("sign-up page: connecting an MCP client (self-hosted, signed in straight away)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    (signUp.email as jest.Mock).mockResolvedValue({ error: null });
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }) as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  async function signUpNewUser() {
    render(<SignUpPage />);
    fireEvent.change(await screen.findByLabelText("Your name"), { target: { value: "Jane Doe" } });
    fireEvent.change(screen.getByTestId("signup-email-input"), { target: { value: "jane@example.com" } });
    fireEvent.change(screen.getByLabelText("Create password"), { target: { value: "Passw0rdX-long" } });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));
  }

  it("resumes the connection the new user came to approve", async () => {
    mockQuery.value = signedRequest.toString();
    await signUpNewUser();
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(assign).toHaveBeenCalledWith(`/api/auth/oauth2/authorize?${signedRequest}`);
    expect(push).not.toHaveBeenCalledWith("/");
  });

  it("does not put the signed request in the verification callback URL", async () => {
    mockQuery.value = signedRequest.toString();
    await signUpNewUser();
    // Let the whole flow finish (it pauses briefly before redirecting) so it cannot leak into the next test.
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    const { callbackURL } = (signUp.email as jest.Mock).mock.calls[0][0] as { callbackURL: string };
    expect(callbackURL).not.toContain("sig=");
    expect(callbackURL).not.toContain("authorize");
  });

  it("goes to the dashboard as before when there is nothing to resume", async () => {
    mockQuery.value = "";
    await signUpNewUser();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(assign).not.toHaveBeenCalled();
  });

  it("ignores a query that is not a signed authorization request", async () => {
    mockQuery.value = "response_type=code&client_id=x";
    await signUpNewUser();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(assign).not.toHaveBeenCalled();
  });
});
