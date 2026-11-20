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
    heights.clear();
    jest.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
      return heights.get(this) ?? 0;
    });
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
    // Skeletons replace the rows during a page change: the last measured height stays, so the count does not jump.
    await act(async () => {
      row.remove();
      await Promise.resolve();
      jest.advanceTimersByTime(200);
    });
    expect(onFit.mock.calls).toEqual([[9], [6]]);
  });

  const heights = new Map<Element, number>();
  const rowHeights = (hs: number[], container: HTMLElement) =>
    hs.map((h) => {
      const row = document.createElement("div");
      row.setAttribute("data-row", "");
      heights.set(row, h);
      container.firstElementChild!.appendChild(row);
      return { row, heights };
    });

  it("sizes from the median row, so mixed row heights settle on one value", async () => {
    const onFit = jest.fn();
    const { container } = render(<Panel onFit={onFit} />);
    await act(async () => {
      rowHeights([45, 45, 120, 45, 45], container);
      await Promise.resolve();
      jest.advanceTimersByTime(200);
    });
    // Median 45 -> (508 - 99) / 45 = 9; the tallest (120) would have given 3.
    expect(onFit.mock.calls).toEqual([[9]]);
    // Repeated resizes with the same mixed rows never flip the size.
    for (let i = 0; i < 5; i++) {
      act(() => { resize(); jest.advanceTimersByTime(200); });
    }
    expect(onFit.mock.calls).toEqual([[9]]);
  });

  it("does not re-fit when row content changes after the rows were measured, but does on a panel resize", async () => {
    const onFit = jest.fn();
    const { container } = render(<Panel onFit={onFit} />);
    const [first] = rowHeights([45, 45, 45], container);
    await act(async () => {
      await Promise.resolve();
      jest.advanceTimersByTime(200);
    });
    expect(onFit.mock.calls).toEqual([[9]]);
    // A page change brings much taller rows: no re-fit.
    await act(async () => {
      first.heights.set(first.row, 200);
      rowHeights([200, 200, 200, 200], container);
      await Promise.resolve();
      jest.advanceTimersByTime(200);
    });
    expect(onFit.mock.calls).toEqual([[9]]);
    // A real panel resize re-fits, measuring the rows now rendered (median 200): (800 - 99) / 200 = 3.
    height = 800;
    act(() => { resize(); jest.advanceTimersByTime(200); });
    expect(onFit).toHaveBeenCalledTimes(2);
    expect(onFit.mock.calls[1]).toEqual([3]);
  });

  it("ignores a resize notification when the panel height is unchanged", async () => {
    const onFit = jest.fn();
    const { container } = render(<Panel onFit={onFit} />);
    const [first] = rowHeights([60], container);
    await act(async () => {
      await Promise.resolve();
      jest.advanceTimersByTime(200);
    });
    expect(onFit.mock.calls).toEqual([[9], [6]]);
    first.heights.set(first.row, 45);
    act(() => { resize(); jest.advanceTimersByTime(200); }); // same panel height, like the initial observe() call
    expect(onFit.mock.calls).toEqual([[9], [6]]);
  });

  it("does nothing below the desktop breakpoint", () => {
    window.matchMedia = jest.fn().mockReturnValue({ matches: false }) as never;
    const onFit = jest.fn();
    render(<Panel onFit={onFit} />);
    expect(onFit).not.toHaveBeenCalled();
  });
});
