import { act, render } from "@testing-library/react";
import { roundUpRows, useFitPanelRows } from "./use-fit-panel-rows";

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

  it("rounds rows up to a multiple of 5", () => {
    expect([5, 6, 10, 11].map(roundUpRows)).toEqual([5, 10, 10, 15]);
  });

  it("reports once, debounces resizes and ignores changes inside the same page size", () => {
    const onFit = jest.fn();
    render(<Panel onFit={onFit} />);
    expect(onFit.mock.calls).toEqual([[10]]);
    height = 540; // 11 rows fit before rounding: still 15? 540-98=442/41=10 -> 10
    act(() => { resize(); resize(); jest.advanceTimersByTime(200); });
    expect(onFit).toHaveBeenCalledTimes(1);
    height = 700; // (700-98)/41 = 14 -> 15
    act(() => { resize(); jest.advanceTimersByTime(200); });
    expect(onFit.mock.calls).toEqual([[10], [15]]);
  });
});
