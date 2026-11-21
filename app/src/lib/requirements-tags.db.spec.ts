/** @jest-environment node */
// CI-only: needs TEST_DATABASE_URL (run with `npm run test:db`).
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

jest.mock("@/utils/db", () => ({ db: {} }));
import { MAX_TAGS_PER_PROJECT, syncRequirementTagsByName, TagRuleError } from "./requirements-internal";

const databaseName = `requirements_tags_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let pool: ReturnType<typeof postgres>;

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1 });
  await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
  const target = new URL(process.env.TEST_DATABASE_URL);
  target.pathname = `/${databaseName}`;
  pool = postgres(target.toString(), { max: 4, onnotice: () => {} });
  // Only the tables tag sync touches.
  await pool.unsafe(`
    CREATE TABLE tags (id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid, project_id uuid NOT NULL,
      created_by_user_id uuid, name varchar(100) NOT NULL, color varchar(50), created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now());
    CREATE UNIQUE INDEX tags_project_name_idx ON tags (project_id, lower(name));
    CREATE TABLE requirement_tags (requirement_id uuid, tag_id uuid, assigned_at timestamptz,
      PRIMARY KEY (requirement_id, tag_id));
  `);
});

afterAll(async () => {
  await pool?.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

it("serialises concurrent creates on the project-tag lock, so the 50-tag cap cannot be overshot", async () => {
  const [org, project] = [randomUUID(), randomUUID()];
  for (let i = 0; i < MAX_TAGS_PER_PROJECT - 1; i++) {
    await pool`INSERT INTO tags (organization_id, project_id, name) VALUES (${org}, ${project}, ${`existing-${i}`})`;
  }
  const poolDb = drizzle(pool);

  let releaseFirst!: () => void;
  const firstMayCommit = new Promise<void>((resolve) => (releaseFirst = resolve));
  let firstCreated!: () => void;
  const firstInserted = new Promise<void>((resolve) => (firstCreated = resolve));
  const first = poolDb.transaction(async (tx) => {
    await syncRequirementTagsByName(randomUUID(), ["first"], org, project, null, tx as never);
    firstCreated();
    await firstMayCommit;
  });
  await firstInserted;

  let secondSettled = false;
  const second = poolDb
    .transaction((tx) => syncRequirementTagsByName(randomUUID(), ["second"], org, project, null, tx as never))
    .finally(() => { secondSettled = true; });
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(secondSettled).toBe(false); // waiting on the lock, not counting 49 alongside the first

  releaseFirst();
  await first;
  await expect(second).rejects.toBeInstanceOf(TagRuleError);
  const [{ count }] = await pool<{ count: number }[]>`SELECT count(*)::int AS count FROM tags WHERE project_id = ${project}`;
  expect(count).toBe(MAX_TAGS_PER_PROJECT);
}, 30_000);
