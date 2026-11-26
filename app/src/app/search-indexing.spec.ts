jest.mock("geist/font/mono", () => ({ GeistMono: { variable: "" } }), { virtual: true });
jest.mock("geist/font/sans", () => ({ GeistSans: { variable: "" } }), { virtual: true });

import { metadata as rootMetadata } from "./layout";
import { metadata as publicMetadata } from "./(public)/layout";
import robots from "./robots";

describe("search indexing", () => {
  it("keeps the signed-in app out of search results", () => {
    expect(rootMetadata.robots).toEqual({ index: false, follow: false });
  });

  it("lets public status pages be indexed", () => {
    expect(publicMetadata.robots).toEqual({ index: true, follow: true });
  });

  it("keeps crawlers off the 401 API routes without blocking status pages", () => {
    const rules = [robots().rules].flat();
    const disallow = rules.flatMap((rule) => rule.disallow ?? []);
    expect(disallow).toContain("/api/");
    expect(disallow).not.toContain("/");
  });
});
