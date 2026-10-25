import { isOpenIncident } from "./recent-failures";

describe("isOpenIncident", () => {
  it("treats everything except resolved as open", () => {
    expect(isOpenIncident({ status: "triggered" })).toBe(true);
    expect(isOpenIncident({ status: "verifying" })).toBe(true);
    expect(isOpenIncident({ status: "resolved" })).toBe(false);
  });
});
