"use client";

import type { PaginationState } from "@tanstack/react-table";
import { useCallback, useEffect, useRef, useState } from "react";

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

const MIN_ROWS = 5;
const MAX_ROWS = 50;
// Used until a real row has rendered and can be measured.
const DEFAULT_ROW_HEIGHT = 49;
const MAX_CHANGES_PER_SECOND = 6;
// How long measuring stays paused after flapping; layout changes later can re-fit.
const SETTLE_MS = 5000;

/**
 * Rows that fit between the table body's top and the bottom of the visible area,
 * after keeping room for whatever renders below the table (pagination, card padding).
 */
export function fitRows({
  viewportBottom,
  bodyTop,
  contentBelowBody,
  rowHeight,
}: {
  viewportBottom: number;
  bodyTop: number;
  contentBelowBody: number;
  rowHeight: number;
}) {
  if (!(rowHeight > 0)) return MIN_ROWS;
  // 1px absorbs sub-pixel row heights so rounding never adds a scrollbar.
  const rows = Math.floor((viewportBottom - bodyTop - contentBelowBody - 1) / rowHeight);
  return Math.min(MAX_ROWS, Math.max(MIN_ROWS, rows));
}

/** Keeps the first visible row on screen when the page size changes, then clamps to the last page. */
export function repaginate(pageIndex: number, fromSize: number, toSize: number, rowCount: number) {
  const index = Math.floor((pageIndex * fromSize) / toSize);
  const lastPage = Math.max(0, Math.ceil(rowCount / toSize) - 1);
  return Math.min(index, lastPage);
}

// The app scrolls pages inside <main>. Ancestors with overflow-x (table wrappers) also
// compute overflow-y as auto, so they can't be found by style.
function scrollParent(element: HTMLElement): HTMLElement | null {
  return element.closest("main");
}

// Bottom edge of the page content, including the margins of the wrappers around the table.
// <main> itself stretches to the viewport, so its scrollHeight can't be used.
function contentBottom(body: HTMLElement, scroller: HTMLElement | null) {
  let bottom = body.getBoundingClientRect().bottom;
  for (let node = body.parentElement; node && node !== scroller; node = node.parentElement) {
    const style = getComputedStyle(node);
    bottom = Math.max(
      bottom,
      node.getBoundingClientRect().bottom + parseFloat(style.marginBottom || "0"),
    );
  }
  return bottom + (scroller ? parseFloat(getComputedStyle(scroller).paddingBottom || "0") : 0);
}

/**
 * Page size that fills the visible height without a page scrollbar. Pass `bodyRef` as the
 * table's <tbody> ref. Picking a size from the "Rows per page" menu turns auto-fit off;
 * `fixedSize` turns it off from the start.
 */
export function useFitPageSize(fixedSize?: number) {
  const [body, bodyRef] = useState<HTMLTableSectionElement | null>(null);
  const [fitted, setFitted] = useState<number>(PAGE_SIZE_OPTIONS[0]);
  const [manual, setManual] = useState<number | null>(fixedSize ?? null);
  // Recent size changes. Row heights can depend on the page size (a scrollbar appearing
  // reflows the cells), which would flip the size back and forth on every frame.
  const fittedRef = useRef<number>(PAGE_SIZE_OPTIONS[0]);
  const changes = useRef<number[]>([]);
  const settled = useRef(0); // timestamp of the latch, 0 = measuring

  const measure = useCallback(() => {
    if (!body || manual !== null) return;
    if (settled.current && Date.now() - settled.current < SETTLE_MS) return;
    settled.current = 0;
    const bodyRect = body.getBoundingClientRect();
    // No layout (hidden, or a test DOM): keep the current size.
    if (bodyRect.height === 0) return;
    const scroller = scrollParent(body);
    // Work in unscrolled coordinates so the result doesn't depend on scroll position.
    const scrollOffset = window.scrollY + (scroller?.scrollTop ?? 0);
    // <main> only clips on pages that opt into viewport height; elsewhere the window scrolls
    // and <main> grows with its content, so cap at the window.
    const viewportBottom =
      window.scrollY +
      Math.min(window.innerHeight, scroller ? scroller.getBoundingClientRect().bottom : window.innerHeight);
    // Single-cell rows are "No results" or loading placeholders, not data rows.
    const firstRow = body.rows[0];
    const rowHeight =
      firstRow && firstRow.cells.length > 1
        ? firstRow.getBoundingClientRect().height
        : DEFAULT_ROW_HEIGHT;
    const next = fitRows({
      viewportBottom,
      bodyTop: bodyRect.top + scrollOffset,
      contentBelowBody: Math.max(0, contentBottom(body, scroller) - bodyRect.bottom),
      rowHeight,
    });
    let size = next;
    if (size === fittedRef.current) return;
    const now = Date.now();
    changes.current = [...changes.current.filter((at) => now - at < 1000), now];
    if (changes.current.length > MAX_CHANGES_PER_SECOND) {
      // Flapping: stop measuring at the smaller size (no page scrollbar) until the window resizes.
      settled.current = Date.now();
      size = Math.min(fittedRef.current, next);
    }
    fittedRef.current = size;
    setFitted(size);
  }, [body, manual]);

  useEffect(() => {
    if (!body) return;
    const scroller = scrollParent(body);
    let frame = 0;
    // Wait a frame so layout reflects the new size before measuring.
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    // The body resizes as rows render and <main> resizes with the layout around the table.
    const observer = new ResizeObserver(schedule);
    observer.observe(body);
    observer.observe(scroller ?? document.documentElement);
    const onWindowResize = () => {
      settled.current = 0;
      changes.current = [];
      schedule();
    };
    window.addEventListener("resize", onWindowResize);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", onWindowResize);
    };
  }, [body, measure]);

  return {
    bodyRef,
    pageSize: manual ?? fitted,
    setPageSize: setManual,
  };
}

/** The standard sizes plus the current one, so an auto-fitted size shows in the menu. */
export function pageSizeOptions(current: number) {
  return Array.from(new Set([current, ...PAGE_SIZE_OPTIONS])).sort((a, b) => a - b);
}

/**
 * TanStack Table pagination state driven by {@link useFitPageSize}. Spread `pagination`
 * into `state` and pass `onPaginationChange`; a size change from the table counts as manual.
 */
export function useFitPagination(rowCount: number, fixedSize?: number) {
  const { bodyRef, pageSize, setPageSize } = useFitPageSize(fixedSize);
  const [page, setPage] = useState({ index: 0, size: pageSize });
  // Auto-fit changes the size outside the table, so carry the page across here.
  if (page.size !== pageSize) {
    setPage({ index: repaginate(page.index, page.size, pageSize, rowCount), size: pageSize });
  }
  const pagination: PaginationState = {
    pageIndex: Math.min(page.index, Math.max(0, Math.ceil(rowCount / pageSize) - 1)),
    pageSize,
  };
  const onPaginationChange = (
    updater: PaginationState | ((old: PaginationState) => PaginationState),
  ) => {
    const next = typeof updater === "function" ? updater(pagination) : updater;
    if (next.pageSize !== pageSize) setPageSize(next.pageSize);
    setPage({ index: next.pageIndex, size: next.pageSize });
  };
  return { bodyRef, pagination, onPaginationChange };
}
