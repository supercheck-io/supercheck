import { render, screen } from "@testing-library/react";
import { SignupForm } from "./signup-form";

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
