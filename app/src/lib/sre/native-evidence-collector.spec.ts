jest.mock("@/utils/db", () => ({ db: {} }));

import { redact } from "./native-evidence-collector";

describe("redact", () => {
  it("removes bearer tokens and quoted secret values completely", () => {
    const out = redact(
      JSON.stringify({
        Authorization: "Bearer sk_live_abc123",
        password: "p@ss word",
        Cookie: "session=abc; other=1",
        token: "t0k3n",
      })
    );
    for (const secret of ["sk_live_abc123", "p@ss word","session=abc", "t0k3n"]) {
      expect(out).not.toContain(secret);
    }
  });

  it("removes basic credentials", () => {
    expect(redact("Basic dXNlcjpwYXNz")).not.toContain("dXNlcjpwYXNz");
  });

  it("keeps non-secret fields", () => {
    expect(redact('{"method":"GET"}')).toContain('"method":"GET"');
  });
});
