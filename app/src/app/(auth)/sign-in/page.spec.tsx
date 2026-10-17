import { forwardRef, useImperativeHandle } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { signIn } from "@/utils/auth-client";
import SignInPage from "./page";

const push = jest.fn();
const mockExecute = jest.fn();
const VALID_TOKEN = "01a149f7-ce26-70e2-997b-806e9f48d9de";
// Prefixed `mock` so jest.mock factories may reference it.
const mockQuery = { value: "" };

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(mockQuery.value),
}));
jest.mock("@/utils/auth-client", () => ({ signIn: { email: jest.fn() } }));
jest.mock("@/hooks/use-project-context", () => ({ clearProjectsCache: jest.fn() }));
jest.mock("@/lib/project-navigation", () => ({
  announceProjectChange: jest.fn(),
  reloadProjectContext: jest.fn(),
}));
jest.mock("@/hooks/use-app-config", () => ({
  useAppConfig: () => ({
    isCloudHosted: true,
    isSelfHosted: false,
    isGithubEnabled: false,
    isGoogleEnabled: false,
    isSignupEnabled: true,
    isFetched: true,
    error: null,
  }),
}));
jest.mock("@/components/auth/turnstile-captcha", () => ({
  TurnstileCaptcha: forwardRef(function MockTurnstile(_props, ref) {
    useImperativeHandle(ref, () => ({ execute: mockExecute, reset: jest.fn(), getToken: () => null }));
    return null;
  }),
}));

describe("sign-in page CAPTCHA handling", () => {
  const originalFetch = global.fetch;
  const mockSignIn = signIn.email as jest.Mock;
  let checkActions: string[];

  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.value = "";
    checkActions = [];
    global.fetch = jest.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const action = init?.body ? JSON.parse(String(init.body)).action : undefined;
      if (action) checkActions.push(action);
      return { ok: true, json: async () => ({ isLocked: false }) };
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  function attempt() {
    fireEvent.change(screen.getByTestId("login-email-input"), { target: { value: "a@b.co" } });
    fireEvent.change(screen.getByTestId("login-password-input"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByTestId("login-submit-button"));
  }

  it("requests a fresh single-use token for every attempt", async () => {
    mockExecute.mockResolvedValueOnce("tok-1").mockResolvedValueOnce("tok-2");
    mockSignIn.mockResolvedValue({ error: { message: "Invalid email or password" } });
    render(<SignInPage />);

    attempt();
    await waitFor(() => expect(mockSignIn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("login-submit-button")).toBeEnabled());
    attempt();
    await waitFor(() => expect(mockSignIn).toHaveBeenCalledTimes(2));

    const tokens = mockSignIn.mock.calls.map((c) => c[0].fetchOptions.headers["x-captcha-response"]);
    expect(tokens).toEqual(["tok-1", "tok-2"]);
  });

  it("does not count a CAPTCHA rejection as a failed sign-in attempt", async () => {
    mockExecute.mockResolvedValue(null);
    mockSignIn.mockResolvedValue({ error: { message: "Missing CAPTCHA response" } });
    render(<SignInPage />);

    attempt();
    expect(await screen.findByText(/Verification failed/i)).toBeInTheDocument();
    expect(checkActions).not.toContain("failed");
    expect(push).not.toHaveBeenCalled();
  });

  it("shows the CAPTCHA retry message, not verify-email, for an invitee whose CAPTCHA is rejected", async () => {
    mockQuery.value = `invite=${VALID_TOKEN}`;
    mockExecute.mockResolvedValue(null);
    mockSignIn.mockResolvedValue({ error: { message: "Captcha verification failed" } });
    render(<SignInPage />);

    attempt();
    expect(await screen.findByText(/Verification failed\. Please try again/i)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    expect(checkActions).not.toContain("failed");
  });

  it("still sends an invitee with an unverified email to verify-email", async () => {
    mockQuery.value = `invite=${VALID_TOKEN}`;
    mockExecute.mockResolvedValue("tok");
    mockSignIn.mockResolvedValue({ error: { message: "Email not verified" } });
    render(<SignInPage />);

    attempt();
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(expect.stringContaining(`/verify-email?email=`))
    );
  });
});
