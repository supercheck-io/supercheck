import { describe, expect, it } from "vitest";
import raw from "../wrangler.jsonc?raw";

// JSONC: strip line comments that are not inside strings.
const config = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, "")) as Record<string, unknown>;

describe("wrangler config", () => {
  it("has no account_id, routes or zone", () => {
    expect(config).not.toHaveProperty("account_id");
    expect(config).not.toHaveProperty("routes");
    expect(config).not.toHaveProperty("route");
  });

  it("binds nothing but rate limiters", () => {
    const bindingKeys = ["kv_namespaces", "r2_buckets", "d1_databases", "durable_objects", "services", "queues", "hyperdrive", "vectorize", "ai", "analytics_engine_datasets", "secrets_store_secrets"];
    for (const key of bindingKeys) expect(config).not.toHaveProperty(key);
    expect((config.ratelimits as unknown[]).length).toBe(3);
  });

  it("keeps dashboard vars across deploys and ships with every tool on", () => {
    expect(config.keep_vars).toBe(true);
    expect((config.vars as Record<string, string>).TOOLS.split(",")).toHaveLength(8);
    expect(JSON.stringify(config.vars)).not.toMatch(/SECRET|KEY/);
  });
});
