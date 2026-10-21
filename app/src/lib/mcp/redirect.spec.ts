import { isSafeRedirectTarget } from "./redirect";

describe("isSafeRedirectTarget", () => {
  it.each([
    "https://client.example/callback?code=abc&state=xyz",
    "http://127.0.0.1:8765/callback?code=abc",
    "http://localhost:3118/callback",
    "cursor://anysphere.cursor-mcp/oauth/callback?code=abc",
    "vscode://vscode.github-authentication/did-authenticate",
    "com.example.app:/oauth2redirect?code=abc",
  ])("allows %s", (url) => {
    expect(isSafeRedirectTarget(url)).toBe(true);
  });

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "blob:https://client.example/abc",
    "about:blank",
    "not a url",
    "/relative/path",
    "",
    null,
    undefined,
    `https://client.example/${"a".repeat(5000)}`,
  ])("refuses %p", (url) => {
    expect(isSafeRedirectTarget(url as string | null | undefined)).toBe(false);
  });
});
