import { act, renderHook } from "@testing-library/react";

import { fitRows, pageSizeOptions, repaginate, useFitPagination } from "./use-fit-page-size";

describe("fitRows", () => {
  it("fits whole rows above the content below the table", () => {
    expect(fitRows({ viewportBottom: 900, bodyTop: 300, contentBelowBody: 80, rowHeight: 49 })).toBe(10);
  });

  it("clamps to a usable range", () => {
    expect(fitRows({ viewportBottom: 400, bodyTop: 380, contentBelowBody: 80, rowHeight: 49 })).toBe(5);
    expect(fitRows({ viewportBottom: 9000, bodyTop: 0, contentBelowBody: 0, rowHeight: 49 })).toBe(50);
    expect(fitRows({ viewportBottom: 900, bodyTop: 0, contentBelowBody: 0, rowHeight: 0 })).toBe(5);
  });
});

describe("pageSizeOptions", () => {
  it("includes the fitted size once, in order", () => {
    expect(pageSizeOptions(13)).toEqual([10, 13, 25, 50, 100]);
    expect(pageSizeOptions(25)).toEqual([10, 25, 50, 100]);
  });
});

describe("repaginate", () => {
  it("keeps the first visible row on screen when the size changes", () => {
    expect(repaginate(2, 10, 25, 30)).toBe(0);
    expect(repaginate(3, 10, 5, 100)).toBe(6);
  });

  it("never points past the last page", () => {
    expect(repaginate(4, 10, 10, 12)).toBe(1);
    expect(repaginate(0, 10, 10, 0)).toBe(0);
  });
});

describe("useFitPagination", () => {
  it("starts at the fitted default and pins a size the user picks", () => {
    const { result } = renderHook(() => useFitPagination(40));
    expect(result.current.pagination).toEqual({ pageIndex: 0, pageSize: 10 });
    act(() => result.current.onPaginationChange({ pageIndex: 0, pageSize: 25 }));
    expect(result.current.pagination).toEqual({ pageIndex: 0, pageSize: 25 });
  });

  it("pages without changing the size and clamps to the last page", () => {
    const { result, rerender } = renderHook(({ rows }) => useFitPagination(rows), {
      initialProps: { rows: 40 },
    });
    act(() => result.current.onPaginationChange((old) => ({ ...old, pageIndex: 3 })));
    expect(result.current.pagination).toEqual({ pageIndex: 3, pageSize: 10 });
    rerender({ rows: 15 });
    expect(result.current.pagination.pageIndex).toBe(1);
  });

  it("uses a fixed size when one is given", () => {
    const { result } = renderHook(() => useFitPagination(40, 5));
    expect(result.current.pagination.pageSize).toBe(5);
  });
});
