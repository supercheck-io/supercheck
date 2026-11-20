import { act, renderHook } from "@testing-library/react";
import { useIdle } from "./use-idle";

describe("useIdle", () => {
  afterEach(() => {
    jest.useRealTimers();
    delete (window as Partial<Window>).requestIdleCallback;
    delete (window as Partial<Window>).cancelIdleCallback;
  });

  it("turns true from the browser's idle callback, with the timeout passed through", () => {
    let fire!: () => void;
    const request = jest.fn((cb: () => void) => { fire = cb; return 7; });
    const cancel = jest.fn();
    Object.assign(window, { requestIdleCallback: request, cancelIdleCallback: cancel });
    const { result, unmount } = renderHook(() => useIdle(2000));
    expect(result.current).toBe(false);
    expect(request).toHaveBeenCalledWith(expect.any(Function), { timeout: 2000 });
    act(() => fire());
    expect(result.current).toBe(true);
    unmount();
    expect(cancel).toHaveBeenCalledWith(7);
  });

  it("falls back to a short timer without an idle callback", () => {
    jest.useFakeTimers();
    const { result } = renderHook(() => useIdle());
    expect(result.current).toBe(false);
    act(() => { jest.advanceTimersByTime(499); });
    expect(result.current).toBe(false);
    act(() => { jest.advanceTimersByTime(1); });
    expect(result.current).toBe(true);
  });
});
