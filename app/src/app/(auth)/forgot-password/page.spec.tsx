import { forwardRef, useImperativeHandle } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { requestPasswordReset } from "@/utils/auth-client";
import ForgotPasswordPage from "./page";

const mockExecute = jest.fn();

jest.mock("@/utils/auth-client", () => ({ requestPasswordReset: jest.fn() }));
jest.mock("@/hooks/use-app-config", () => ({
  useAppConfig: () => ({ isCloudHosted: false, isFetched: true, error: null }),
}));
jest.mock("@/components/auth/turnstile-captcha", () => ({
  TurnstileCaptcha: forwardRef(function MockTurnstile(_props, ref) {
    useImperativeHandle(ref, () => ({ execute: mockExecute, reset: jest.fn(), getToken: () => null }));
    return null;
  }),
}));

describe("forgot-password page CAPTCHA handling", () => {
  const mockRequest = requestPasswordReset as jest.Mock;

  function submit() {
    fireEvent.change(screen.getByTestId("forgot-password-email-input"), { target: { value: "a@b.co" } });
    fireEvent.click(screen.getByTestId("forgot-password-submit"));
  }

  beforeEach(() => jest.clearAllMocks());

  it("requests a fresh single-use token for every submit", async () => {
    mockExecute.mockResolvedValueOnce("tok-1").mockResolvedValueOnce("tok-2");
    mockRequest.mockResolvedValue({ error: { message: "Failed", status: 500 } });
    render(<ForgotPasswordPage />);

    submit();
    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("forgot-password-submit")).toBeEnabled());
    submit();
    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(2));

    const tokens = mockRequest.mock.calls.map(([arg]) => arg.fetchOptions.headers["x-captcha-response"]);
    expect(tokens).toEqual(["tok-1", "tok-2"]);
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it("sends no CAPTCHA header when CAPTCHA is disabled", async () => {
    mockExecute.mockResolvedValue(null);
    mockRequest.mockResolvedValue({ error: null });
    render(<ForgotPasswordPage />);

    submit();
    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(1));
    expect(mockRequest.mock.calls[0][0].fetchOptions.headers).toEqual({});
    await waitFor(() => expect(screen.getByTestId("forgot-password-success")).toBeInTheDocument());
  });

  it.each([
    [{ message: "Captcha verification failed", status: 400 }, "Verification failed. Please try again."],
    [{ message: "Too many requests", status: 429 }, "Too many password reset attempts. Please try again after some time."],
    [{ message: "boom", status: 500 }, "Could not send the reset link. Please try again."],
  ])("classifies %j without blaming the rate limit", async (error, message) => {
    mockExecute.mockResolvedValue("tok");
    mockRequest.mockResolvedValue({ error });
    render(<ForgotPasswordPage />);

    submit();
    await waitFor(() => expect(screen.getByTestId("forgot-password-error")).toHaveTextContent(message));
  });
});
