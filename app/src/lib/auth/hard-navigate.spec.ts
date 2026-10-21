import { hardNavigate } from "./hard-navigate";

describe("hardNavigate", () => {
  it("leaves the single-page app by assigning window.location (jsdom only implements fragment navigation)", () => {
    window.location.hash = "";
    hardNavigate("#resumed");
    expect(window.location.hash).toBe("#resumed");
  });
});
