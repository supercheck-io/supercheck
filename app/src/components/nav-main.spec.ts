jest.mock("next/navigation", () => ({ usePathname: jest.fn(), useRouter: jest.fn() }));

import { isCurrentRoute } from "./nav-main";

describe("isCurrentRoute", () => {
  it("matches the item's page and its sub-pages", () => {
    expect(isCurrentRoute("/monitors", "/monitors")).toBe(true);
    expect(isCurrentRoute("/monitors/abc/edit", "/monitors")).toBe(true);
  });

  it("does not match a sibling route that shares a prefix", () => {
    expect(isCurrentRoute("/monitors-archive", "/monitors")).toBe(false);
  });

  it("matches the dashboard only on its own path", () => {
    expect(isCurrentRoute("/", "/")).toBe(true);
    expect(isCurrentRoute("/monitors", "/")).toBe(false);
  });
});
