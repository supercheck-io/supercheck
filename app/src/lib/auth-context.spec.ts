/**
 * Draft test for task 24 — `isAuthError` classification.
 *
 * Why this test exists: `app/src/lib/auth-context.ts` has no spec. Every consumer
 * stubs `isAuthError` with `jest.fn(() => false)` (see
 * `src/app/api/execution-routes.spec.ts:21`, `src/app/api/organizations/route.spec.ts:3`,
 * and the members/invite route spec). So the real classification logic — which
 * decides whether a failed request becomes a 401 or a 500 — has no coverage at
 * all, and a regression in it would leave every test green while changing the
 * HTTP status users receive.
 *
 * This test must FAIL when the behaviour is broken; that was verified by removing
 * one message branch from the implementation and re-running.
 */
import { AuthError, isAuthError, isProjectConfigError } from "./auth-context";

describe("isAuthError", () => {
  it("treats an AuthError instance as an authentication error", () => {
    expect(isAuthError(new AuthError("anything at all"))).toBe(true);
  });

  it.each([
    "Authentication required",
    "Invalid or expired CLI token",
    "Invalid token type. Use a CLI token for API access.",
    "Authentication failed",
    "No active project found",
  ])("classifies the documented message %p as an authentication error", (message) => {
    expect(isAuthError(new Error(message))).toBe(true);
  });

  it("is case-insensitive, since guards uppercase these messages inconsistently", () => {
    expect(isAuthError(new Error("AUTHENTICATION REQUIRED"))).toBe(true);
  });

  it.each([
    "ECONNREFUSED connecting to postgres",
    "duplicate key value violates unique constraint",
    "Insufficient permissions",
    "",
  ])("does not classify the unrelated error %p as an authentication error", (message) => {
    expect(isAuthError(new Error(message))).toBe(false);
  });

  it.each([undefined, null, "Authentication required", 42, {}, []])(
    "returns false rather than throwing for the non-Error value %p",
    (value) => {
      expect(isAuthError(value)).toBe(false);
    },
  );
});

describe("isAuthError / isProjectConfigError overlap", () => {
  /**
   * Documents a real ambiguity rather than asserting a preference.
   *
   * `isProjectConfigError`'s own doc comment (auth-context.ts:81-83) says a
   * missing project "should typically return 404 or 422, not 401". But the
   * message "no active project found" is ALSO one of `isAuthError`'s patterns,
   * so a handler that tests `isAuthError` first returns 401 for a
   * missing-project condition. This test pins the current behaviour so that any
   * change to it is deliberate; the router-level expectation is for a human to
   * decide.
   */
  it("currently matches both predicates for a missing-project message", () => {
    const missingProject = new Error("No active project found");
    expect(isAuthError(missingProject)).toBe(true);
    expect(isProjectConfigError(missingProject)).toBe(true);
  });
});
