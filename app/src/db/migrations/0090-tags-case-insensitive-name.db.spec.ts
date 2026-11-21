/** @jest-environment node */
// CI-only: needs TEST_DATABASE_URL (run with `npm run test:db`).
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";
import { isTagNameConflict } from "@/lib/tag-validation";

const execFileAsync = promisify(execFile);
const APP_ROOT = path.resolve(__dirname, "../../..");
const FILE = "src/db/migrations/0090_tags_case_insensitive_name.sql";
const databaseName = `tags_ci_name_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
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

it("renames later case-twins to free names, keeps links, and makes the index case-insensitive", async () => {
  await migrate();
  // Replay 0090 over a database that still has the old case-sensitive index and holds case-twins.
  await client.unsafe(`DROP INDEX tags_project_lower_name_idx`);
  await client`DELETE FROM "__drizzle_migrations" WHERE hash = ${fileHash()}`;

  const [org, project, other, requirement] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const long = "a".repeat(50);
  const rows: [string, string, string][] = [
    // [project, name, created_at]
    [project, "smoke", "2026-01-01"],
    [project, "Smoke", "2026-01-02"],
    [project, "SMOKE", "2026-01-03"],
    [project, "smoke-2", "2026-01-01"],
    [project, "SMOKE-2", "2026-01-04"],
    [project, long, "2026-01-01"],
    [project, long.toUpperCase(), "2026-01-02"],
    [other, "Smoke", "2026-01-05"],
  ];
  const ids = new Map<string, string>();
  await client.begin(async (tx) => {
    // Fixture only: skip FK checks so the test does not need full organization/project/requirement rows.
    await tx`SET LOCAL session_replication_role = replica`;
    for (const [projectId, name, createdAt] of rows) {
      const [{ id }] = await tx<{ id: string }[]>`
        INSERT INTO tags (id, organization_id, project_id, name, created_at) VALUES (uuidv7(), ${org}, ${projectId}, ${name}, ${createdAt})
        RETURNING id`;
      ids.set(`${projectId}:${name}`, id);
    }
    await tx`INSERT INTO requirement_tags (requirement_id, tag_id) VALUES (${requirement}, ${ids.get(`${project}:Smoke`)!})`;
  });

  await migrate();

  const nameOf = async (key: string) =>
    (await client<{ name: string }[]>`SELECT name FROM tags WHERE id = ${ids.get(key)!}`)[0].name;
  expect(await nameOf(`${project}:smoke`)).toBe("smoke");
  expect(await nameOf(`${project}:Smoke`)).toBe("Smoke-3"); // "-2" is taken by the existing "smoke-2"
  expect(await nameOf(`${project}:SMOKE`)).toBe("SMOKE-4");
  expect(await nameOf(`${project}:smoke-2`)).toBe("smoke-2");
  expect(await nameOf(`${project}:SMOKE-2`)).toBe("SMOKE-2-2");
  expect(await nameOf(`${project}:${long}`)).toBe(long);
  expect(await nameOf(`${project}:${long.toUpperCase()}`)).toBe(`${"A".repeat(48)}-2`);
  expect(await nameOf(`${other}:Smoke`)).toBe("Smoke"); // other projects are untouched
  const [link] = await client<{ tag_id: string }[]>`SELECT tag_id FROM requirement_tags WHERE requirement_id = ${requirement}`;
  expect(link.tag_id).toBe(ids.get(`${project}:Smoke`));

  const [{ indexdef }] = await client<{ indexdef: string }[]>`SELECT indexdef FROM pg_indexes WHERE indexname = 'tags_project_lower_name_idx'`;
  expect(indexdef).toContain("UNIQUE INDEX tags_project_lower_name_idx ON public.tags USING btree (project_id, lower((name)::text))");

  const error = await client
    .begin(async (tx) => {
      await tx`SET LOCAL session_replication_role = replica`;
      await tx`INSERT INTO tags (id, organization_id, project_id, name) VALUES (uuidv7(), ${org}, ${other}, 'SMOKE')`;
    })
    .catch((e: unknown) => e);
  expect(isTagNameConflict(error)).toBe(true);
}, 180_000);
