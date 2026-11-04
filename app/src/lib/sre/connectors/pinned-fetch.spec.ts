/** @jest-environment node */

import { EventEmitter } from "node:events";

jest.mock("node:dns/promises", () => ({ lookup: jest.fn() }));
jest.mock("node:http", () => ({
  __esModule: true,
  default: { request: jest.fn() },
}));
jest.mock("node:https", () => ({
  __esModule: true,
  default: { request: jest.fn() },
}));

import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { fetchConnectorEndpoint, fetchPublicEndpoint } from "./pinned-fetch";

const mockLookup = lookup as jest.MockedFunction<typeof lookup>;
const mockHttpRequest = http.request as jest.MockedFunction<typeof http.request>;
const mockRequest = https.request as jest.MockedFunction<typeof https.request>;

describe("pinned public fetch", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSelfHosted = process.env.SELF_HOSTED;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(process.env, "NODE_ENV", {
      value: "production",
      configurable: true,
      writable: true,
    });
  });

  it.each([204, 205, 304])(
    "accepts the bodyless HTTP status %s",
    async (statusCode) => {
      (mockLookup as jest.Mock).mockResolvedValueOnce([
        { address: "203.0.114.10", family: 4 },
      ]);
      const request = Object.assign(new EventEmitter(), {
        end: jest.fn(),
        write: jest.fn(),
        destroy: jest.fn(),
      });
      (mockRequest as unknown as jest.Mock).mockImplementation(
        (
          _url: URL,
          _options: unknown,
          onResponse: (response: EventEmitter) => void,
        ) => {
          const response = Object.assign(new EventEmitter(), {
            statusCode,
            headers: {},
          });
          onResponse(response);
          queueMicrotask(() => response.emit("end"));
          return request;
        },
      );
      const response = await fetchPublicEndpoint(
        "https://hooks.example.com/events",
      );
      expect(response.status).toBe(statusCode);
      expect(response.body).toBeNull();
      await expect(response.text()).resolves.toBe("");
    },
  );

  afterEach(() => {
    Object.defineProperty(process.env, "NODE_ENV", {
      value: originalNodeEnv,
      configurable: true,
      writable: true,
    });
    if (originalSelfHosted === undefined) delete process.env.SELF_HOSTED;
    else process.env.SELF_HOSTED = originalSelfHosted;
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

  it("caps the response body on the self-hosted private-network path", async () => {
    process.env.SELF_HOSTED = "true";
    (mockLookup as jest.Mock).mockResolvedValueOnce([{ address: "10.0.0.5", family: 4 }]);
    const request = fakeRequest();
    (mockHttpRequest as unknown as jest.Mock).mockImplementation((_u: URL, _o: unknown, onResponse: Function) => {
      const response = Object.assign(new EventEmitter(), { statusCode: 200, headers: {} });
      onResponse(response);
      queueMicrotask(() => response.emit("data", Buffer.alloc(11)));
      return request;
    });
    await expect(fetchConnectorEndpoint("http://prometheus.internal:9090", {}, 10)).rejects.toThrow("exceeded 10 bytes");
  });

  it("rejects a trailing-dot loopback hostname in self-hosted development", async () => {
    Object.defineProperty(process.env, "NODE_ENV", {
      value: "development",
      configurable: true,
      writable: true,
    });
    process.env.SELF_HOSTED = "true";
    (mockLookup as jest.Mock).mockResolvedValueOnce([
      { address: "127.0.0.1", family: 4 },
    ]);
    await expect(
      fetchPublicEndpoint("https://localhost.:4000/api/health/live"),
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
        options.lookup("hooks.example.com", { all: true }, callback);
        expect(callback).toHaveBeenCalledWith(null, [
          { address: "203.0.114.10", family: 4 },
        ]);

        const singleAddressCallback = jest.fn();
        options.lookup(
          "hooks.example.com",
          { all: false },
          singleAddressCallback,
        );
        expect(singleAddressCallback).toHaveBeenCalledWith(
          null,
          "203.0.114.10",
          4,
        );
        return request;
      },
    );

    const response = await fetchPublicEndpoint(
      "https://hooks.example.com:8443/events",
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

it("aborts a public response once the caller's byte limit is exceeded", async () => {
  (mockLookup as jest.Mock).mockResolvedValueOnce([{ address: "203.0.114.10", family: 4 }]);
  const request = Object.assign(new EventEmitter(), {
    end: jest.fn(), write: jest.fn(),
    destroy: jest.fn(function (error: Error) { request.emit("error", error); }),
  });
  (mockRequest as unknown as jest.Mock).mockImplementation((_url: URL, _options: unknown, onResponse: Function) => {
    const response = Object.assign(new EventEmitter(), { statusCode: 200, headers: {} });
    onResponse(response);
    queueMicrotask(() => { response.emit("data", Buffer.alloc(4097)); });
    return request;
  });
  await expect(fetchPublicEndpoint("https://hooks.example.com", {}, 4096)).rejects.toThrow("exceeded 4096 bytes");
  expect(request.destroy).toHaveBeenCalledTimes(1);
});

function fakeRequest() {
  const request = Object.assign(new EventEmitter(), {
    end: jest.fn(), write: jest.fn(),
    destroy: jest.fn(function (error: Error) { request.emit("error", error); }),
  });
  return request;
}

it("sends the body in one end() call with an explicit content-length", async () => {
  (mockLookup as jest.Mock).mockResolvedValueOnce([{ address: "203.0.114.10", family: 4 }]);
  const request = fakeRequest();
  let sentHeaders: Record<string, string> = {};
  (mockRequest as unknown as jest.Mock).mockImplementation((_u: URL, options: { headers: Record<string, string> }, onResponse: Function) => {
    sentHeaders = options.headers;
    const response = Object.assign(new EventEmitter(), { statusCode: 200, headers: {} });
    onResponse(response);
    queueMicrotask(() => response.emit("end"));
    return request;
  });
  await fetchPublicEndpoint("https://hooks.example.com", { method: "POST", body: "héllo" });
  expect(request.write).not.toHaveBeenCalled();
  expect(request.end).toHaveBeenCalledWith("héllo");
  expect(sentHeaders["content-length"]).toBe("6");
});

describe("self-hosted pinned fetch", () => {
  beforeEach(() => { jest.resetAllMocks(); });
  afterEach(() => { delete process.env.SELF_HOSTED; });

  it("blocks metadata addresses (literal, mapped and DNS) before any request", async () => {
    process.env.SELF_HOSTED = "true";
    await expect(fetchConnectorEndpoint("http://169.254.169.254/latest")).rejects.toThrow("metadata");
    await expect(fetchConnectorEndpoint("http://[::ffff:169.254.169.254]/")).rejects.toThrow("metadata");
    (mockLookup as jest.Mock).mockResolvedValueOnce([{ address: "100.100.100.200", family: 4 }]);
    await expect(fetchConnectorEndpoint("http://meta.example.com/")).rejects.toThrow("metadata");
    expect(mockHttpRequest).not.toHaveBeenCalled();
  });

  it("resolves once and pins the connection, so a rebinding second answer is never used", async () => {
    process.env.SELF_HOSTED = "true";
    (mockLookup as jest.Mock)
      .mockResolvedValueOnce([{ address: "10.0.0.5", family: 4 }])
      .mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);
    let lookupOption: Function | undefined;
    (mockHttpRequest as unknown as jest.Mock).mockImplementation((_u: URL, options: { lookup: Function }, onResponse: Function) => {
      lookupOption = options.lookup;
      const response = Object.assign(new EventEmitter(), { statusCode: 200, headers: {}, statusMessage: "OK" });
      onResponse(response);
      queueMicrotask(() => response.emit("end"));
      return fakeRequest();
    });
    await fetchConnectorEndpoint("http://prom.internal:9090/");
    expect(mockLookup).toHaveBeenCalledTimes(1);
    const cb = jest.fn();
    lookupOption!("prom.internal", {}, cb);
    expect(cb).toHaveBeenCalledWith(null, "10.0.0.5", 4);
  });

  it("rejects when the first resolved address is metadata, even if a later one is fine", async () => {
    process.env.SELF_HOSTED = "true";
    (mockLookup as jest.Mock).mockResolvedValueOnce([
      { address: "169.254.169.254", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ]);
    await expect(fetchConnectorEndpoint("http://prom.internal/")).rejects.toThrow("metadata");
    expect(mockHttpRequest).not.toHaveBeenCalled();
  });

  it("allows loopback", async () => {
    process.env.SELF_HOSTED = "true";
    (mockHttpRequest as unknown as jest.Mock).mockImplementation((_u: URL, _o: unknown, onResponse: Function) => {
      const response = Object.assign(new EventEmitter(), { statusCode: 200, headers: {}, statusMessage: "OK" });
      onResponse(response);
      queueMicrotask(() => response.emit("end"));
      return fakeRequest();
    });
    const response = await fetchConnectorEndpoint("http://127.0.0.1:9090/");
    expect(response.status).toBe(200);
  });
});
