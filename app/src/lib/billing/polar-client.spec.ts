/** @jest-environment node */
jest.mock("@polar-sh/sdk/2026-10", () => ({
  createPolar: jest.fn(),
  createPolarCore: jest.fn(),
}));

import { createPolar, createPolarCore } from "@polar-sh/sdk/2026-10";
import {
  createPolarClient,
  createPolarCoreClient,
  POLAR_API_VERSION,
} from "./polar-client";

describe("Polar SDK transport", () => {
  afterEach(() => jest.clearAllMocks());

  it("pins the SDK entry point to the raw-fetch API version", () => {
    // The SDK subpath and the Polar-Version sent by raw fetch callers must not drift.
    expect(POLAR_API_VERSION).toBe("2026-10");
  });

  it.each(["sandbox", "production"] as const)(
    "creates a %s client with a bounded timeout in seconds",
    (server) => {
      createPolarClient({ accessToken: "test-token", server });
      expect(createPolar).toHaveBeenCalledWith({
        accessToken: "test-token",
        environment: server,
        timeout: 15,
      });
    },
  );

  it.each(["sandbox", "production"] as const)(
    "creates a %s core client for the auth plugin with the same options",
    (server) => {
      createPolarCoreClient({ accessToken: "test-token", server });
      expect(createPolarCore).toHaveBeenCalledWith({
        accessToken: "test-token",
        environment: server,
        timeout: 15,
      });
    },
  );
});
