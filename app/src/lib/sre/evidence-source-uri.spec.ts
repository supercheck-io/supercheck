import { isSafeEvidenceSourceUri, safeEvidenceSourceUri } from "./evidence-source-uri";

describe("evidence source URI policy", () => {
  it.each([
    "https://grafana.example/explore",
    "http://localhost:3000/incidents/1",
    "/monitors/018f0000-0000-7000-8000-000000000001",
  ])("allows explicit HTTP(S) and same-origin paths: %s", (value) => {
    expect(isSafeEvidenceSourceUri(value)).toBe(true);
    expect(safeEvidenceSourceUri(value)).toBe(value);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "//attacker.example/path",
    "not-a-url",
  ])("blocks unsafe or ambiguous links: %s", (value) => {
    expect(isSafeEvidenceSourceUri(value)).toBe(false);
    expect(safeEvidenceSourceUri(value)).toBe("#");
  });
});
