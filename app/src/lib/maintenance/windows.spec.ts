jest.mock("@/utils/db", () => ({ db: {} }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
import { windowState } from "./windows";

const at = (m: number) => new Date(Date.UTC(2026, 10, 20, 1, m));
const row = (extra = {}) => ({ cancelledAt: null, completedAt: null, occurrenceStartsAt: at(0), occurrenceEndsAt: at(60), ...extra });

describe("windowState", () => {
  it.each([
    [row(), at(-1), "scheduled"],
    [row(), at(0), "active"],
    [row(), at(59), "active"],
    [row(), at(60), "completed"],
    [row({ completedAt: at(30) }), at(10), "completed"],
    [row({ cancelledAt: at(5) }), at(10), "cancelled"],
    [row({ occurrenceStartsAt: null, occurrenceEndsAt: null }), at(10), "scheduled"],
  ])("%j at %s is %s", (value, now, state) => {
    expect(windowState(value as never, now)).toBe(state);
  });
});
