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
  it("redacts titles before clipping so a key cut at the limit is still caught", () => {
    const title = `${"x".repeat(190)} AKIAABCDEFGHIJKLMNOP`;
    const [row] = sanitizeConnectorEvidence([{ ...item, title }]).items;
    expect(row.title).not.toMatch(/AKIA/);
    expect(row.title.length).toBeLessThanOrEqual(200);
  });

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

describe("redactConnectorText connection strings", () => {
  it.each([
    ["postgres://user:s3cret@db:5432/x", "postgres://user:[REDACTED]@db:5432/x"],
    ["postgres://user:s3cret@db.example.com:5432/x", "postgres://user:[REDACTED]@db.example.com:5432/x"],
    ["redis://admin:hunter2@cache.internal/0", "redis://admin:[REDACTED]@cache.internal/0"],
    ["redis://:pw@host:6379", "redis://:[REDACTED]@host:6379"],
    ["postgres://user:pa/ss@host/db", "postgres://user:[REDACTED]@host/db"],
    ["postgres://u:p@ss@h/db", "postgres://u:[REDACTED]@h/db"],
    ["https://ghp_xxx@github.com/a/b", "https://[REDACTED]@github.com/a/b"],
    ["https://glpat-abc123@gitlab.com", "https://[REDACTED]@gitlab.com"],
    [`https://${"a1b2c3d4".repeat(4)}@api.example.com`, "https://[REDACTED]@api.example.com"],
  ])("redacts only the password in %s", (input, expected) => {
    expect(redactConnectorText(input)).toBe(expected);
  });

  it("does not treat a port followed by a comma as a password (the email is still redacted)", () => {
    expect(redactConnectorText("https://example.com:8080,owner@acme.io")).toBe("https://example.com:8080,[REDACTED_EMAIL]");
  });

  it("leaves URLs without credentials unchanged", () => {
    for (const url of ["https://example.com:8443/path?a=1", "http://db:5432/x", "https://example.com:8443/p?e=a@localhost", "http://[::1]:8080/path?x=a@b"]) {
      expect(redactConnectorText(url)).toBe(url);
    }
  });
});

describe("redactConnectorText secret shapes", () => {
  it.each([
    "DB_PASSWORD=hunter2xyz",
    "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIbPxRfiCYEXAMPLEKEY",
    "SECRET_KEY=hunter2xyz",
    "client_secret=hunter2xyz",
    '{"clientSecret":"hunter2xyz","db_password":"hunter2xyz","accessToken":"hunter2xyz"}',
    '{"credentials":"hunter2xyz","Authorization":"hunter2xyz"}',
    "GET http://rustfs:9000/b/trace.zip?X-Amz-Credential=hunter2xyz&X-Amz-Signature=hunter2xyz",
    "https://x.example.com/f?sig=hunter2xyz",
    "key AIzaSyA-hunter2xyz0123456789abcdefghijk",
    "https://hooks.slack.com/services/T000/B000/hunter2xyz",
    "push with github_pat_hunter2xyz0123456789abcdef",
    "token glpat-hunter2xyz0123456789ab",
    "dsn sntrys_hunter2xyz0123456789abcdef",
    "charge sk_live_hunter2xyz0123456789",
    "Authorization: Basic aHVudGVyMnh5ejpodW50ZXIyeHl6",
    "clientSecret=hunter2xyz private_key=hunter2xyz DB_PASS=hunter2xyz",
    "key AIzaSy0123456789abcdefghijklmnopqrstuv-",
  ])("redacts %s", (input) => {
    expect(redactConnectorText(input)).not.toMatch(/hunter2xyz|AIzaSy|aHVudGVy|wJalr/);
  });

  it("keeps JSON fields whose names only contain a secret word", () => {
    const json = '{"tokenizer":"gpt","token_count":"5","secret_name":"db"}';
    expect(redactConnectorText(json)).toBe(json);
  });

  it("leaves names that only contain a secret word as a substring alone", () => {
    const text = "tokenizer=fast monkey=banana bypass=on token_count: 5 password_policy: strong secret_name: foo";
    expect(redactConnectorText(text)).toBe(text);
  });
});
