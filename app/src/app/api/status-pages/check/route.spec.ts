/** @jest-environment node */
const rows: { id: string; status: string }[] = [];
jest.mock("@/utils/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => rows }) }) }) },
}));
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

  it("answers a draft page exactly like a missing one", async () => {
    const check = async () => {
      const res = await POST(new NextRequest("http://localhost/api/status-pages/check", {
        method: "POST",
        body: JSON.stringify({ subdomain: "acme" }),
      }));
      return { status: res.status, body: await res.json() };
    };
    rows.length = 0;
    const missing = await check();
    rows.push({ id: "p1", status: "draft" });
    expect(await check()).toEqual(missing);
    expect(missing).toEqual({ status: 404, body: { error: "Status page not found" } });
    rows[0].status = "published";
    expect(await check()).toEqual({ status: 200, body: { id: "p1", status: "published" } });
  });
});
