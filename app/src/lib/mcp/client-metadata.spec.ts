import { REGISTRATION_LIMITS, displayClientName, registrationProblem } from "./client-metadata";

const valid = { client_name: "My Agent", redirect_uris: ["http://127.0.0.1:8765/callback"] };

describe("registrationProblem", () => {
  it("accepts an ordinary registration, including optional metadata", () => {
    expect(registrationProblem(valid)).toBeNull();
    expect(
      registrationProblem({
        ...valid,
        client_uri: "https://agent.example.com",
        logo_uri: "https://agent.example.com/logo.png",
        tos_uri: "https://agent.example.com/tos",
        policy_uri: "https://agent.example.com/privacy",
        software_id: "agent-cli",
        software_version: "1.2.3",
        contacts: ["dev@agent.example.com"],
      }),
    ).toBeNull();
    expect(registrationProblem({ redirect_uris: ["cursor://anysphere.cursor-mcp/oauth/callback"] })).toBeNull();
  });

  it.each([null, undefined, "string", 42, [], [valid]])("refuses a body that is not an object: %p", (body) => {
    expect(registrationProblem(body)).not.toBeNull();
  });

  it.each([
    ["a NUL byte (which makes PostgreSQL reject the insert)", { ...valid, client_name: "Agent\u0000" }],
    ["a bidirectional override", { ...valid, client_name: "Sup‮ercheck" }],
    ["a bidirectional isolate", { ...valid, client_name: "a⁦b" }],
    ["another control character", { ...valid, client_name: "a\u0007b" }],
    ["a name longer than the limit", { ...valid, client_name: "A".repeat(REGISTRATION_LIMITS.nameLength + 1) }],
    ["a non-string name", { ...valid, client_name: { evil: true } }],
    ["no redirect_uris", { client_name: "x" }],
    ["an empty redirect_uris", { ...valid, redirect_uris: [] }],
    ["a redirect_uris that is not an array", { ...valid, redirect_uris: "http://127.0.0.1/cb" }],
    ["too many redirect URIs", { ...valid, redirect_uris: Array.from({ length: 11 }, (_, i) => `http://127.0.0.1:${9000 + i}/cb`) }],
    ["an over-long redirect URI", { ...valid, redirect_uris: [`http://127.0.0.1/${"a".repeat(2048)}`] }],
    ["a NUL in a redirect URI", { ...valid, redirect_uris: ["http://127.0.0.1/cb\u0000"] }],
    ["a non-string redirect URI", { ...valid, redirect_uris: [42] }],
    ["a javascript: logo", { ...valid, logo_uri: "javascript:alert(1)" }],
    ["a data: client_uri", { ...valid, client_uri: "data:text/html,x" }],
    ["a plain-http tos_uri", { ...valid, tos_uri: "http://agent.example.com/tos" }],
    ["a malformed policy_uri", { ...valid, policy_uri: "not a url" }],
    ["an over-long software_id", { ...valid, software_id: "x".repeat(257) }],
    ["too many contacts", { ...valid, contacts: Array.from({ length: 11 }, (_, i) => `c${i}@example.com`) }],
    ["a non-array contacts", { ...valid, contacts: "a@example.com" }],
  ])("refuses %s", (_name, body) => {
    expect(registrationProblem(body)).not.toBeNull();
  });

  it("allows the limits exactly", () => {
    expect(registrationProblem({ ...valid, client_name: "A".repeat(REGISTRATION_LIMITS.nameLength) })).toBeNull();
    expect(
      registrationProblem({ redirect_uris: Array.from({ length: 10 }, (_, i) => `http://127.0.0.1:${9000 + i}/cb`) }),
    ).toBeNull();
  });
});

describe("displayClientName", () => {
  it("removes invisible and bidirectional characters, then trims", () => {
    expect(displayClientName("  Sup‮ercheck​ Official\u0000 ")).toBe("Supercheck Official");
  });

  it("shortens long names with an ellipsis", () => {
    const shown = displayClientName("x".repeat(500), 80);
    expect(shown).toHaveLength(80);
    expect(shown.endsWith("…")).toBe(true);
  });

  it("returns an empty string when nothing printable remains", () => {
    expect(displayClientName("​‮")).toBe("");
    expect(displayClientName(null)).toBe("");
    expect(displayClientName(undefined)).toBe("");
  });

  it("keeps ordinary non-Latin names", () => {
    expect(displayClientName("监控助手 🤖")).toBe("监控助手 🤖");
  });
});
