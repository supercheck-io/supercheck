import { render, screen } from "@testing-library/react";
import VerifyEmailPage from "./page";

const TOKEN = "01a149f7-ce26-70e2-997b-806e9f48d9de";
const mockQuery = { value: `email=a%40b.co&invite=${TOKEN}` };
const social = jest.fn();
jest.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(mockQuery.value), useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/utils/auth-client", () => ({ sendVerificationEmail: jest.fn() }));
jest.mock("@/components/auth/social-auth-buttons", () => ({ SocialAuthButtons: (p: { callbackUrl?: string }) => { social(p.callbackUrl); return null; } }));

describe("verify-email page", () => {
  beforeEach(() => social.mockClear());

  it("points an invitee who may already have an account to sign-in, keeping the invitation", () => {
    mockQuery.value = `email=a%40b.co&invite=${TOKEN}`;
    render(<VerifyEmailPage />);
    expect(screen.getByText(/already have an account, we.ve emailed you a sign-in link/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /already have an account\? sign in/i })).toHaveAttribute("href", `/sign-in?invite=${TOKEN}`);
    expect(social).toHaveBeenLastCalledWith(`/invite/${TOKEN}`);
  });

  it("keeps the plain copy without an invitation", () => {
    mockQuery.value = "email=a%40b.co";
    render(<VerifyEmailPage />);
    expect(screen.queryByText(/sign-in link instead/i)).not.toBeInTheDocument();
    expect(social).not.toHaveBeenCalled();
  });
});
