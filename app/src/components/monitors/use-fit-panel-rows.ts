import { useEffect, useRef } from "react";

// Table header (h-10) and pager row heights, and the row height used before a row exists.
const HEAD_PX = 40;
const NAV_PX = 58;
const ROW_PX = 41;
const MIN_ROWS = 5;
const MAX_ROWS = 50;

/** Rows that fit a fixed-height panel: the header and the pager are always reserved, so the size never oscillates. */
export function rowsThatFit(panelPx: number, rowPx = ROW_PX): number {
  if (!(panelPx > 0) || !(rowPx > 0)) return MIN_ROWS;
  return Math.min(MAX_ROWS, Math.max(MIN_ROWS, Math.floor((panelPx - HEAD_PX - NAV_PX) / rowPx)));
}

const ROUND_TO = 5;
const DEBOUNCE_MS = 150;

/** Rounded up to a multiple of 5 so small height changes keep the same page size (and the same query). */
export const roundUpRows = (rows: number) => Math.ceil(rows / ROUND_TO) * ROUND_TO;

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
      const row = panel.querySelector<HTMLElement>(rowSelector);
      const rows = roundUpRows(rowsThatFit(panel.clientHeight, row?.offsetHeight || ROW_PX));
      // Only a real change in page size reaches the caller, so the results are not refetched for nothing.
      if (rows !== last) {
        last = rows;
        onFitRows(rows);
      }
    };
    measure();
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(measure, DEBOUNCE_MS);
    });
    observer.observe(panel);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [onFitRows, rowSelector]);
  return panelRef;
}
