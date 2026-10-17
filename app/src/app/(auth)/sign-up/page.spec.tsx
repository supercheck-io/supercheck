import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { signUp } from "@/utils/auth-client";
import SignUpPage from "./page";

const push = jest.fn();
const replace = jest.fn();
const VALID_TOKEN = "01a149f7-ce26-70e2-997b-806e9f48d9de";
// Prefixed `mock` so jest.mock factories may reference it.
const mockQuery = { value: `invite=${VALID_TOKEN}` };

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => new URLSearchParams(mockQuery.value),
}));
jest.mock("@/utils/auth-client", () => ({
  signUp: { email: jest.fn() },
  sendVerificationEmail: jest.fn(),
}));
jest.mock("@/hooks/use-project-context", () => ({ clearProjectsCache: jest.fn() }));
jest.mock("@/lib/project-navigation", () => ({
  announceProjectChange: jest.fn(),
  reloadProjectContext: jest.fn(),
}));
jest.mock("@/hooks/use-app-config", () => ({
  useAppConfig: () => ({
    isCloudHosted: true,
    isSelfHosted: false,
    isFetched: true,
    error: null,
    isSignupEnabled: true,
    allowedEmailDomains: [],
  }),
}));
jest.mock("@/components/auth/turnstile-captcha", () => ({ TurnstileCaptcha: () => null }));
jest.mock("@/hooks/use-captcha", () => ({
  useCaptcha: () => ({
    captchaToken: null,
    captchaError: null,
    captchaRef: { current: null },
    handleCaptchaSuccess: jest.fn(),
    handleCaptchaError: jest.fn(),
    handleCaptchaExpire: jest.fn(),
  }),
}));

describe("sign-up page (cloud invite)", () => {
  const originalFetch = global.fetch;
  const mockSignUp = signUp.email as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.value = `invite=${VALID_TOKEN}`;
    // Anonymous viewers get an invite payload without the email.
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({
        success: true,
        data: { organizationName: "Acme", role: "project_editor" },
      }),
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  async function submit() {
    render(<SignUpPage />);
    await screen.findByText(/Join Acme/);
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Jane Doe" } });
    fireEvent.change(screen.getByTestId("signup-email-input"), {
      target: { value: "Jane@Acme.com " },
    });
    fireEvent.change(screen.getByLabelText("Create password"), { target: { value: "Passw0rdX" } });
    fireEvent.click(screen.getByRole("button", { name: /create account & join/i }));
  }

  it("shows an inline error, not verify-email, when the invite email does not match", async () => {
    mockSignUp.mockResolvedValue({
      error: { status: 403, code: "INVITE_REQUIRED", message: "Sign-up requires an invitation." },
    });
    await submit();
    expect(await screen.findByText(/couldn't find a pending invitation/i)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    expect(mockSignUp.mock.calls[0][0].email).toBe("Jane@Acme.com");
  });

  it("ignores a non-UUID invite param: no API call, redirects to sign-in", async () => {
    mockQuery.value = "invite=..%2F..%2Fapi%2Fx";
    render(<SignUpPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("still routes a bare 403 (verification gate) to verify-email", async () => {
    mockSignUp.mockResolvedValue({ error: { status: 403, message: "Email not verified" } });
    await submit();
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(expect.stringContaining("/verify-email?email="))
    );
  });
});
