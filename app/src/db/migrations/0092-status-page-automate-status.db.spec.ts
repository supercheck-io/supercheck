/** @jest-environment node */
// CI-only: needs TEST_DATABASE_URL (run with `npm run test:db`).
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";

const execFileAsync = promisify(execFile);
const APP_ROOT = path.resolve(__dirname, "../../..");
const FILE = "src/db/migrations/0092_status_page_automate_status.sql";
const databaseName = `sp_automate_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
let databaseUrl: string;

const migrate = () =>
  execFileAsync(process.execPath, [path.join(APP_ROOT, "scripts/db-migrate.js")], {
    cwd: APP_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl, SELF_HOSTED: "true", NODE_ENV: "test" },
    timeout: 90_000,
  });

const fileHash = () => createHash("md5").update(readFileSync(path.join(APP_ROOT, FILE), "utf8")).digest("hex");

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  databaseUrl = url.toString();
  client = postgres(databaseUrl, { max: 1, onnotice: () => {} });
}, 30_000);

afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

it("makes every component manual and releases what monitors left behind", async () => {
  await migrate();
  // Replay 0092 over data written while monitors still drove every linked component.
  await client.unsafe(`ALTER TABLE status_page_components DROP COLUMN automate_status`);
  await client`DELETE FROM "__drizzle_migrations" WHERE hash = ${fileHash()}`;

  const [org] = await client`INSERT INTO organization (id, name, created_at) VALUES (${randomUUID()}, 'Acme', now()) RETURNING id`;
  const [project] = await client`INSERT INTO projects (id, organization_id, name) VALUES (uuidv7(), ${org.id}, 'P') RETURNING id`;
  const [page] = await client`INSERT INTO status_pages (id, organization_id, project_id, name, subdomain, status) VALUES (uuidv7(), ${org.id}, ${project.id}, 'S', ${randomUUID().replaceAll("-", "")}, 'published') RETURNING id`;
  const [monitor] = await client`INSERT INTO monitors (id, organization_id, project_id, name, type, target, status) VALUES (uuidv7(), ${org.id}, ${project.id}, 'API', 'http_request', 'https://example.com', 'down') RETURNING id`;
  const component = async (name: string, status: string, linked: boolean) => {
    const [row] = await client`INSERT INTO status_page_components (id, status_page_id, name, status) VALUES (uuidv7(), ${page.id}, ${name}, ${status}) RETURNING id`;
    if (linked) await client`INSERT INTO status_page_component_monitors (component_id, monitor_id) VALUES (${row.id}, ${monitor.id})`;
    return row.id as string;
  };
  const stale = await component("Set by monitors", "major_outage", true);
  const automatic = await component("Automatic incident", "major_outage", true);
  const handSet = await component("Set by hand", "partial_outage", false);
  const [incident] = await client`INSERT INTO incidents (id, status_page_id, name, status, impact, source_component_id) VALUES (uuidv7(), ${page.id}, 'Outage', 'investigating', 'major', ${automatic}) RETURNING id`;
  await client`INSERT INTO incident_components (id, incident_id, component_id, old_status, new_status) VALUES (uuidv7(), ${incident.id}, ${automatic}, 'operational', 'major_outage')`;

  await migrate();

  const rows = await client`SELECT id, status, automate_status FROM status_page_components`;
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
  expect(rows.every((row) => row.automate_status === false)).toBe(true);
  expect(byId[stale].status).toBe("operational");
  // An open update still explains the outage, and hand-set statuses are the owner's.
  expect(byId[automatic].status).toBe("major_outage");
  expect(byId[handSet].status).toBe("partial_outage");
  const [handedOver] = await client`SELECT status, source_component_id FROM incidents WHERE id = ${incident.id}`;
  expect(handedOver).toEqual({ status: "investigating", source_component_id: null });
}, 120_000);
