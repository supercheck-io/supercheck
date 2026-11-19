import { render, screen } from "@testing-library/react";
import VerifyEmailPage from "./page";

const TOKEN = "01a149f7-ce26-70e2-997b-806e9f48d9de";
const mockQuery = { value: `email=a%40b.co&invite=${TOKEN}&from=signup` };
const social = jest.fn();
jest.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(mockQuery.value), useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/utils/auth-client", () => ({ sendVerificationEmail: jest.fn() }));
jest.mock("@/components/auth/social-auth-buttons", () => ({ SocialAuthButtons: (p: { callbackUrl?: string }) => { social(p.callbackUrl); return null; } }));

const mockConfig = { isCloudHosted: true, isFetched: true, error: null as Error | null };
jest.mock("@/hooks/use-app-config", () => ({ useAppConfig: () => mockConfig }));
describe("verify-email page", () => {
  beforeEach(() => { mockConfig.isCloudHosted = true; });
  it("shows the terms and privacy line on cloud only", () => {
    mockConfig.isCloudHosted = true;
    const { unmount } = render(<VerifyEmailPage />);
    expect(screen.getByRole("link", { name: /terms of service/i })).toBeInTheDocument();
    unmount();
    mockConfig.isCloudHosted = false;
    render(<VerifyEmailPage />);
    expect(screen.queryByRole("link", { name: /terms of service/i })).not.toBeInTheDocument();
    mockConfig.isCloudHosted = true;
  });

  beforeEach(() => social.mockClear());

  it("points an invitee who may already have an account to sign-in, keeping the invitation", () => {
    mockQuery.value = `email=a%40b.co&invite=${TOKEN}&from=signup`;
    render(<VerifyEmailPage />);
    expect(screen.getByText(/already have an account, you.ll also get an email shortly/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /already have an account\? sign in/i })).toHaveAttribute("href", `/sign-in?invite=${TOKEN}`);
    expect(social).toHaveBeenLastCalledWith(`/invite/${TOKEN}`);
  });

  it("does not claim a sign-in email was sent when the visitor was bounced here from sign-in", () => {
    mockQuery.value = `email=a%40b.co&invite=${TOKEN}`;
    render(<VerifyEmailPage />);
    expect(screen.queryByText(/email shortly/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to sign in/i })).toBeInTheDocument();
  });

  it("keeps the plain copy without an invitation", () => {
    mockQuery.value = "email=a%40b.co";
    render(<VerifyEmailPage />);
    expect(screen.queryByText(/email shortly/i)).not.toBeInTheDocument();
    expect(social).not.toHaveBeenCalled();
  });
});
