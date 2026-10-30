/** @jest-environment node */
const mockSend = jest.fn();
jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn(() => ({ send: (...args: unknown[]) => mockSend(...args) })),
  GetObjectCommand: jest.fn((input) => ({ input })),
}));

import { fetchFromS3 } from "./s3-proxy";

const body = (text: string) => ({
  transformToWebStream: () => new Response(text).body,
});

describe("fetchFromS3", () => {
  beforeEach(() => jest.clearAllMocks());

  it("streams the body and defaults to private, no-store", async () => {
    mockSend.mockResolvedValue({ Body: body("hello"), ContentLength: 5, ContentType: "text/plain" });
    const response = await fetchFromS3("b", "k");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-length")).toBe("5");
    expect(await response.text()).toBe("hello");
  });

  it("logs and aborts the download when S3 fails mid-stream", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const failing = new ReadableStream({ pull() { throw new Error("socket reset"); } });
    mockSend.mockResolvedValue({ Body: { transformToWebStream: () => failing } });
    const response = await fetchFromS3("b", "k");
    await expect(response.text()).rejects.toThrow("socket reset");
    expect(spy).toHaveBeenCalledWith("[S3 PROXY] Stream error while reading:", "b/k", expect.any(Error));
    spy.mockRestore();
  });

  it("lets a caller opt into public caching", async () => {
    mockSend.mockResolvedValue({ Body: body("x") });
    const response = await fetchFromS3("b", "k", { cacheControl: "public, max-age=60" });
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
  });

  it("forwards Range and returns 206 with Content-Range and the ranged length", async () => {
    mockSend.mockResolvedValue({ Body: body("ell"), ContentLength: 3, ContentRange: "bytes 1-3/5" });
    const response = await fetchFromS3("b", "k", { range: "bytes=1-3" });
    expect(mockSend.mock.calls[0][0].input.Range).toBe("bytes=1-3");
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 1-3/5");
    expect(response.headers.get("content-length")).toBe("3");
    expect(await response.text()).toBe("ell");
  });

  it("maps InvalidRange to 416", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockSend.mockRejectedValue(Object.assign(new Error("bad"), { name: "InvalidRange" }));
    expect((await fetchFromS3("b", "k", { range: "bytes=99-" })).status).toBe(416);
  });
});
