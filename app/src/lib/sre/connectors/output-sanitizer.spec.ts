import { redactConnectorText, sanitizeConnectorEvidence } from "./output-sanitizer";
import { type ConnectorEvidenceItem } from "./connector-base";

const item: ConnectorEvidenceItem = {
  id: "evidence_1",
  source: "github",
  sourceUri: "https://api.github.com/repos/acme/app?access_token=ghp_abcdefghijklmnopqrstuvwxyz",
  title: "Deploy by alice@example.com",
  summary: "Authorization: Bearer secret-token-123 caused no issue",
  rawContent: "password=hunter2 api_key=super-secret ghp_abcdefghijklmnopqrstuvwxyz",
  evidenceType: "deployment",
  metadata: {
    timestamp: new Date("2026-06-21T10:00:00.000Z"),
    tags: ["deploy"],
  },
  citation: {
    connectorId: "connector_1",
    query: "token=ghp_abcdefghijklmnopqrstuvwxyz",
    resultHash: "hash_1",
  },
};

describe("sanitizeConnectorEvidence", () => {
  it("redacts JSON secret fields including escaped quotes before persistence", () => {
    const rawContent = JSON.stringify({
      password: 'private "quoted" value',
      access_token: "fixture-token",
      apiKey: "fixture-key",
      message: "Useful diagnostic evidence",
    });
    const result = sanitizeConnectorEvidence([{ ...item, rawContent }]);
    expect(JSON.parse(result.items[0].rawContent!)).toEqual({
      password: "[REDACTED]",
      access_token: "[REDACTED]",
      apiKey: "[REDACTED]",
      message: "Useful diagnostic evidence",
    });
  });

  it("redacts secrets and PII before returning connector evidence", () => {
    const result = sanitizeConnectorEvidence([item], { maxRows: 10, maxBytes: 10_000, maxSeconds: 10 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe("Deploy by [REDACTED_EMAIL]");
    expect(result.items[0].summary).toBe("Authorization: Bearer [REDACTED] caused no issue");
    expect(result.items[0].rawContent).not.toContain("hunter2");
    expect(result.items[0].rawContent).not.toContain("ghp_");
    expect(result.resultHash).toHaveLength(64);
  });

  it("enforces row limits", () => {
    const result = sanitizeConnectorEvidence([item, { ...item, id: "evidence_2" }], {
      maxRows: 1,
      maxBytes: 10_000,
      maxSeconds: 10,
    });

    expect(result.items).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });

  it("neutralizes unsafe evidence link schemes", () => {
    const result = sanitizeConnectorEvidence(
      [{ ...item, sourceUri: "javascript:alert(1)" }],
      { maxRows: 10, maxBytes: 10_000, maxSeconds: 10 },
    );

    expect(result.items[0].sourceUri).toBe("#");
  });
});

describe("redactConnectorText", () => {
  it.each([
    ["AWS access key", "key AKIAIOSFODNN7EXAMPLE used", "AKIAIOSFODNN7EXAMPLE"],
    ["JWT", "auth eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk end", "eyJhbGciOiJIUzI1NiJ9"],
    ["API key", "using sk-abcdefghijklmnopqrstuvwxyz123456 now", "sk-abcdefghijklmnopqrstuvwxyz123456"],
    ["private key", "-----BEGIN RSA PRIVATE KEY-----\nMIIEabc\n-----END RSA PRIVATE KEY----- tail", "MIIEabc"],
  ])("redacts %s", (_name, input, secret) => {
    const redacted = redactConnectorText(input);
    expect(redacted).not.toContain(secret);
    expect(redacted).toContain("[REDACTED");
  });

  it("still redacts email addresses", () => {
    expect(redactConnectorText("contact jane.doe+ops@example.co.uk now")).toBe("contact [REDACTED_EMAIL] now");
  });

  it("leaves ordinary log text untouched", () => {
    expect(redactConnectorText("GET /health 200 in 12ms")).toBe("GET /health 200 in 12ms");
  });

  it("redacts adversarial dash-separated input in linear time", () => {
    const hostile = "-eyJ".repeat(40_000);
    const started = Date.now();
    redactConnectorText(hostile);
    expect(Date.now() - started).toBeLessThan(500);
  });
});
