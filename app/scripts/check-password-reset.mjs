import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";

const source = ts.createSourceFile("auth.ts", readFileSync(new URL("../src/utils/auth.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
let revokeSessionsOnPasswordReset = false;
function visit(node) {
  if (ts.isPropertyAssignment(node) && node.name.getText(source) === "revokeSessionsOnPasswordReset")
    revokeSessionsOnPasswordReset = node.initializer.kind === ts.SyntaxKind.TrueKeyword;
  ts.forEachChild(node, visit);
}
visit(source);
let resetToken;
const auth = betterAuth({
  baseURL: "http://localhost:3000",
  secret: "test-only-password-reset-secret-32-chars",
  database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
  emailAndPassword: {
    enabled: true,
    revokeSessionsOnPasswordReset,
    sendResetPassword: async ({ token }) => { resetToken = token; },
  },
});
const email = "reset-test@example.test";
await auth.api.signUpEmail({ body: { name: "Reset test", email, password: "first-password-123" } });
const sessions = [];
for (let index = 0; index < 2; index++) {
  const login = await auth.api.signInEmail({ body: { email, password: "first-password-123" }, asResponse: true });
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert(cookie, "Missing login session cookie");
  const headers = new Headers({ cookie });
  assert((await auth.api.getSession({ headers }))?.user);
  sessions.push(headers);
}
await auth.api.requestPasswordReset({ body: { email } });
assert(resetToken, "Reset token was not issued");
await auth.api.resetPassword({ body: { token: resetToken, newPassword: "new-password-456" } });
for (const headers of sessions) {
  assert.equal(await auth.api.getSession({ headers }), null, "Old session survived password reset");
}
await assert.rejects(() => auth.api.resetPassword({ body: { token: resetToken, newPassword: "replay-password-789" } }));
assert((await auth.api.signInEmail({ body: { email, password: "new-password-456" } })).user);
console.log("Password reset session and replay checks passed");
