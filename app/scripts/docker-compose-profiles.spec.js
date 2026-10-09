const { execFileSync } = require("node:child_process");
const path = require("node:path");

const cwd = path.resolve(__dirname, "../../deploy/docker");
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

test("the default stack needs neither HTTPS nor Private Agent settings", () => {
  const stack = config();
  expect(Object.keys(stack.services).sort()).toEqual([
    "app",
    "minio",
    "postgres",
    "redis",
    "worker",
  ]);
  expect(stack.services.app.environment.NEXT_PUBLIC_APP_URL).toBe(
    "http://localhost:3000",
  );
  expect(stack.services.app.ports[0].host_ip).toBe("127.0.0.1");
});

test("HTTPS uses the main file and keeps routing, certificates and app origins aligned", () => {
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
    stack.services.app.labels["traefik.http.routers.status-custom.service"],
  ).toBe("app");
  expect(
    stack.services.traefik.volumes.some(
      (volume) => volume.source === "traefik-letsencrypt",
    ),
  ).toBe(true);
});

test("Private Agent is optional, isolated and never inherits infrastructure credentials", () => {
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

test("the existing HTTPS file remains a compatible entry point", () => {
  const stack = config("", "docker-compose-secure.yml", https);
  expect(stack.services.traefik).toBeDefined();
  expect(stack.services.app.ports).toBeUndefined();
  expect(stack.services.app.deploy.replicas).toBe(2);
  expect(stack.services.app.environment.NEXT_PUBLIC_APP_URL).toBe(
    "https://app.example.com",
  );
  expect(stack.services["private-agent"]).toBeUndefined();
});

test("legacy HTTPS preserves explicit app and auth URL overrides for both app and worker", () => {
  const stack = config("", "docker-compose-secure.yml", {
    ...https, APP_URL: "https://api.example.com", BETTER_AUTH_URL: "https://auth.example.com",
  });
  for (const service of [stack.services.app, stack.services.worker]) {
    expect(service.environment.APP_URL).toBe("https://api.example.com");
    expect(service.environment.BETTER_AUTH_URL).toBe("https://auth.example.com");
  }
});
