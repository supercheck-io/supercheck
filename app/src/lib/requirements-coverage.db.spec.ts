/** @jest-environment node */
// CI-only: needs TEST_DATABASE_URL (run with `npm run test:db`).
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

jest.mock("@/utils/db", () => ({ db: {} }));
import { updateCoverageSnapshot } from "./requirements-internal";
import { RUN_CANCELLATION_MARKER } from "./run-cancellation-marker";

const databaseName = `requirements_coverage_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1 });
  await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
  const target = new URL(process.env.TEST_DATABASE_URL);
  target.pathname = `/${databaseName}`;
  client = postgres(target.toString(), { max: 1 });
  // Only the tables the coverage query touches; no application data or migrations are changed.
  await client.unsafe(`
    CREATE TABLE test_requirements (test_id uuid, requirement_id uuid);
    CREATE TABLE job_tests (job_id uuid, test_case_id uuid);
    CREATE TABLE runs (id uuid PRIMARY KEY DEFAULT uuidv7(), job_id uuid, status text, completed_at timestamptz,
      metadata jsonb DEFAULT '{}', error_details text);
    CREATE TABLE requirement_coverage_snapshots (requirement_id uuid PRIMARY KEY, status text,
      linked_test_count integer, passed_test_count integer, failed_test_count integer,
      last_evaluated_at timestamptz, updated_at timestamptz);
  `);
});
afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

async function scenario(runs: { status: string; at: string; cancelled?: boolean; testStatuses?: Record<string, string> }[]) {
  const [requirement, job, a, b] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await client`INSERT INTO requirement_coverage_snapshots (requirement_id, status) VALUES (${requirement}, 'missing')`;
  for (const test of [a, b]) {
    await client`INSERT INTO test_requirements VALUES (${test}, ${requirement})`;
    await client`INSERT INTO job_tests VALUES (${job}, ${test})`;
  }
  for (const run of runs) {
    const statuses = run.testStatuses
      ? Object.fromEntries(Object.entries(run.testStatuses).map(([key, value]) => [key === "a" ? a : b, value]))
      : null;
    await client`INSERT INTO runs (job_id, status, completed_at, metadata, error_details)
      VALUES (${job}, ${run.status}, ${run.at}, ${JSON.stringify(statuses ? { testStatuses: statuses } : {})}::text::jsonb,
        ${run.cancelled ? RUN_CANCELLATION_MARKER : null})`;
  }
  await updateCoverageSnapshot(requirement, drizzle(client) as never);
  const [snapshot] = await client`SELECT status, linked_test_count AS linked, passed_test_count AS passed,
    failed_test_count AS failed FROM requirement_coverage_snapshots WHERE requirement_id = ${requirement}`;
  return snapshot;
}

it("counts each test by its own outcome in the latest job run, not the run status", async () => {
  const snapshot = await scenario([
    { status: "passed", at: "2026-01-01" },
    { status: "failed", at: "2026-01-02", testStatuses: { a: "passed", b: "failed" } },
  ]);
  expect(snapshot).toMatchObject({ status: "failing", linked: 2, passed: 1, failed: 1 });
});

it("falls back to the run status for runs without per-test outcomes", async () => {
  const snapshot = await scenario([
    { status: "failed", at: "2026-01-02", testStatuses: { a: "passed", b: "failed" } },
    { status: "passed", at: "2026-01-03" },
  ]);
  expect(snapshot).toMatchObject({ status: "covered", linked: 2, passed: 2, failed: 0 });
});

it("does not count skipped tests as passed: coverage stays missing", async () => {
  const snapshot = await scenario([
    { status: "passed", at: "2026-01-02", testStatuses: { a: "skipped", b: "skipped" } },
  ]);
  expect(snapshot).toMatchObject({ status: "missing", linked: 2, passed: 0, failed: 0 });
});

it("ignores a cancelled run: the latest non-cancelled run decides coverage", async () => {
  const snapshot = await scenario([
    { status: "passed", at: "2026-01-01" },
    { status: "error", at: "2026-01-02", cancelled: true },
  ]);
  expect(snapshot).toMatchObject({ status: "covered", linked: 2, passed: 2, failed: 0 });
});

it("still counts an error run that was not cancelled as failing", async () => {
  const snapshot = await scenario([
    { status: "passed", at: "2026-01-01" },
    { status: "error", at: "2026-01-02" },
  ]);
  expect(snapshot).toMatchObject({ status: "failing", passed: 0, failed: 2 });
});
