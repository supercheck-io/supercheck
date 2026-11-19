/**
 * @jest-environment jsdom
 */
import { render, screen, act } from "@testing-library/react";
import { ShellMain } from "./shell-main";

let mockPathname = "/a";
jest.mock("next/navigation", () => ({ usePathname: () => mockPathname }));

function ui() {
  return (
    <ShellMain>
      <input aria-label="search" />
      <p>content</p>
    </ShellMain>
  );
}

beforeEach(() => {
  mockPathname = "/a";
  window.sessionStorage.clear();
  (document.activeElement as HTMLElement | null)?.blur();
});

describe("ShellMain", () => {
  it("is a focusable landmark and takes focus when nothing else has it", () => {
    render(ui());
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("tabindex", "-1");
    expect(document.activeElement).toBe(main);
  });

  it("does not take focus from an input", () => {
    const outside = document.createElement("input");
    document.body.appendChild(outside);
    outside.focus();
    render(ui());
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("starts a new page at the top and restores the position on back", () => {
    const { rerender } = render(ui());
    const main = screen.getByRole("main");
    main.scrollTop = 120;
    act(() => {
      main.dispatchEvent(new Event("scroll"));
    });
    mockPathname = "/b";
    rerender(ui());
    expect(main.scrollTop).toBe(0);
    window.history.pushState({}, "", "/a");
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    mockPathname = "/a";
    rerender(ui());
    expect(main.scrollTop).toBe(120);
  });

  it("does not restore a position after a back that only changed the query", () => {
    const { rerender } = render(ui());
    const main = screen.getByRole("main");
    main.scrollTop = 90;
    act(() => {
      main.dispatchEvent(new Event("scroll"));
    });
    // Back within the same pathname: popstate fires but the pathname does not change.
    window.history.pushState({}, "", "/a?tab=1");
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    mockPathname = "/c";
    rerender(ui());
    expect(main.scrollTop).toBe(0);
  });

  it("stops restoring once the user moves the scrollbar, but keeps retrying while content grows", () => {
    jest.useFakeTimers();
    const raf: FrameRequestCallback[] = [];
    jest.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => (raf.push(cb), raf.length));
    jest.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      raf[id - 1] = () => {};
    });
    const { rerender } = render(ui());
    const main = screen.getByRole("main");
    main.scrollTop = 1000;
    act(() => main.dispatchEvent(new Event("scroll")));
    mockPathname = "/b";
    rerender(ui());
    window.history.pushState({}, "", "/a");
    act(() => window.dispatchEvent(new PopStateEvent("popstate")));
    // jsdom has no layout, so clamp the scroller like a short page: only 500px is reachable at first.
    let max = 500;
    const desc = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
    let top = 0;
    Object.defineProperty(main, "scrollTop", { configurable: true, get: () => top, set: (v) => (top = Math.min(v, max)) });
    mockPathname = "/a";
    rerender(ui());
    expect(top).toBe(500);
    max = 1500;
    act(() => raf.splice(0).forEach((cb) => cb(0)));
    expect(top).toBe(1000);
    // A second visit: the user drags the scrollbar to 100 while content is still short.
    max = 500;
    top = 0;
    mockPathname = "/b";
    rerender(ui());
    window.history.pushState({}, "", "/a");
    act(() => window.dispatchEvent(new PopStateEvent("popstate")));
    mockPathname = "/a";
    rerender(ui());
    top = 100;
    act(() => main.dispatchEvent(new Event("scroll")));
    max = 1500;
    act(() => raf.splice(0).forEach((cb) => cb(0)));
    expect(top).toBe(100);
    if (desc) Object.defineProperty(Element.prototype, "scrollTop", desc);
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
});
