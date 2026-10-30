const { execFileSync } = require("node:child_process");
const path = require("node:path");

const cwd = path.resolve(__dirname, "../../deploy/docker");
let testCompose = test;
try {
  execFileSync("docker", ["compose", "version"], { stdio: "ignore" });
} catch (error) {
  if (process.env.CI) throw error;
  testCompose = test.skip;
}
function config(profiles = "", file = "docker-compose.yml", vars = {}) {
  return JSON.parse(
    execFileSync(
      "docker",
      [
        "compose",
        "--env-file",
        "/dev/null",
        "-f",
        file,
        "config",
        "--format",
        "json",
      ],
      {
        cwd,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          COMPOSE_PROFILES: profiles,
          // Required secrets; init-secrets.sh generates real values.
          AWS_ACCESS_KEY_ID: "placeholder-access-key",
          AWS_SECRET_ACCESS_KEY: "placeholder-secret-key-0123456789ab",
          DB_PASSWORD: "placeholder-db-password",
          REDIS_PASSWORD: "placeholder-redis-password",
          BETTER_AUTH_SECRET: "placeholder-auth-secret",
          ...vars,
        },
        encoding: "utf8",
      },
    ),
  );
}
const https = {
  APP_DOMAIN: "app.example.com",
  ACME_EMAIL: "admin@example.com",
};

testCompose("still starts without SECRET_ENCRYPTION_KEY so upgrades keep reading existing secrets", () => {
  for (const file of ["docker-compose.yml", "docker-compose-local.yml", "docker-compose-external.yml"]) {
    expect(() => config("", file, { SECRET_ENCRYPTION_KEY: "" })).not.toThrow();
  }
});

testCompose("production compose files refuse to start without S3 keys", () => {
  for (const file of ["docker-compose.yml", "docker-compose-external.yml"]) {
    for (const key of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]) {
      expect(() => config("", file, { [key]: "" })).toThrow();
    }
  }
});

testCompose("the main compose file refuses to start without generated secrets", () => {
  for (const key of ["DB_PASSWORD", "REDIS_PASSWORD", "BETTER_AUTH_SECRET"]) {
    expect(() => config("", "docker-compose.yml", { [key]: "" })).toThrow();
  }
  expect(() => config("", "docker-compose-external.yml", { BETTER_AUTH_SECRET: "" })).toThrow();
  const stack = config();
  expect(stack.services.app.environment.DATABASE_URL).toBe(
    "postgresql://postgres:placeholder-db-password@postgres:5432/supercheck",
  );
  expect(stack.services.worker.deploy.restart_policy).toBeUndefined();
  expect(stack.services.worker.restart).toBe("unless-stopped");
});

testCompose("multi-server bind addresses move only the published data ports", () => {
  const stack = config("", "docker-compose.yml", {
    DB_BIND_ADDR: "10.0.0.10",
    REDIS_BIND_ADDR: "10.0.0.11",
    RUSTFS_BIND_ADDR: "10.0.0.12",
  });
  expect(stack.services.postgres.ports[0].host_ip).toBe("10.0.0.10");
  expect(stack.services.redis.ports[0].host_ip).toBe("10.0.0.11");
  expect(stack.services.rustfs.ports[0].host_ip).toBe("10.0.0.12");
  expect(stack.services.app.ports[0].host_ip).toBe("127.0.0.1");
});

testCompose("the default stack needs neither HTTPS nor Private Agent settings", () => {
  const stack = config();
  expect(Object.keys(stack.services).sort()).toEqual([
    "app",
    "postgres",
    "redis",
    "rustfs",
    "worker",
  ]);
  expect(stack.services.app.environment.NEXT_PUBLIC_APP_URL).toBe(
    "http://localhost:3000",
  );
  for (const name of ["app", "postgres", "redis", "rustfs"]) {
    expect(stack.services[name].ports.length).toBeGreaterThan(0);
    for (const port of stack.services[name].ports) {
      expect(port.host_ip).toBe("127.0.0.1");
    }
  }
});

testCompose("HTTPS uses the main file and keeps routing, certificates and app origins aligned", () => {
  const stack = config("https", "docker-compose.yml", https);
  expect(stack.services.traefik.ports.map((port) => port.published)).toEqual([
    "80",
    "443",
  ]);
  expect(stack.services.app.environment.BETTER_AUTH_URL).toBe(
    "https://app.example.com",
  );
  expect(stack.services.app.labels["traefik.http.routers.app.rule"]).toBe(
    "Host(`app.example.com`)",
  );
  expect(
    stack.services.app.labels["traefik.http.routers.status-pages.rule"],
  ).toBe("HostRegexp(`[a-zA-Z0-9-]+\\.app.example.com`)");
  expect(
    stack.services.app.labels["traefik.http.routers.status-custom.service"],
  ).toBe("app");
  expect(
    stack.services.traefik.volumes.some(
      (volume) => volume.source === "traefik-letsencrypt",
    ),
  ).toBe(true);
});

testCompose("Private Agent is optional, isolated and never inherits infrastructure credentials", () => {
  const stack = config("https,private-agent", "docker-compose.yml", {
    ...https,
    PRIVATE_AGENT_ID: "agent-id",
    PRIVATE_AGENT_TOKEN: "registration-token",
  });
  const agent = stack.services["private-agent"];
  expect(agent.environment.SUPERCHECK_RUNTIME_MODE).toBe("private-agent");
  expect(agent.environment.SUPERCHECK_API_URL).toBe("http://app:3000");
  expect(agent.environment.DATABASE_URL).toBeUndefined();
  expect(agent.environment.REDIS_PASSWORD).toBeUndefined();
  expect(agent.environment.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  expect(agent.read_only).toBe(true);
  expect(agent.cap_drop).toContain("ALL");
  expect(Object.keys(agent.networks)).toEqual(["private-agent-network"]);
  expect(
    stack.services.postgres.networks["private-agent-network"],
  ).toBeUndefined();
  expect(agent.ports).toBeUndefined();
  expect(agent.volumes[0].source).toBe("private-agent-state");
});

testCompose("the existing HTTPS file remains a compatible entry point", () => {
  const stack = config("", "docker-compose-secure.yml", https);
  expect(stack.services.traefik).toBeDefined();
  expect(stack.services.app.ports).toBeUndefined();
  expect(stack.services.app.deploy.replicas).toBe(2);
  expect(stack.services.app.environment.NEXT_PUBLIC_APP_URL).toBe(
    "https://app.example.com",
  );
  expect(stack.services["private-agent"]).toBeUndefined();
});

testCompose("legacy HTTPS preserves explicit app and auth URL overrides for both app and worker", () => {
  const stack = config("", "docker-compose-secure.yml", {
    ...https, APP_URL: "https://api.example.com", BETTER_AUTH_URL: "https://auth.example.com",
  });
  for (const service of [stack.services.app, stack.services.worker]) {
    expect(service.environment.APP_URL).toBe("https://api.example.com");
    expect(service.environment.BETTER_AUTH_URL).toBe("https://auth.example.com");
  }
});
