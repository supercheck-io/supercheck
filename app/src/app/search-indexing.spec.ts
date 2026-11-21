jest.mock("geist/font/mono", () => ({ GeistMono: { variable: "" } }), { virtual: true });
jest.mock("geist/font/sans", () => ({ GeistSans: { variable: "" } }), { virtual: true });

import { metadata as rootMetadata } from "./layout";
import { metadata as publicMetadata } from "./(public)/layout";

describe("search indexing", () => {
  it("keeps the signed-in app out of search results", () => {
    expect(rootMetadata.robots).toEqual({ index: false, follow: false });
  });

  it("lets public status pages be indexed", () => {
    expect(publicMetadata.robots).toEqual({ index: true, follow: true });
  });
});
