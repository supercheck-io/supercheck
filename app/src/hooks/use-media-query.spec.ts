import { act, renderHook } from "@testing-library/react";
import { useMediaQuery } from "./use-media-query";

describe("useMediaQuery", () => {
  it("follows the query's matches and its change events", () => {
    let matches = false;
    const listeners = new Set<() => void>();
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      media: query,
      get matches() { return matches; },
      addEventListener: (_: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
    }));
    const { result, unmount } = renderHook(() => useMediaQuery("(min-width: 1280px)"));
    expect(result.current).toBe(false);
    matches = true;
    act(() => listeners.forEach((cb) => cb()));
    expect(result.current).toBe(true);
    unmount();
    expect(listeners.size).toBe(0);
  });
});
