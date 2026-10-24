import { createRef } from "react";
import { act, render } from "@testing-library/react";
import { TurnstileCaptcha, type TurnstileCaptchaRef } from "./turnstile-captcha";

jest.mock("@marsidev/react-turnstile", () => ({
  Turnstile: () => null,
}));

describe("TurnstileCaptcha execute()", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it("waits for the configuration instead of answering null before it arrived", async () => {
    let respond!: (value: unknown) => void;
    global.fetch = jest.fn(() => new Promise((resolve) => (respond = resolve))) as unknown as typeof fetch;
    const ref = createRef<TurnstileCaptchaRef>();
    render(<TurnstileCaptcha ref={ref} onSuccess={jest.fn()} onError={jest.fn()} onExpire={jest.fn()} />);

    let settled = false;
    const pending = ref.current!.execute().then((token) => {
      settled = true;
      return token;
    });
    await act(async () => {});
    expect(settled).toBe(false); // still waiting for /api/config/captcha

    await act(async () => {
      respond({ ok: true, json: async () => ({ enabled: false }) });
    });
    await expect(pending).resolves.toBeNull(); // captcha disabled: no token needed
  });

  it("does not hang forever when the configuration never arrives", async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(() => new Promise(() => {})) as unknown as typeof fetch;
    const ref = createRef<TurnstileCaptchaRef>();
    render(<TurnstileCaptcha ref={ref} onSuccess={jest.fn()} onError={jest.fn()} onExpire={jest.fn()} />);
    const pending = ref.current!.execute();
    await act(async () => {
      jest.advanceTimersByTime(5001);
    });
    await expect(pending).resolves.toBeNull();
  });
});
