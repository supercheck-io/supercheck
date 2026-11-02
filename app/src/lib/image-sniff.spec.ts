/** @jest-environment node */
jest.mock("@aws-sdk/client-s3", () => ({ S3Client: jest.fn() }));
import { sniffImageType } from "./image-sniff";

const bytes = (...v: number[]) => new Uint8Array([...v, ...new Array(16).fill(0)]);
const text = (s: string) => new Uint8Array(Buffer.from(s));

describe("sniffImageType", () => {
  it.each([
    [bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), "image/png"],
    [bytes(0xff, 0xd8, 0xff), "image/jpeg"],
    [bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61), "image/gif"],
    [text('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'), "image/svg+xml"],
    [text('﻿  <svg xmlns="http://www.w3.org/2000/svg"></svg>'), "image/svg+xml"],
    [text('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" ""><svg/>'), "image/svg+xml"],
    [text(`<?xml version="1.0"?><!-- Generator: Adobe Illustrator --><!DOCTYPE svg [${'<!ENTITY ns_x "http://ns.adobe.com/x/">'.repeat(60)}]><svg version="1.1"></svg>`), "image/svg+xml"],
  ])("detects %#", (input, expected) => {
    expect(sniffImageType(input)).toBe(expected);
  });

  it.each([
    text("<html><script>alert(1)</script></html>"),
    text("<?xml version='1.0'?><root/>"),
    text("<html><body><svg></svg><script>alert(1)</script></body></html>"),
    bytes(0x4d, 0x5a),
  ])("rejects non-image content %#", (input) => {
    expect(sniffImageType(input)).toBeNull();
  });
});
