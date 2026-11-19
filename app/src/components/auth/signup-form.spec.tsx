import { render, screen } from "@testing-library/react";
import { SignupForm } from "./signup-form";

const social = jest.fn();
jest.mock("./social-auth-buttons", () => ({ SocialAuthButtons: (p: { callbackUrl?: string }) => { social(p.callbackUrl); return null; } }));
jest.mock("./turnstile-captcha", () => ({ TurnstileCaptcha: () => null }));
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

const baseProps = {
  onSubmit: jest.fn(),
  isLoading: false,
  error: null,
};

describe("SignupForm email field", () => {
  it("is editable and empty when the invite does not reveal the email", () => {
    render(
      <SignupForm
        {...baseProps}
        inviteToken="tok"
        inviteData={{ organizationName: "Acme", role: "project_editor" }}
      />
    );
    const input = screen.getByTestId("signup-email-input") as HTMLInputElement;
    expect(input).not.toHaveAttribute("readonly");
    expect(input.value).toBe("");
    expect(input).toHaveAttribute("placeholder", "m@example.com");
  });

  it("is prefilled and read-only when the invite includes the email", () => {
    render(
      <SignupForm
        {...baseProps}
        inviteToken="tok"
        inviteData={{ organizationName: "Acme", role: "project_editor", email: "a@b.co" }}
      />
    );
    const input = screen.getByTestId("signup-email-input") as HTMLInputElement;
    expect(input).toHaveAttribute("readonly");
    expect(input.value).toBe("a@b.co");
  });

  it("is editable for self-hosted open registration", () => {
    render(<SignupForm {...baseProps} inviteToken={null} inviteData={null} isSelfHosted />);
    expect(screen.getByTestId("signup-email-input")).not.toHaveAttribute("readonly");
  });

  it("shows the allowed-domains hint to invitees who must type their email", () => {
    render(
      <SignupForm
        {...baseProps}
        inviteToken="tok"
        inviteData={{ organizationName: "Acme", role: "project_viewer" }}
        allowedEmailDomains={["acme.com"]}
      />
    );
    expect(screen.getByText(/Allowed domains: acme\.com/)).toBeInTheDocument();
  });
});

describe("SignupForm invitation sign-in routes", () => {
  beforeEach(() => social.mockClear());

  it("links existing accounts to sign-in with the token and offers social sign-in back to the invite", () => {
    render(<SignupForm {...baseProps} inviteToken="tok" inviteData={{ organizationName: "Acme", role: "project_editor" }} />);
    expect(screen.getByRole("link", { name: /sign in instead/i })).toHaveAttribute("href", "/sign-in?invite=tok");
    expect(social).toHaveBeenLastCalledWith("/invite/tok");
  });

  it("shows no social buttons without an invitation", () => {
    render(<SignupForm {...baseProps} inviteToken={null} inviteData={null} />);
    expect(social).not.toHaveBeenCalled();
  });
});
