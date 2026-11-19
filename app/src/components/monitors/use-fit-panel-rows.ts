import { useEffect, useRef } from "react";

// Fallback table header (h-10), pager row and row heights, used until the real ones render.
const HEAD_PX = 40;
const NAV_PX = 58;
const ROW_PX = 45;
const MIN_ROWS = 1;
const MAX_ROWS = 50;

/**
 * Rows that fit a fixed-height panel: the header and the pager are always reserved, so the size never oscillates.
 * 1px absorbs sub-pixel heights, so the rows never overflow into a scrollbar.
 */
export function rowsThatFit(panelPx: number, rowPx = ROW_PX, headPx = HEAD_PX, navPx = NAV_PX): number {
  if (!(panelPx > 0) || !(rowPx > 0)) return MIN_ROWS;
  return Math.min(MAX_ROWS, Math.max(MIN_ROWS, Math.floor((panelPx - headPx - navPx - 1) / rowPx)));
}

const DEBOUNCE_MS = 150;

/**
 * Reports how many rows fit the panel's own height (desktop only). The panel must have a height that does not
 * depend on its rows (a fixed flex child or an absolutely filled box), or more rows would grow it forever.
 * Attach the returned ref to the element that holds the table and pager.
 */
export function useFitPanelRows(onFitRows: ((rows: number) => void) | undefined, rowSelector: string) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const panel = panelRef.current;
    if (!onFitRows || !panel || typeof ResizeObserver === "undefined" || typeof window.matchMedia !== "function") return;
    const desktop = window.matchMedia("(min-width: 1024px)");
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const measure = () => {
      if (!desktop.matches) return;
      const head = panel.querySelector<HTMLElement>("thead");
      const pager = panel.querySelector<HTMLElement>("[data-fit-pager]");
      // The tallest rendered row, so one taller row (a wrapped cell, zoomed text) never pushes the last row out.
      const rowPx = Math.max(0, ...Array.from(panel.querySelectorAll<HTMLElement>(rowSelector), (r) => r.offsetHeight)) || ROW_PX;
      const rows = rowsThatFit(panel.clientHeight, rowPx, head?.offsetHeight || HEAD_PX, pager?.offsetHeight || NAV_PX);
      // Only a real change in page size reaches the caller, so the results are not refetched for nothing.
      if (rows !== last) {
        last = rows;
        onFitRows(rows);
      }
    };
    measure();
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(measure, DEBOUNCE_MS);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(panel);
    // New rows (a first load, the next page) can be taller than the ones measured without resizing the fixed panel.
    const rowsObserver = typeof MutationObserver === "undefined" ? undefined : new MutationObserver(schedule);
    rowsObserver?.observe(panel, { childList: true, subtree: true });
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      rowsObserver?.disconnect();
    };
  }, [onFitRows, rowSelector]);
  return panelRef;
}
