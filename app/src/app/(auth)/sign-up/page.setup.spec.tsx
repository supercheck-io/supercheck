import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { signUp } from "@/utils/auth-client";
import SignUpPage from "./page";

const push = jest.fn();
const replace = jest.fn();
const VALID_TOKEN = "01a149f7-ce26-70e2-997b-806e9f48d9de";
// Prefixed `mock` so jest.mock factories may reference it.
const mockQuery = { value: "" };

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
    captchaToken: null,
    captchaError: null,
    captchaRef: { current: null },
    handleCaptchaSuccess: jest.fn(),
    handleCaptchaError: jest.fn(),
    handleCaptchaExpire: jest.fn(),
  }),
}));


describe("sign-up page (self-hosted default destination)", () => {
  const originalFetch = global.fetch;
  const mockSignUp = signUp.email as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.value = "";
    mockSignUp.mockResolvedValue({ error: null });
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  async function submit() {
    render(<SignUpPage />);
    fireEvent.change(await screen.findByLabelText("Your name"), { target: { value: "Jane Doe" } });
    fireEvent.change(screen.getByTestId("signup-email-input"), { target: { value: "jane@acme.com" } });
    fireEvent.change(screen.getByLabelText("Create password"), { target: { value: "Passw0rdX" } });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));
  }

  it("sends a new account to project setup by default", async () => {
    await submit();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/setup"));
    expect(mockSignUp.mock.calls[0][0].callbackURL).toBe("/sign-in?verified=true&next=%2Fsetup");
  });

  it("lets an explicit allow-listed next win", async () => {
    mockQuery.value = "next=%2Fdevice";
    await submit();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/device"));
    expect(mockSignUp.mock.calls[0][0].callbackURL).toBe("/sign-in?verified=true&next=%2Fdevice");
  });
});
