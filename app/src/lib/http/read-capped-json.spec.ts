/** @jest-environment node */
import { NextResponse } from "next/server";
import { readJsonBody } from "./read-capped-json";
import { declaredOversizeRequest, jsonRequest, streamedOversizeRequest } from "@/lib/security/request-hardening.spec-helpers";

describe("readJsonBody", () => {
  it("returns the parsed body under the cap", async () => {
    expect(await readJsonBody(jsonRequest("/x", "POST", { a: 1 }), 1024)).toEqual({ body: { a: 1 } });
  });

  it("refuses a declared oversize body with 413", async () => {
    const res = await readJsonBody(declaredOversizeRequest("/x", "POST", 2048), 1024);
    expect((res as NextResponse).status).toBe(413);
  });

  it("refuses an oversize body with no Content-Length once the stream passes the cap", async () => {
    const res = await readJsonBody(streamedOversizeRequest("/x", "POST", 4096), 1024);
    expect((res as NextResponse).status).toBe(413);
  });

  it("answers 400 for invalid or empty JSON", async () => {
    const bad = new Request("http://localhost/x", { method: "POST", body: "{not json" });
    expect(((await readJsonBody(bad, 1024)) as NextResponse).status).toBe(400);
    expect(((await readJsonBody(new Request("http://localhost/x", { method: "POST" }), 1024)) as NextResponse).status).toBe(400);
  });
});
