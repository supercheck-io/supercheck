import { openIntervals } from "./status-page-incident-intervals";

const at = (iso: string) => new Date(iso);

it("opens at creation, closes on resolved and reopens on a later update", () => {
  expect(openIntervals(at("2026-11-20T10:00:00Z"), [
    { status: "investigating", at: at("2026-11-20T10:00:00Z") },
    { status: "resolved", at: at("2026-11-20T12:00:00Z") },
    { status: "resolved", at: at("2026-11-21T09:00:00Z") }, // follow-up note while resolved
    { status: "identified", at: at("2026-11-22T11:00:00Z") },
  ])).toEqual([
    ["2026-11-20T10:00:00.000Z", "2026-11-20T12:00:00.000Z"],
    ["2026-11-22T11:00:00.000Z", null],
  ]);
});

it("leaves an incident without updates open from creation", () => {
  expect(openIntervals(at("2026-11-20T10:00:00Z"), [])).toEqual([["2026-11-20T10:00:00.000Z", null]]);
});

it("keeps an incident posted already resolved closed, but opens it when reopened later", () => {
  expect(openIntervals(at("2026-11-20T10:00:00.000Z"), [{ status: "resolved", at: at("2026-11-20T10:00:00.004Z") }])).toEqual([]);
  expect(openIntervals(at("2026-11-20T10:00:00.000Z"), [
    { status: "resolved", at: at("2026-11-20T10:00:00.004Z") },
    { status: "investigating", at: at("2026-11-21T08:00:00Z") },
  ])).toEqual([["2026-11-21T08:00:00.000Z", null]]);
});
