import { createPolar, createPolarCore } from "@polar-sh/sdk/2026-10";

// createPolar sends Polar-Version itself; raw fetch callers must send the same value.
export const POLAR_API_VERSION = "2026-10";
const POLAR_TIMEOUT_SECONDS = 15;

interface PolarClientConfig {
  accessToken: string;
  server: "production" | "sandbox";
}

function clientOptions(config: PolarClientConfig) {
  return {
    accessToken: config.accessToken,
    environment: config.server,
    timeout: POLAR_TIMEOUT_SECONDS,
  };
}

export function createPolarClient(config: PolarClientConfig) {
  return createPolar(clientOptions(config));
}

/** Core client for the Better Auth plugin, which requires createPolarCore. */
export function createPolarCoreClient(config: PolarClientConfig) {
  return createPolarCore(clientOptions(config));
}

export type PolarClient = ReturnType<typeof createPolarClient>;
