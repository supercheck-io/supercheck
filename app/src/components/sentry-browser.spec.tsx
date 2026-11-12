import { isExcludedPath } from "./sentry-browser";

jest.mock("@/utils/auth-client", () => ({ useSession: () => ({ data: null }) }));

describe("isExcludedPath", () => {
  it.each([
    ["/status/abc", true],
    ["/sign-in", true],
    ["/invite/tok", true],
    ["/billing/success", true],
    ["/org-admin", true],
    ["/subscribe", true],
    ["/", false],
    ["/tests/123", false],
    ["/statuses", false],
  ])("%s -> %s", (path, expected) => {
    expect(isExcludedPath(path)).toBe(expected);
  });
});
