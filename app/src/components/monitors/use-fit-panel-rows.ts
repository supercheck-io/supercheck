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
    const measure = () => {
      if (!desktop.matches) return;
      const row = panel.querySelector<HTMLElement>(rowSelector);
      onFitRows(rowsThatFit(panel.clientHeight, row?.offsetHeight || ROW_PX));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [onFitRows, rowSelector]);
  return panelRef;
}
