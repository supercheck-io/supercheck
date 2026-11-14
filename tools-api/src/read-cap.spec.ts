import { describe, expect, it, vi } from "vitest";
import { readCapped } from "./context";
import { extractHead } from "./tools/social";

function chunked(parts: string[], onCancel = vi.fn()) {
  const enc = new TextEncoder();
  let i = 0;
  return new Response(
    new ReadableStream({
      pull(c) {
        if (i < parts.length) c.enqueue(enc.encode(parts[i++]));
        else c.close();
      },
      cancel: onCancel,
    }),
  );
}

describe("readCapped", () => {
  it("reads a small body whole", async () => {
    expect(await readCapped(chunked(["ab", "cd"]), 10)).toEqual({ text: "abcd", truncated: false });
  });

  it("stops at the cap, flags truncation and cancels the rest", async () => {
    const cancel = vi.fn();
    const r = await readCapped(chunked(["a".repeat(60 * 1024), "b".repeat(10 * 1024), "c"], cancel), 64 * 1024);
    expect(r.text.length).toBe(64 * 1024);
    expect(r.truncated).toBe(true);
    expect(cancel).toHaveBeenCalled();
  });

  it("is not truncated when the body is exactly the cap", async () => {
    expect(await readCapped(chunked(["abcd"]), 4)).toEqual({ text: "abcd", truncated: false });
  });

  it.each([16 * 1024, 128 * 1024])("honours the %d byte cap", async (cap) => {
    const r = await readCapped(chunked(["x".repeat(cap + 1)]), cap);
    expect(r.text.length).toBe(cap);
    expect(r.truncated).toBe(true);
  });

  it("handles a missing body", async () => {
    expect(await readCapped(new Response(null), 10)).toEqual({ text: "", truncated: false });
  });
});

describe("social head reader", () => {
  it("stops at </head> without reading the body", async () => {
    const cancel = vi.fn();
    const r = await extractHead(
      chunked(['<html><head><meta property="og:title" content="T"></head>', "<body>", '<meta property="og:description" content="late">'], cancel),
    );
    expect(r.tags).toEqual({ "og:title": "T" });
  });

  it("stops after 64 KB and flags truncation", async () => {
    const r = await extractHead(chunked(["<html><head>", "<!--" + "x".repeat(70 * 1024) + "-->", '<meta property="og:title" content="late">']));
    expect(r.truncated).toBe(true);
    expect(r.tags["og:title"]).toBeUndefined();
  });
});
