import { act, render } from "@testing-library/react";
import { roundDownRows, useFitPanelRows } from "./use-fit-panel-rows";

function Panel({ onFit }: { onFit: (n: number) => void }) {
  const ref = useFitPanelRows(onFit, "[data-row]");
  return <div ref={ref} />;
}

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

  it("rounds rows down to a multiple of 5, never below 5, so fetched rows always fit", () => {
    expect([3, 5, 6, 9, 10, 14, 15].map(roundDownRows)).toEqual([5, 5, 5, 5, 10, 10, 15]);
  });

  it("reports once, debounces resizes and ignores changes inside the same page size", () => {
    const onFit = jest.fn();
    render(<Panel onFit={onFit} />);
    expect(onFit.mock.calls).toEqual([[10]]);
    height = 700; // (700-98)/41 = 14 -> still 10
    act(() => { resize(); resize(); jest.advanceTimersByTime(200); });
    expect(onFit).toHaveBeenCalledTimes(1);
    height = 800; // (800-98)/41 = 17 -> 15
    act(() => { resize(); jest.advanceTimersByTime(200); });
    expect(onFit.mock.calls).toEqual([[10], [15]]);
  });
});
