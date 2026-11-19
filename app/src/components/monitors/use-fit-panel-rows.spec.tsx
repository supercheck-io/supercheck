import { act, render } from "@testing-library/react";
import { rowsThatFit, useFitPanelRows } from "./use-fit-panel-rows";

function Panel({ onFit }: { onFit: (n: number) => void }) {
  const ref = useFitPanelRows(onFit, "[data-row]");
  return <div ref={ref} />;
}

describe("rowsThatFit", () => {
  it("fits every whole row under the header and above the pager, with no rounding to 5", () => {
    // (508 - 40 - 58 - 1) / 45 = 9.08 -> 9; the old rounding gave 5 and left four rows of empty space.
    expect(rowsThatFit(508)).toBe(9);
    expect(rowsThatFit(508, 45, 41, 58)).toBe(9);
    expect(rowsThatFit(503, 45, 40, 58)).toBe(8);
  });

  it("never fills less than one row or more than 50, and survives a panel without layout", () => {
    expect(rowsThatFit(60)).toBe(1);
    expect(rowsThatFit(10_000)).toBe(50);
    expect(rowsThatFit(0)).toBe(1);
    expect(rowsThatFit(500, 0)).toBe(1);
  });
});

describe("useFitPanelRows", () => {
  let resize: () => void;
  let height = 508;
  beforeEach(() => {
    jest.useFakeTimers();
    height = 508;
    window.matchMedia = jest.fn().mockReturnValue({ matches: true }) as never;
    global.ResizeObserver = class {
      constructor(cb: () => void) { resize = cb; }
      observe() {}
      disconnect() {}
    } as never;
    jest.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => height);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("reports once, debounces resizes and reports only real changes", () => {
    const onFit = jest.fn();
    render(<Panel onFit={onFit} />);
    expect(onFit.mock.calls).toEqual([[9]]);
    height = 510; // still 9 rows
    act(() => { resize(); resize(); jest.advanceTimersByTime(200); });
    expect(onFit).toHaveBeenCalledTimes(1);
    height = 800; // (800-99)/45 = 15
    act(() => { resize(); jest.advanceTimersByTime(200); });
    expect(onFit.mock.calls).toEqual([[9], [15]]);
  });

  it("measures again when rows render, since taller rows do not resize the fixed panel", async () => {
    const onFit = jest.fn();
    const { container } = render(<Panel onFit={onFit} />);
    expect(onFit.mock.calls).toEqual([[9]]);
    jest.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute("data-row") ? 60 : 0;
    });
    const row = document.createElement("div");
    row.setAttribute("data-row", "");
    await act(async () => {
      container.firstElementChild!.appendChild(row);
      await Promise.resolve();
      jest.advanceTimersByTime(200);
    });
    // (508 - 40 - 58 - 1) / 60 = 6.8 -> 6
    expect(onFit.mock.calls).toEqual([[9], [6]]);
  });

  it("does nothing below the desktop breakpoint", () => {
    window.matchMedia = jest.fn().mockReturnValue({ matches: false }) as never;
    const onFit = jest.fn();
    render(<Panel onFit={onFit} />);
    expect(onFit).not.toHaveBeenCalled();
  });
});
