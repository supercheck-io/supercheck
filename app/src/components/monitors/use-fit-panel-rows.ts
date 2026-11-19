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

/** Median, so one taller row (a wrapped cell, an error message) never changes the typical row height. */
function median(values: number[]): number {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : 0;
}

/**
 * Reports how many rows fit the panel's own height (desktop only). The panel must have a height that does not
 * depend on its rows (a fixed flex child or an absolutely filled box), or more rows would grow it forever.
 * Attach the returned ref to the element that holds the table and pager.
 *
 * Fit invariant: the size never comes from the rows it produces. The row height is the median of the rendered
 * rows, taken once when the first real rows appear and again only on a panel resize. Row content changes (a
 * page change, a taller row) never re-fit, so the page size cannot flip between two values and refetch each time.
 */
export function useFitPanelRows(onFitRows: ((rows: number) => void) | undefined, rowSelector: string) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const panel = panelRef.current;
    if (!onFitRows || !panel || typeof ResizeObserver === "undefined" || typeof window.matchMedia !== "function") return;
    const desktop = window.matchMedia("(min-width: 1024px)");
    let last = 0;
    // 0 until real rows have rendered; skeletons don't match rowSelector, so the last real height is kept.
    let rowPx = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rowsObserver: MutationObserver | undefined;
    const measure = () => {
      if (!desktop.matches) return;
      const head = panel.querySelector<HTMLElement>("thead");
      const pager = panel.querySelector<HTMLElement>("[data-fit-pager]");
      const measured = median(Array.from(panel.querySelectorAll<HTMLElement>(rowSelector), (r) => r.offsetHeight));
      if (measured) {
        rowPx = measured;
        // The real height is known: from here only a panel resize re-fits.
        rowsObserver?.disconnect();
        rowsObserver = undefined;
      }
      const rows = rowsThatFit(panel.clientHeight, rowPx || ROW_PX, head?.offsetHeight || HEAD_PX, pager?.offsetHeight || NAV_PX);
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
    // The first rows render after mount and can differ from the fallback height without resizing the fixed panel.
    if (!rowPx && typeof MutationObserver !== "undefined") {
      rowsObserver = new MutationObserver(schedule);
      rowsObserver.observe(panel, { childList: true, subtree: true });
    }
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      rowsObserver?.disconnect();
    };
  }, [onFitRows, rowSelector]);
  return panelRef;
}
