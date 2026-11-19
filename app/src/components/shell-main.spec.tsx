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
});
