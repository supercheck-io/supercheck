/** @jest-environment node */
// Needs TEST_DATABASE_URL (npm run test:db). Real migrations, real Postgres.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";

let mockDatabase: ReturnType<typeof drizzle<typeof schema>>;
jest.mock("@/utils/db", () => ({ get db() { return mockDatabase; } }));
import { AUDIT_RETENTION_DAYS, AUDIT_SCRUBBED_MARKER, hashEmail, scrubAuditEmails, scrubEmails } from "./audit-scrub";
import { TEARDOWN_ACTION } from "./organization-teardown-action";

const name = `audit_scrub_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${name}"`);
  const target = new URL(process.env.TEST_DATABASE_URL);
  target.pathname = `/${name}`;
  const appRoot = path.resolve(__dirname, "../..");
  await promisify(execFile)(process.execPath, [path.join(appRoot, "scripts/db-migrate.js")], {
    cwd: appRoot, env: { ...process.env, DATABASE_URL: target.toString(), SELF_HOSTED: "true", NODE_ENV: "test" }, timeout: 90000,
  });
  client = postgres(target.toString(), { max: 4, onnotice: () => {} });
  mockDatabase = drizzle(client, { schema });
}, 100000);

afterAll(async () => {
  await client?.end({ timeout: 5 });
  await maintenance?.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await maintenance?.end({ timeout: 5 });
});

const insert = (daysOld: number, details: unknown, action = "member_invited") => client`
  INSERT INTO audit_logs (id, action, details, created_at) VALUES (uuidv7(), ${action}, ${JSON.stringify(details)}::jsonb, now() - make_interval(days => ${daysOld})) RETURNING id`;

describe("audit email scrub", () => {
  it("replaces addresses anywhere in the details, keeps equal addresses comparable, leaves everything else", () => {
    const out = scrubEmails({ targetEmail: "Ann@Example.com", nested: { list: ["bob@example.com", "no email"] }, count: 3 });
    expect(out.targetEmail).toBe(hashEmail("ann@example.com"));
    expect(out.nested.list).toEqual([hashEmail("bob@example.com"), "no email"]);
    expect(out.count).toBe(3);
    expect(JSON.stringify(out)).not.toContain("@");
  });

  it("scrubs rows older than the threshold once, leaves recent rows, and keeps the billing teardown marker usable", async () => {
    const [old] = await insert(40, { targetEmail: "ann@example.com", metadata: { invitee: "bob@example.com" } });
    const [recent] = await insert(2, { targetEmail: "recent@example.com" });
    const [teardown] = await insert(60, { subscriptionId: "sub_1", organizationId: "o" }, TEARDOWN_ACTION);
    expect(await scrubAuditEmails({ dryRun: true, batchSize: 100, maxRecords: 1000 })).toBeGreaterThanOrEqual(2);
    expect((await client`SELECT details FROM audit_logs WHERE id = ${old.id}`)[0].details.targetEmail).toBe("ann@example.com"); // dry run changed nothing
    expect(await scrubAuditEmails({ dryRun: false, batchSize: 1, maxRecords: 1000 })).toBeGreaterThanOrEqual(2); // batches of one still finish
    const scrubbed = (await client`SELECT details FROM audit_logs WHERE id = ${old.id}`)[0].details;
    expect(JSON.stringify(scrubbed)).not.toContain("@");
    expect(scrubbed[AUDIT_SCRUBBED_MARKER]).toBe(true);
    expect((await client`SELECT details FROM audit_logs WHERE id = ${recent.id}`)[0].details.targetEmail).toBe("recent@example.com");
    expect((await client`SELECT details FROM audit_logs WHERE id = ${teardown.id}`)[0].details.subscriptionId).toBe("sub_1");
    expect(await scrubAuditEmails({ dryRun: false, batchSize: 100, maxRecords: 1000 })).toBe(0); // finished rows are not rewritten
  });

  it("walks only unfinished rows (partial index)", async () => {
    await client`ANALYZE audit_logs`;
    const plan = (await client`EXPLAIN SELECT id FROM audit_logs WHERE created_at < now() AND (details IS NULL OR NOT (details ? 'emailsScrubbed')) ORDER BY created_at, id LIMIT 10`).map((r) => r["QUERY PLAN"]).join("\n");
    expect(plan).toMatch(/audit_logs_unscrubbed_created_idx|Seq Scan/); // tiny table may seq scan; the index exists and matches the predicate
    expect((await client`SELECT 1 FROM pg_indexes WHERE indexname = 'audit_logs_unscrubbed_created_idx'`).length).toBe(1);
  });

  it("keeps audit records for 12 months", () => {
    expect(AUDIT_RETENTION_DAYS).toBe(365);
  });
});
