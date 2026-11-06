import { act, fireEvent, render, screen } from "@testing-library/react";
import { useUnsavedNavigationGuard } from "./use-unsaved-navigation-guard";

const push = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

function Harness({ active }: { active: boolean }) {
  const { pending, stay, leave } = useUnsavedNavigationGuard(active);
  return (
    <div>
      <a href="/jobs">Jobs</a>
      <a href="/jobs" target="_blank">New tab</a>
      <a href="https://example.com/x">External</a>
      <a href={window.location.pathname}>Here</a>
      {pending && (
        <div>
          <span>Confirm leaving</span>
          <button onClick={stay}>Stay</button>
          <button onClick={() => { leave(); stay(); }}>Leave</button>
        </div>
      )}
    </div>
  );
}

describe("useUnsavedNavigationGuard", () => {
  beforeEach(() => push.mockReset());

  it("holds an internal link click until the user confirms", () => {
    render(<Harness active />);
    const notPrevented = fireEvent.click(screen.getByText("Jobs"));
    expect(notPrevented).toBe(false);
    expect(screen.getByText("Confirm leaving")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Leave"));
    expect(push).toHaveBeenCalledWith("/jobs");
    expect(screen.queryByText("Confirm leaving")).not.toBeInTheDocument();
  });

  it("stays on the page when the user declines", () => {
    render(<Harness active />);
    fireEvent.click(screen.getByText("Jobs"));
    fireEvent.click(screen.getByText("Stay"));
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByText("Confirm leaving")).not.toBeInTheDocument();
  });

  it("does nothing when inactive, for new-tab, external, same-page and modified clicks", () => {
    const { rerender } = render(<Harness active={false} />);
    expect(fireEvent.click(screen.getByText("Jobs"))).toBe(true);

    rerender(<Harness active />);
    expect(fireEvent.click(screen.getByText("New tab"))).toBe(true);
    expect(fireEvent.click(screen.getByText("External"))).toBe(true);
    expect(fireEvent.click(screen.getByText("Here"))).toBe(true);
    expect(fireEvent.click(screen.getByText("Jobs"), { metaKey: true })).toBe(true);
    expect(screen.queryByText("Confirm leaving")).not.toBeInTheDocument();
  });

  describe("browser back", () => {
    it("adds one same-URL history entry only while active", () => {
      const push1 = jest.spyOn(window.history, "pushState");
      const { rerender } = render(<Harness active={false} />);
      expect(push1).not.toHaveBeenCalled();
      rerender(<Harness active />);
      expect(push1).toHaveBeenCalledTimes(1);
      expect(push1.mock.calls[0][2]).toBe(window.location.href);
      push1.mockRestore();
    });

    it("asks before leaving on back, and re-arms the guard when the user stays", () => {
      render(<Harness active />);
      const pushState = jest.spyOn(window.history, "pushState");
      act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });
      expect(screen.getByText("Confirm leaving")).toBeInTheDocument();

      fireEvent.click(screen.getByText("Stay"));
      expect(pushState).toHaveBeenCalledTimes(1);
      expect(screen.queryByText("Confirm leaving")).not.toBeInTheDocument();
      pushState.mockRestore();
    });

    it("goes back once when the user leaves, without re-arming or prompting again", () => {
      render(<Harness active />);
      const back = jest.spyOn(window.history, "back").mockImplementation(() => {});
      const pushState = jest.spyOn(window.history, "pushState");
      act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });

      fireEvent.click(screen.getByText("Leave"));
      expect(back).toHaveBeenCalledTimes(1);
      expect(pushState).not.toHaveBeenCalled();

      act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });
      expect(screen.queryByText("Confirm leaving")).not.toBeInTheDocument();
      back.mockRestore();
      pushState.mockRestore();
    });

    it("ignores popstate when inactive", () => {
      render(<Harness active={false} />);
      act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });
      expect(screen.queryByText("Confirm leaving")).not.toBeInTheDocument();
    });
  });
});
