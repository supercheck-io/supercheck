/** @jest-environment node */
const requireAuthContext = jest.fn();
jest.mock("@/lib/auth-context", () => {
  const actual = jest.requireActual("@/lib/auth-context");
  return { ...actual, requireAuthContext: () => requireAuthContext() };
});
jest.mock("@/utils/db", () => ({ db: {} }));
jest.mock("@/lib/queue-event-hub", () => ({ getQueueEventHub: jest.fn() }));
jest.mock("./route.helpers", () => ({
  fetchEventStatusReport: jest.fn(),
  fetchInitialStatusReport: jest.fn(),
  shouldStreamTestStatusEvent: jest.fn(),
}));

import { AuthError } from "@/lib/auth-context";
import { GET } from "./route";

const request = () =>
  new Request("http://localhost/api/test-status/events/0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b");

describe("GET /api/test-status/events/[testId] auth", () => {
  it("returns 403 when signed in but not permitted", async () => {
    requireAuthContext.mockRejectedValueOnce(new AuthError("no access", 403));
    expect((await GET(request())).status).toBe(403);
  });

  it("returns 401 when unauthenticated", async () => {
    requireAuthContext.mockRejectedValueOnce(new AuthError("no session"));
    expect((await GET(request())).status).toBe(401);
  });
});
