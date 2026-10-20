import { render, screen } from "@testing-library/react";
import { LoginForm } from "./login-form";

const social = jest.fn();
jest.mock("./social-auth-buttons", () => ({ SocialAuthButtons: (p: { callbackUrl?: string }) => { social(p.callbackUrl); return null; } }));
jest.mock("./turnstile-captcha", () => ({ TurnstileCaptcha: () => null }));
jest.mock("@/hooks/use-captcha", () => ({ useCaptcha: () => ({ captchaToken: null, captchaError: null, captchaRef: { current: null }, handleCaptchaSuccess: jest.fn(), handleCaptchaError: jest.fn(), handleCaptchaExpire: jest.fn() }) }));
jest.mock("@/hooks/use-app-config", () => ({
  useAppConfig: () => ({ isFetched: true, error: null, isGithubEnabled: true, isGoogleEnabled: true, isSelfHosted: true, isSignupEnabled: true, isCloudHosted: false, isLoading: false, hasSocialAuth: true }),
}));

const base = { onSubmit: jest.fn(), isLoading: false, error: null, inviteData: null, inviteToken: null };

describe("LoginForm continuation", () => {
  beforeEach(() => social.mockClear());

  it("returns social sign-in to the allowlisted next path", () => {
    render(<LoginForm {...base} nextPath="/device?code=BCDF-GHJK" />);
    expect(social).toHaveBeenCalledWith("/device?code=BCDF-GHJK");
  });
  it("defaults to the dashboard and lets an invitation take precedence", () => {
    const { unmount } = render(<LoginForm {...base} />);
    expect(social).toHaveBeenLastCalledWith("/");
    unmount();
    render(<LoginForm {...base} nextPath="/device" inviteToken="tok" inviteData={null} />);
    expect(social).toHaveBeenLastCalledWith("/invite/tok");
  });
  it("carries the continuation to the sign-up link", () => {
    render(<LoginForm {...base} nextPath="/device?code=BCDF-GHJK" />);
    const link = screen.getByRole("link", { name: /sign up/i });
    expect(link).toHaveAttribute("href", `/sign-up?next=${encodeURIComponent("/device?code=BCDF-GHJK")}`);
  });
});
