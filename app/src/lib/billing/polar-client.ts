import { Polar } from "@polar-sh/sdk";
import { HTTPClient } from "@polar-sh/sdk/lib/http";

export const POLAR_API_VERSION = "2026-04";

export function createPolarClient(config: {
  accessToken: string;
  server: "production" | "sandbox";
}) {
  const httpClient = new HTTPClient();
  httpClient.addHook("beforeRequest", (request) => {
    request.headers.set("Polar-Version", POLAR_API_VERSION);
  });
  return new Polar({ ...config, httpClient, timeoutMs: 15_000 });
}
