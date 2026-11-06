jest.mock("@/utils/db", () => ({ db: {} }));
jest.mock("@/db/schema", () => ({ statusPages: {} }));
jest.mock("drizzle-orm", () => ({ eq: jest.fn() }));

import { NextRequest } from "next/server";
import { POST } from "./route";

describe("POST /api/status-pages/check", () => {
  it("returns 400 for a malformed JSON body", async () => {
    const req = new NextRequest("http://localhost/api/status-pages/check", {
      method: "POST",
      body: "{not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body" });
  });
});
