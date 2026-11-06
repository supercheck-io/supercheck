import { fireEvent, render, screen } from "@testing-library/react";
import { useUnsavedNavigationGuard } from "./use-unsaved-navigation-guard";

const push = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

function Harness({ active }: { active: boolean }) {
  const { pendingHref, stay, leave } = useUnsavedNavigationGuard(active);
  return (
    <div>
      <a href="/jobs">Jobs</a>
      <a href="/jobs" target="_blank">New tab</a>
      <a href="https://example.com/x">External</a>
      <a href={window.location.pathname}>Here</a>
      {pendingHref && (
        <div>
          <span>Leaving to {pendingHref}</span>
          <button onClick={stay}>Stay</button>
          <button onClick={leave}>Leave</button>
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
    expect(screen.getByText("Leaving to /jobs")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Leave"));
    expect(push).toHaveBeenCalledWith("/jobs");
    expect(screen.queryByText(/Leaving to/)).not.toBeInTheDocument();
  });

  it("stays on the page when the user declines", () => {
    render(<Harness active />);
    fireEvent.click(screen.getByText("Jobs"));
    fireEvent.click(screen.getByText("Stay"));
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByText(/Leaving to/)).not.toBeInTheDocument();
  });

  it("does nothing when inactive, for new-tab, external, same-page and modified clicks", () => {
    const { rerender } = render(<Harness active={false} />);
    expect(fireEvent.click(screen.getByText("Jobs"))).toBe(true);

    rerender(<Harness active />);
    expect(fireEvent.click(screen.getByText("New tab"))).toBe(true);
    expect(fireEvent.click(screen.getByText("External"))).toBe(true);
    expect(fireEvent.click(screen.getByText("Here"))).toBe(true);
    expect(fireEvent.click(screen.getByText("Jobs"), { metaKey: true })).toBe(true);
    expect(screen.queryByText(/Leaving to/)).not.toBeInTheDocument();
  });
});
