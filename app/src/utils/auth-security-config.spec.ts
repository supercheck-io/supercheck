/** @jest-environment node */
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { captcha } from "better-auth/plugins";
import { execFileSync } from "node:child_process";

const source = ts.createSourceFile(
  "auth.ts",
  readFileSync(path.join(process.cwd(), "src/utils/auth.ts"), "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
function property(name: string) {
  let value: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === name)
      value = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!value) throw new Error(`Missing auth configuration: ${name}`);
  return value;
}

it.each(["sign-up/email", "sign-in/email", "request-password-reset"])("requires CAPTCHA on /%s", async (endpoint) => {
  const endpoints = JSON.parse(
    property("endpoints").getText(source),
  ) as string[];
  const plugin = captcha({
    provider: "cloudflare-turnstile",
    secretKey: "test-only",
    endpoints,
  });
  const result = await plugin.onRequest!(
    new Request(`https://example.com/api/auth/${endpoint}`, {
      method: "POST",
    }),
    {
      options: { basePath: "/api/auth" },
      logger: { error: jest.fn() },
    } as never,
  );
  expect(result?.response.status).toBe(400);
  expect(await result?.response.json()).toMatchObject({
    code: "MISSING_RESPONSE",
  });
});

it("enables the installed password reset handler's session-revocation option", () => {
  expect(property("revokeSessionsOnPasswordReset").kind).toBe(
    ts.SyntaxKind.TrueKeyword,
  );
});


it("revokes existing sessions and rejects reset-token replay", () => {
  expect(execFileSync(process.execPath, ["scripts/check-password-reset.mjs"], { encoding: "utf8" })).toContain("Password reset session and replay checks passed");
});


it.each([false, true])("validates reset CAPTCHA responses (success=%s)", async (success) => {
  const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({ success }),
  );
  try {
    const plugin = captcha({
      provider: "cloudflare-turnstile",
      secretKey: "test-only",
      endpoints: JSON.parse(property("endpoints").getText(source)) as string[],
    });
    const result = await plugin.onRequest!(
      new Request("https://example.com/api/auth/request-password-reset", {
        method: "POST",
        headers: { "x-captcha-response": "test-response" },
      }),
      {
        options: { basePath: "/api/auth" },
        logger: { error: jest.fn(), warn: jest.fn() },
      } as never,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    if (success) {
      expect(result).toBeUndefined();
    } else {
      expect(result?.response.status).toBe(403);
      expect(await result?.response.json()).toMatchObject({ code: "VERIFICATION_FAILED" });
    }
  } finally {
    fetchMock.mockRestore();
  }
});
