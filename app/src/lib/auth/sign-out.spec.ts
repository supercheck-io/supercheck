const order: string[] = [];
jest.mock("@/utils/auth-client", () => ({ signOut: jest.fn(async () => { order.push("signOut"); return { error: null }; }) }));
jest.mock("@/components/auth-guard", () => ({ clearAuthSession: () => order.push("auth") }));
jest.mock("@/components/support/chatwoot-widget", () => ({ resetChatwootSession: () => order.push("chat") }));
jest.mock("@/lib/query-provider", () => ({ clearQueryCache: () => order.push("query") }));
jest.mock("@/hooks/use-project-context", () => ({ clearProjectsCache: () => order.push("projects") }));

import { signOutAndClear } from "./sign-out";

it("clears every client cache before ending the session and returns the result", async () => {
  const result = await signOutAndClear();
  expect(order).toEqual(["auth", "projects", "query", "chat", "signOut"]);
  expect(result).toEqual({ error: null });
});
