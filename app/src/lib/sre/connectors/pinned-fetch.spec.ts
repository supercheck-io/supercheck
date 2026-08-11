/** @jest-environment node */

import { EventEmitter } from "node:events";

jest.mock("node:dns/promises", () => ({ lookup: jest.fn() }));
jest.mock("node:https", () => ({
  __esModule: true,
  default: { request: jest.fn() },
}));

import { lookup } from "node:dns/promises";
import https from "node:https";
import { fetchPublicEndpoint } from "./pinned-fetch";

const mockLookup = lookup as jest.MockedFunction<typeof lookup>;
const mockRequest = https.request as jest.MockedFunction<typeof https.request>;

describe("pinned public fetch", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(process.env, "NODE_ENV", {
      value: "production",
      configurable: true,
      writable: true,
    });
  });

  afterAll(() => {
    Object.defineProperty(process.env, "NODE_ENV", {
      value: originalNodeEnv,
      configurable: true,
      writable: true,
    });
  });

  it("rejects a hostname resolving to a private address before connecting", async () => {
    (mockLookup as jest.Mock).mockResolvedValueOnce([
      { address: "169.254.169.254", family: 4 },
    ]);

    await expect(
      fetchPublicEndpoint("https://hooks.example.com/events"),
    ).rejects.toThrow("private or reserved IP ranges");
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("pins the TLS lookup callback to the validated public address", async () => {
    (mockLookup as jest.Mock).mockResolvedValueOnce([
      { address: "203.0.114.10", family: 4 },
    ]);
    const request = Object.assign(new EventEmitter(), {
      end: jest.fn(),
      write: jest.fn(),
      destroy: jest.fn(),
    });
    (mockRequest as unknown as jest.Mock).mockImplementation(
      (_url: URL, options: { lookup: Function }, onResponse: Function) => {
        const response = Object.assign(new EventEmitter(), {
          statusCode: 200,
          statusMessage: "OK",
          headers: { "content-type": "application/json" },
        });
        onResponse(response);
        queueMicrotask(() => {
          response.emit("data", Buffer.from('{"ok":true}'));
          response.emit("end");
        });
        const callback = jest.fn();
        options.lookup("hooks.example.com", {}, callback);
        expect(callback).toHaveBeenCalledWith(null, "203.0.114.10", 4);
        return request;
      },
    );

    const response = await fetchPublicEndpoint(
      "https://hooks.example.com/events",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("rejects immediately when the HTTPS response stream errors", async () => {
    (mockLookup as jest.Mock).mockResolvedValueOnce([
      { address: "203.0.114.10", family: 4 },
    ]);
    const request = Object.assign(new EventEmitter(), {
      end: jest.fn(),
      write: jest.fn(),
      destroy: jest.fn(),
    });
    (mockRequest as unknown as jest.Mock).mockImplementation(
      (_url: URL, _options: unknown, onResponse: Function) => {
        const response = Object.assign(new EventEmitter(), {
          statusCode: 200,
          statusMessage: "OK",
          headers: {},
        });
        onResponse(response);
        queueMicrotask(() => response.emit("error", new Error("read failed")));
        return request;
      },
    );

    await expect(
      fetchPublicEndpoint("https://hooks.example.com/events"),
    ).rejects.toThrow("read failed");
  });
});
